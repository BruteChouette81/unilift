import * as AppleAuthentication from "expo-apple-authentication";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import LegalTermsModal from "@/components/legal-terms-modal";
import DeviceLimitScreen from "@/components/signup/device-limit";
import FlowShell, { type FlowShellHandle } from "@/components/flow/flow-shell";
import { type StepPageProps } from "@/components/flow/step-frame";
import PasswordStep from "@/components/signup/steps/password-step";
import PhoneStep from "@/components/signup/steps/phone-step";
import ReviewStep, { type ReviewRow } from "@/components/signup/steps/review-step";
import SchoolStep from "@/components/signup/steps/school-step";
import TermsStep from "@/components/signup/steps/terms-step";
import TextStep from "@/components/signup/steps/text-step";
import {
  autoFormatDateInput,
  calculateAgeFromBirthDate,
  formatBirthDateForDisplay,
  parseBirthDateInput,
} from "@/components/userHelper";
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import {
  requestAppleCredential,
  resolveAuthError,
  signInToFirebaseWithApple,
} from "@/services/authService";
import { checkDevice, registerDevice } from "@/services/deviceService";
import { createUserProfile } from "@/services/userService";
import { isValidEmailFormat, normalizeEmail } from "@/utils/emailIdentity";
import { isPasswordValid } from "@/utils/passwordPolicy";
import { formatPhoneForDisplay, parsePhoneInput } from "@/utils/phoneNumber";

/**
 * Account creation, one question per page.
 *
 * The pager, footer, keyboard handling and back button all live in
 * `components/flow/flow-shell.tsx`, shared with onboarding. What stays here is
 * what is actually about creating an account: the answers, what makes each one
 * valid, and the two ways to submit.
 *
 * ## Why a pager and not eight routes
 *
 * `app/_layout.tsx` swaps the entire `(auth)` group out the instant Firebase
 * auth fires. Apple Sign-In depends on that: it authenticates and writes the
 * profile in one press because there is no second render to defer to. Keeping
 * signup as a single route means `segments[0]` stays `"(auth)"`, so the
 * countdown gate and the What's New suppression both keep working untouched.
 *
 * ## Forward movement is earned
 *
 * Only `unlocked + 1` pages are rendered, so the ScrollView's own content size
 * is the wall — there is no scroll position to fight and no gesture to cancel.
 * `unlocked` never decreases: shrinking it while the user sits on a later page
 * would hard-snap them backwards. Correctness is re-checked at submit instead.
 */

const STEP = {
  name: 0,
  email: 1,
  password: 2,
  birthDate: 3,
  school: 4,
  phone: 5,
  terms: 6,
  review: 7,
} as const;

const TOTAL = 8;
const LAST = TOTAL - 1;

/** Youngest age that may hold an account. Mirrors the Adult certification. */
const MIN_AGE = 18;

export default function SignupScreen() {
  const router = useRouter();
  const { signUp, authActionLoading } = useAuth();
  const { t } = useLanguage();
  const shell = useRef<FlowShellHandle>(null);

  const [index, setIndex] = useState(0);
  const [unlocked, setUnlocked] = useState(0);

  // Answers
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [school, setSchool] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneConsent, setPhoneConsent] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  /** Inline messages, by page. Validation never uses an alert. */
  const [errors, setErrors] = useState<Record<number, string | null>>({});

  const [submitting, setSubmitting] = useState(false);
  const isSubmitting = submitting || authActionLoading;

  // Advisory pre-check, so somebody at the cap is told now rather than after
  // answering eight questions. It fails open — `registerDevice` below is the
  // half with authority, and a network blip must not read as "you are banned".
  const [deviceBlocked, setDeviceBlocked] = useState(false);
  useEffect(() => {
    let alive = true;
    checkDevice()
      .then((r) => {
        if (alive && !r.allowed) setDeviceBlocked(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const goTo = useCallback((next: number) => shell.current?.goTo(next), []);

  /** Raise the wall to `next`, then move there once the page exists. */
  const openAndGo = useCallback(
    (next: number) => {
      if (next > LAST) return;
      // Monotonic: a later page stays reachable even if an earlier answer is
      // edited, so nobody is yanked backwards mid-scroll. The shell parks the
      // scroll until the page it targets has actually rendered.
      setUnlocked((u) => Math.max(u, next));
      goTo(next);
    },
    [goTo],
  );

  // ── Validation ───────────────────────────────────────────────────────────
  const validate = useCallback(
    (step: number): string | null => {
      switch (step) {
        case STEP.name:
          return name.trim() ? null : t("auth.signup.errNameRequired");
        case STEP.email:
          return isValidEmailFormat(email.trim())
            ? null
            : t("auth.signup.errEmailInvalid");
        case STEP.password:
          return isPasswordValid(password) ? null : t("auth.signup.errPasswordWeak");
        case STEP.birthDate: {
          const iso = parseBirthDateInput(birthDate);
          if (!iso) return t("auth.signup.errBirthDateInvalid");
          // Must be fed the ISO string — `new Date("25/12/2000")` is invalid and
          // would silently score 0, which reads as "too young" rather than as a
          // parse failure.
          return calculateAgeFromBirthDate(iso) >= MIN_AGE
            ? null
            : t("auth.signup.errBirthDateTooYoung");
        }
        case STEP.school:
          return school.trim() ? null : t("auth.signup.errSchoolRequired");
        case STEP.phone: {
          if (!parsePhoneInput(phone.trim())) return t("auth.signup.errPhoneInvalid");
          return phoneConsent ? null : t("auth.signup.errPhoneConsent");
        }
        case STEP.terms:
          return termsAccepted ? null : t("auth.signup.errTermsRequired");
        default:
          return null;
      }
    },
    [name, email, password, birthDate, school, phone, phoneConsent, termsAccepted, t],
  );

  const setError = useCallback((step: number, message: string | null) => {
    setErrors((prev) =>
      prev[step] === message ? prev : { ...prev, [step]: message },
    );
  }, []);

  /**
   * Wrap a field setter so typing clears the message under it.
   *
   * Without this a correction sits next to the complaint about the thing it
   * just corrected, which reads as the app not noticing. Errors come back on
   * the next Continue, so nothing is lost by retracting one early.
   */
  const answering = useCallback(
    <T,>(step: number, set: (next: T) => void) =>
      (next: T) => {
        set(next);
        setError(step, null);
      },
    [setError],
  );

  const advance = useCallback(
    (from: number) => {
      const problem = validate(from);
      setError(from, problem);
      if (problem) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
          () => {},
        );
        return;
      }
      openAndGo(from + 1);
    },
    [validate, setError, openAndGo],
  );

  const skipPhone = useCallback(() => {
    // Both halves or neither: a number typed without the tick must not survive.
    setPhone("");
    setPhoneConsent(false);
    setError(STEP.phone, null);
    openAndGo(STEP.phone + 1);
  }, [setError, openAndGo]);

  // ── The payload, and the recap that must agree with it ───────────────────
  const storedPhone = useMemo(
    () => (phoneConsent ? parsePhoneInput(phone.trim()) : ""),
    [phone, phoneConsent],
  );

  // Drives the field's green rule. Deliberately the full test, not just "does
  // it parse" — a well-formed date from someone who is 16 is not a good answer,
  // and showing it green would say it was.
  const birthDateOk = useMemo(() => {
    const iso = parseBirthDateInput(birthDate);
    return Boolean(iso) && calculateAgeFromBirthDate(iso) >= MIN_AGE;
  }, [birthDate]);

  const reviewRows = useMemo<ReviewRow[]>(
    () => [
      {
        key: "name",
        label: t("auth.signup.nameLabel"),
        value: name.trim(),
        step: STEP.name,
      },
      {
        key: "email",
        label: t("auth.signup.emailLabel"),
        value: email.trim(),
        step: STEP.email,
      },
      {
        key: "password",
        label: t("auth.signup.passwordLabel"),
        value: "•".repeat(Math.min(password.length, 12)),
        step: STEP.password,
      },
      {
        key: "birth",
        label: t("auth.signup.birthDateLabel"),
        value: formatBirthDateForDisplay(parseBirthDateInput(birthDate)),
        step: STEP.birthDate,
      },
      {
        key: "school",
        label: t("auth.signup.schoolLabel"),
        value: school.trim(),
        step: STEP.school,
      },
      {
        key: "phone",
        label: t("auth.signup.phoneLabel"),
        // Built from `storedPhone`, not from the field: an unconsented number is
        // dropped by the write, and the recap must not promise otherwise.
        value: storedPhone
          ? formatPhoneForDisplay(storedPhone)
          : t("auth.signup.reviewPhoneNone"),
        step: STEP.phone,
      },
    ],
    [name, email, password, birthDate, school, storedPhone, t],
  );

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleAppleSignup = async () => {
    if (isSubmitting) return;
    try {
      setSubmitting(true);
      const appleResult = await requestAppleCredential();
      // Apple credentials are one-time-use, so this cannot be deferred to a
      // later page: authenticate now.
      const cred = await signInToFirebaseWithApple(
        appleResult.identityToken,
        appleResult.rawNonce,
      );

      // The profile has to be written in this same click. The root layout swaps
      // to the authenticated stack the moment Firebase auth fires, which
      // unmounts this screen — there is no later render to write from. Birth
      // date and school are collected afterwards in Profile Settings.
      const displayName =
        [appleResult.fullName?.givenName, appleResult.fullName?.familyName]
          .filter(Boolean)
          .join(" ") || cred.user.displayName || "";
      const token = await cred.user.getIdToken(true);
      await createUserProfile(cred.user.uid, token, {
        name: displayName,
        // `cred.user.email` first, not Apple's copy. The rules now require this
        // field to equal the address in the ID token, and Apple hands back
        // whatever casing the user's account carries — which may not match. The
        // token-backed value is the one the write is checked against, and on a
        // Hide My Email account both are the same relay address anyway.
        //
        // Note this stores the address as authenticated, NOT canonicalised. The
        // canonical form is the mailbox claim and lives in `emailIndex`, written
        // server-side by the blocking function, which sees this path too.
        email: cred.user.email ?? appleResult.email ?? "",
        birthDate: "",
        school: "",
      });

      // Claim a slot on this device. A refusal means the server has already
      // deleted the account, so there is nothing to navigate into.
      const claim = await registerDevice(token);
      if (!claim.ok) {
        setDeviceBlocked(true);
        return;
      }

      router.replace("/onboardingScreen");
    } catch (err) {
      const authError = resolveAuthError(err, t, t("auth.signup.appleSigninFailed"));
      Alert.alert(authError.title, authError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAccount = async () => {
    if (isSubmitting) return;

    // Everything is re-checked here because `unlocked` is monotonic: an answer
    // could have been edited after its page was cleared.
    for (let step = 0; step <= STEP.terms; step++) {
      const problem = validate(step);
      if (problem) {
        setError(step, problem);
        goTo(step);
        return;
      }
    }

    try {
      setSubmitting(true);

      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      const cred = await signUp(trimmedName, trimmedEmail, password);
      const token = await cred.user.getIdToken();

      await createUserProfile(cred.user.uid, token, {
        name: trimmedName,
        // The auth account is created under the canonical address (one account
        // per mailbox — utils/emailIdentity), so the profile doc must record the
        // same string or `users/{uid}.email` drifts from `auth.email`.
        email: cred.user.email ?? normalizeEmail(trimmedEmail),
        birthDate: parseBirthDateInput(birthDate),
        school: school.trim(),
        ...(storedPhone ? { phone: storedPhone } : {}),
      });

      // The enforcement half of the per-device cap. Deliberately after the
      // profile write and before navigation: on a refusal the server has
      // already removed both the account and the document, and the only
      // correct thing left to do is say so rather than walk the user into an
      // app they no longer have an account for.
      const claim = await registerDevice(token);
      if (!claim.ok) {
        setDeviceBlocked(true);
        return;
      }

      router.replace("/onboardingScreen");
    } catch (err) {
      const code = String((err as { code?: string })?.code ?? "");
      if (
        code === "auth/email-already-in-use" ||
        code === "auth/account-exists-with-different-credential"
      ) {
        // One account per mailbox. Send them back to the email page with the
        // message attached to the field, plus the two things they can do.
        setError(STEP.email, t("auth.signup.errEmailTaken"));
        goTo(STEP.email);
        Alert.alert(t("auth.signup.emailTakenTitle"), t("auth.signup.emailTakenMsg"), [
          { text: t("auth.signup.emailTakenChange"), style: "cancel" },
          {
            text: t("auth.signup.emailTakenLogin"),
            onPress: () => router.replace("/(auth)/login"),
          },
        ]);
        return;
      }

      const authError = resolveAuthError(err, t, t("auth.signup.signupFailed"));
      if (authError.retryable) {
        Alert.alert(authError.title, authError.message, [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.retry"), onPress: handleCreateAccount },
        ]);
        return;
      }
      Alert.alert(authError.title, authError.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const renderPages = (pageProps: StepPageProps) => [
    <TextStep
      key="name"
      {...pageProps}
      ask={t("auth.signup.nameAsk")}
      aside={t("auth.signup.nameAside")}
      label={t("auth.signup.nameLabel")}
      value={name}
      onChangeText={answering(STEP.name, setName)}
      error={errors[STEP.name]}
      valid={Boolean(name.trim())}
      editable={!isSubmitting}
      autoCapitalize="words"
      autoComplete="given-name"
      textContentType="givenName"
      returnKeyType="next"
      onSubmitEditing={() => advance(STEP.name)}
    >
      {Platform.OS === "ios" ? (
        <View style={styles.apple}>
          <Text style={styles.or} maxFontSizeMultiplier={FONT_CAP.chrome}>
            {t("common.or")}
          </Text>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={14}
            style={styles.appleBtn}
            onPress={handleAppleSignup}
          />
        </View>
      ) : null}
    </TextStep>,

    <TextStep
      key="email"
      {...pageProps}
      ask={t("auth.signup.emailAsk")}
      aside={t("auth.signup.emailAside")}
      label={t("auth.signup.emailLabel")}
      value={email}
      onChangeText={answering(STEP.email, setEmail)}
      error={errors[STEP.email]}
      valid={isValidEmailFormat(email.trim())}
      editable={!isSubmitting}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="email-address"
      autoComplete="email"
      textContentType="emailAddress"
      returnKeyType="next"
      onSubmitEditing={() => advance(STEP.email)}
    />,

    <PasswordStep
      key="password"
      {...pageProps}
      value={password}
      onChangeText={answering(STEP.password, setPassword)}
      error={errors[STEP.password]}
      valid={isPasswordValid(password)}
      editable={!isSubmitting}
    />,

    <TextStep
      key="birth"
      {...pageProps}
      ask={t("auth.signup.birthDateAsk")}
      aside={t("auth.signup.birthDateAside")}
      label={t("auth.signup.birthDateLabel")}
      value={birthDate}
      onChangeText={answering(STEP.birthDate, (next: string) =>
        setBirthDate(autoFormatDateInput(next)),
      )}
      placeholder={t("auth.signup.birthDatePlaceholder")}
      error={errors[STEP.birthDate]}
      valid={birthDateOk}
      editable={!isSubmitting}
      keyboardType="number-pad"
      maxLength={10}
      returnKeyType="next"
      onSubmitEditing={() => advance(STEP.birthDate)}
    />,

    <SchoolStep
      key="school"
      {...pageProps}
      value={school}
      onChange={answering(STEP.school, setSchool)}
      error={errors[STEP.school]}
      editable={!isSubmitting}
    />,

    <PhoneStep
      key="phone"
      {...pageProps}
      value={phone}
      onChangeText={answering(STEP.phone, setPhone)}
      consent={phoneConsent}
      onConsentChange={answering(STEP.phone, setPhoneConsent)}
      error={errors[STEP.phone]}
      valid={Boolean(storedPhone)}
      editable={!isSubmitting}
    />,

    <TermsStep
      key="terms"
      {...pageProps}
      accepted={termsAccepted}
      onOpen={() => setShowTermsModal(true)}
      error={errors[STEP.terms]}
    />,

    <ReviewStep key="review" {...pageProps} rows={reviewRows} onEdit={goTo} />,
  ];

  if (deviceBlocked) {
    return <DeviceLimitScreen onBack={() => router.replace("/(auth)/login")} />;
  }

  return (
    <>
      <FlowShell
        ref={shell}
        count={TOTAL}
        renderPages={renderPages}
        index={index}
        onIndexChange={setIndex}
        unlocked={unlocked}
        busy={isSubmitting}
        busyLabel={t("auth.signup.creatingAccount")}
        primaryLabel={
          index === STEP.review
            ? t("auth.signup.createAccountBtn")
            : t("auth.signup.continueBtn")
        }
        onPrimary={() =>
          index === STEP.review ? handleCreateAccount() : advance(index)
        }
        sub={
          index === STEP.phone ? (
            <Pressable onPress={skipPhone} hitSlop={8} accessibilityRole="button">
              <Text style={styles.subText} maxFontSizeMultiplier={FONT_CAP.chrome}>
                {t("auth.signup.phoneSkip")}
              </Text>
            </Pressable>
          ) : index === STEP.name ? (
            <Pressable
              onPress={() => router.replace("/(auth)/login")}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.subText} maxFontSizeMultiplier={FONT_CAP.chrome}>
                {t("auth.signup.alreadyAccount")} {t("auth.signup.loginLink")}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.stepCount} maxFontSizeMultiplier={FONT_CAP.chrome}>
              {t("auth.signup.stepOf", { n: index + 1, total: TOTAL })}
            </Text>
          )
        }
      />

      {/* A sibling of the shell, never a child of a page: mounting it with the
          terms page would reset the scrolled-to-the-end flag that unlocks its
          accept box. */}
      <LegalTermsModal
        visible={showTermsModal}
        accepted={termsAccepted}
        onAcceptedChange={(next) => {
          setTermsAccepted(next);
          if (next) setError(STEP.terms, null);
        }}
        onClose={() => setShowTermsModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  subText: { color: P.textMuted, fontSize: 13, fontWeight: "600" },
  stepCount: { color: P.textDim, fontSize: 12.5, fontWeight: "600" },
  apple: { marginTop: 26, gap: 14 },
  or: { color: P.textDim, fontSize: 12.5, fontWeight: "600" },
  appleBtn: { height: 50, width: "100%" },
});
