import { authColors } from "@/constants/auth-theme";
import { LEGAL_TERMS_TEXT } from "@/constants/legalTerms";
import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import {
  normalizeAuthError,
  requestAppleCredential,
  signInToFirebaseWithApple,
} from "@/services/authService";
import { autoFormatDateInput, parseBirthDateInput } from "@/components/userHelper";
import { CERT_META, CERT_ORDER } from "@/constants/certifications";
import { Ionicons } from "@expo/vector-icons";
import WizardModal, { type WizardStep } from "@/components/wizard/wizard-modal";
import { useFirstRun } from "@/hooks/use-first-run";
import LanguageToggle from "@/components/language-toggle";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as AppleAuthentication from "expo-apple-authentication";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";


export default function SignupScreen() {
  const router = useRouter();
  const { signUp, authActionLoading } = useAuth();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  // TODO v2: preferences feature
  // const PREFERENCE_OPTIONS = [
  //   { key: "no_smoking", label: t("auth.signup.preferences.no_smoking") },
  //   { key: "music_ok", label: t("auth.signup.preferences.music_ok") },
  //   { key: "quiet_ride", label: t("auth.signup.preferences.quiet_ride") },
  //   { key: "pets_ok", label: t("auth.signup.preferences.pets_ok") },
  //   { key: "chatty", label: t("auth.signup.preferences.chatty") },
  //   { key: "fast_driver", label: t("auth.signup.preferences.fast_driver") },
  // ];

  const SCHOOLS = [
    'Cégep St-Foy',
    'Cégep Garneau',
    'Cégep Champlain St-Lawrence',
    'Cégep de Lévis',
    'Université Laval',
    'UQAR',
  ];

  // Navigation
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Step 2 fields
  const [birthDate, setBirthDate] = useState("");
  const [school, setSchool] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  // TODO v2: const [preferences, setPreferences] = useState<string[]>([]);

  // Focus states
  const [nameFocused, setNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [birthDateFocused, setBirthDateFocused] = useState(false);
  const [schoolFocused, setSchoolFocused] = useState(false);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const isSubmitting = submitting || authActionLoading;

  const filteredSchools = useMemo(() => {
    if (!school.trim()) return SCHOOLS;
    const lower = school.toLowerCase();
    return SCHOOLS.filter(s => s.toLowerCase().includes(lower));
  }, [school]);

  // First-run wizard: explains each part of the signup form.
  const wizard = useFirstRun("signup");
  const wizardSteps = useMemo<WizardStep[]>(() => [
    { icon: "sparkles-outline",      title: t("wizard.signup.step1Title"), highlight: t("wizard.signup.step1Highlight"), body: t("wizard.signup.step1Body") },
    { icon: "person-outline",        title: t("wizard.signup.step2Title"), body: t("wizard.signup.step2Body") },
    { icon: "school-outline",        title: t("wizard.signup.step3Title"), body: t("wizard.signup.step3Body") },
    { icon: "notifications-outline", title: t("wizard.signup.step4Title"), highlight: t("wizard.signup.step4Highlight"), body: t("wizard.signup.step4Body") },
    { icon: "ribbon-outline",        title: t("wizard.signup.step5Title"), body: t("wizard.signup.step5Body") },
  ], [t]);

  // Android hardware back button: step back through the form instead of
  // exiting the signup screen, mirroring the on-screen back arrows.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (isSubmitting) return true;
        if (step === 1) return false;
        setStep((s) => (s === 3 ? 2 : 1));
        return true;
      });
      return () => subscription.remove();
    }, [step, isSubmitting]),
  );

  // TODO v2: const togglePreference = (key: string) => { ... };

  const handleContinue = () => {
    if (!name.trim() || !email.trim() || !password) {
      Alert.alert(t("auth.signup.missingInfo"), t("auth.signup.missingInfoMsg"));
      return;
    }
    setStep(2);
  };

  const handleAppleSignup = async () => {
    if (isSubmitting) return;
    try {
      setSubmitting(true);
      const appleResult = await requestAppleCredential();
      // Authenticate with Firebase immediately — Apple credentials are one-time-use
      // and cannot be deferred to a later step without triggering invalid-credential errors.
      const cred = await signInToFirebaseWithApple(appleResult.identityToken, appleResult.rawNonce);

      // Save the Firestore profile in the same click. The root layout will
      // flip the auth stack to (tabs) as soon as Firebase auth fires, which
      // unmounts the signup step-2 form before it can render — so we must
      // create the profile here, not in a deferred step. Age / school are
      // collected later via Profile Settings for Apple users.
      const displayName =
        [appleResult.fullName?.givenName, appleResult.fullName?.familyName]
          .filter(Boolean)
          .join(" ") || cred.user.displayName || "";
      const userEmail = appleResult.email ?? cred.user.email ?? "";
      const token = await cred.user.getIdToken(true);
      await saveUserProfile(cred.user.uid, token, {
        name:      displayName,
        email:     userEmail,
        birthDate: "",
        school:    "",
      });

      // Apple sign-up from this screen is always a fresh account → onboarding.
      router.replace("/onboardingScreen");
    } catch (err) {
      const authError = normalizeAuthError(err, t("auth.signup.appleSigninFailed"));
      Alert.alert(authError.title, authError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const saveUserProfile = async (
    uid: string,
    token: string,
    data: { name: string; email: string; birthDate: string; school: string },
  ) => {
    const res = await fetch(
      firestoreDocumentUrl("users", uid) +
        "?updateMask.fieldPaths=name&updateMask.fieldPaths=email&updateMask.fieldPaths=createdAt&updateMask.fieldPaths=birthDate&updateMask.fieldPaths=school&updateMask.fieldPaths=driverModeEnabled",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fields: {
            name:      { stringValue: data.name },
            email:     { stringValue: data.email },
            createdAt: { stringValue: new Date().toISOString() },
            birthDate: { stringValue: data.birthDate },
            school:    { stringValue: data.school },
            // Driver mode is ON by default for new users; toggled from profile.
            driverModeEnabled: { booleanValue: true },
            // TODO v2: preferences: { arrayValue: { values: data.preferences.map((p) => ({ stringValue: p })) } },
          },
        }),
      },
    );

    if (!res.ok) {
      throw new Error(await res.text());
    }
  };

  // Step 2 → 3: gate on accepted terms, then advance to the (optional)
  // certification step. Account creation happens on step 3's "Get Started".
  const handleContinueToCertification = () => {
    if (!termsAccepted) {
      Alert.alert(t("auth.signup.termsTitle"), t("auth.signup.termsError"));
      return;
    }
    setStep(3);
  };

  const handleGetStarted = async () => {
    if (isSubmitting) return;
    if (!termsAccepted) {
      Alert.alert(t("auth.signup.termsTitle"), t("auth.signup.termsError"));
      return;
    }
    try {
      setSubmitting(true);

      const trimmedName  = name.trim();
      const trimmedEmail = email.trim();
      const cred  = await signUp(trimmedName, trimmedEmail, password);
      const token = await cred.user.getIdToken();

      await saveUserProfile(cred.user.uid, token, {
        name:      trimmedName,
        email:     trimmedEmail,
        birthDate: parseBirthDateInput(birthDate),
        school:    school.trim(),
        // TODO v2: preferences,
      });

      // New account → collect home address, driver availability and favorite
      // places so the app has useful data on first entry.
      router.replace("/onboardingScreen");
    } catch (err) {
      const authError = normalizeAuthError(err, t("auth.signup.signupFailed"));
      if (authError.retryable) {
        Alert.alert(authError.title, authError.message, [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.retry"), onPress: handleGetStarted },
        ]);
        return;
      }
      Alert.alert(authError.title, authError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Language toggle (floats above the header) */}
      <View style={[styles.languageToggleWrap, { top: insets.top + 8 }]} pointerEvents="box-none">
        <LanguageToggle />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Branded header */}
        <LinearGradient
          colors={["#2d0015", "#1c0038"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.wordmark}>UniLift</Text>

          {/* Step dots */}
          <View style={styles.dotsRow}>
            <View style={[styles.dot, step === 1 && styles.dotActive]} />
            <View style={[styles.dot, step === 2 && styles.dotActive]} />
            <View style={[styles.dot, step === 3 && styles.dotActive]} />
          </View>

          {/* Replay the explainer wizard */}
          <Pressable onPress={wizard.replay} hitSlop={8} style={styles.helpChip}>
            <Ionicons name="help-circle-outline" size={16} color="rgba(255,255,255,0.85)" />
            <Text style={styles.helpChipText}>{t("wizard.replay")}</Text>
          </Pressable>
        </LinearGradient>

        {/* Form area */}
        <View style={styles.body}>
          {step === 1 ? (
            <>
              <Text style={styles.title}>{t("auth.signup.title")}</Text>

              {/* Name */}
              <View style={[styles.inputRow, nameFocused && styles.inputRowFocused]}>
                <Text style={[{fontSize: 18}, styles.inputIcon]}>👤</Text>
                <TextInput
                  placeholder={t("auth.signup.namePlaceholder")}
                  placeholderTextColor={authColors.placeholder}
                  style={styles.textInput}
                  value={name}
                  onChangeText={setName}
                  editable={!isSubmitting}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                />
              </View>

              {/* Email */}
              <View style={[styles.inputRow, emailFocused && styles.inputRowFocused]}>
                <Text style={[{fontSize: 18}, styles.inputIcon]}>📧</Text>
                <TextInput
                  placeholder={t("auth.signup.emailPlaceholder")}
                  placeholderTextColor={authColors.placeholder}
                  style={styles.textInput}
                  value={email}
                  onChangeText={setEmail}
                  editable={!isSubmitting}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                />
              </View>

              {/* Password */}
              <View style={[styles.inputRow, passwordFocused && styles.inputRowFocused]}>
                <Text style={[{fontSize: 18}, styles.inputIcon]}>🔒</Text>
                <TextInput
                  placeholder={t("auth.signup.passwordPlaceholder")}
                  placeholderTextColor={authColors.placeholder}
                  secureTextEntry={!showPassword}
                  style={[styles.textInput, { flex: 1 }]}
                  value={password}
                  onChangeText={setPassword}
                  editable={!isSubmitting}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                  <Text style={{fontSize: 18}}>{showPassword ? "🙈" : "👁"}</Text>
                </Pressable>
              </View>

              {/* Continue */}
              <Pressable onPress={handleContinue} disabled={isSubmitting} style={{ marginTop: 8 }}>
                <LinearGradient
                  colors={["#FD165A", "#8938D5"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>{t("auth.signup.continueBtn")}</Text>
                </LinearGradient>
              </Pressable>

              {/* Divider */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t("common.or")}</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Apple Sign-Up */}
              {Platform.OS === "ios" && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={13}
                  style={styles.appleButton}
                  onPress={handleAppleSignup}
                />
              )}

              <Text
                onPress={() => !isSubmitting && router.replace("/login")}
                style={styles.link}
              >
                {t("auth.signup.alreadyAccount")} <Text style={{ fontWeight: "700" }}>{t("auth.signup.loginLink")}</Text>
              </Text>
            </>
          ) : step === 2 ? (
            <>
              {/* Step 2 header */}
              <View style={styles.step2Header}>
                <Pressable onPress={() => setStep(1)} hitSlop={8} style={styles.backButton}>
                  <Text style={{fontSize: 20}}>←</Text>
                </Pressable>
                <Text style={styles.stepIndicator}>{t("auth.signup.stepIndicator")}</Text>
              </View>

              <Text style={styles.title}>{t("auth.signup.step2Title")}</Text>

              {/* Birth Date */}
              <View style={[styles.inputRow, birthDateFocused && styles.inputRowFocused]}>
                <Text style={[{fontSize: 18}, styles.inputIcon]}>🎂</Text>
                <TextInput
                  placeholder={t("auth.signup.birthDatePlaceholder")}
                  placeholderTextColor={authColors.placeholder}
                  style={styles.textInput}
                  value={birthDate}
                  onChangeText={(v) => setBirthDate(autoFormatDateInput(v))}
                  editable={!isSubmitting}
                  keyboardType="number-pad"
                  maxLength={10}
                  onFocus={() => setBirthDateFocused(true)}
                  onBlur={() => setBirthDateFocused(false)}
                />
              </View>

              {/* School */}
              <View style={[styles.inputRow, schoolFocused && styles.inputRowFocused]}>
                <Text style={[{fontSize: 18}, styles.inputIcon]}>🎓</Text>
                <TextInput
                  placeholder={t("auth.signup.schoolPlaceholder")}
                  placeholderTextColor={authColors.placeholder}
                  style={styles.textInput}
                  value={school}
                  onChangeText={setSchool}
                  editable={!isSubmitting}
                  onFocus={() => {
                    setSchoolFocused(true);
                    setShowSchoolDropdown(true);
                  }}
                  onBlur={() => {
                    setSchoolFocused(false);
                    setShowSchoolDropdown(false);
                  }}
                />
              </View>
              {showSchoolDropdown && filteredSchools.length > 0 && (
                <View style={styles.dropdown}>
                  {filteredSchools.map((s, idx) => (
                    <Pressable
                      key={idx}
                      onPress={() => {
                        setSchool(s);
                        setShowSchoolDropdown(false);
                      }}
                      style={({ pressed }) => [styles.dropdownItem, pressed && styles.dropdownItemPressed]}
                    >
                      <Text style={styles.dropdownItemText}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {/* TODO v2: Ride preferences */}
              {/* <Text style={styles.prefsLabel}>{t("auth.signup.prefsLabel")}</Text>
              <View style={styles.chipsRow}>
                {PREFERENCE_OPTIONS.map((opt) => {
                  const selected = preferences.includes(opt.key);
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => togglePreference(opt.key)}
                      style={[styles.chip, selected && styles.chipSelected]}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View> */}

              {/* Terms & Conditions */}
              <Text style={styles.termsLabel}>{t("auth.signup.termsTitle")}</Text>
              <ScrollView
                style={styles.termsScroll}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                <Text style={styles.termsText}>{LEGAL_TERMS_TEXT}</Text>
              </ScrollView>

              <Pressable
                style={styles.checkboxRow}
                onPress={() => setTermsAccepted((v) => !v)}
              >
                <View style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}>
                  {termsAccepted && (
                    <Text style={{fontSize: 11}}>✓</Text>
                  )}
                </View>
                <Text style={styles.checkboxLabel}>{t("auth.signup.termsCheckbox")}</Text>
              </Pressable>

              {/* Continue to certification */}
              <Pressable onPress={handleContinueToCertification} disabled={isSubmitting} style={{ marginTop: 24 }}>
                <LinearGradient
                  colors={["#FD165A", "#8938D5"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>{t("auth.signup.continueBtn")}</Text>
                </LinearGradient>
              </Pressable>
            </>
          ) : (
            <>
              {/* Step 3 header */}
              <View style={styles.step2Header}>
                <Pressable onPress={() => setStep(2)} hitSlop={8} style={styles.backButton}>
                  <Text style={{ fontSize: 20 }}>←</Text>
                </Pressable>
                <Text style={styles.stepIndicator}>{t("auth.signup.certStepIndicator")}</Text>
              </View>

              <Text style={styles.title}>{t("cert.signup.title")}</Text>

              {/* Ranked preview: the trust levels, Adult → Student */}
              <View style={{ gap: 4, marginTop: 12, marginBottom: 20 }}>
                {CERT_ORDER.map((tier, i) => {
                  const meta = CERT_META[tier];
                  const reqKey =
                    tier === "adult" ? "cert.screen.adultReq" : "cert.screen.studentReq";
                  const last = i === CERT_ORDER.length - 1;
                  return (
                    <View key={tier}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <View
                          style={{
                            width: 34, height: 34, borderRadius: 17, borderWidth: 1.5,
                            borderColor: meta.color, backgroundColor: meta.color + "1f",
                            alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Text style={{ color: meta.color, fontWeight: "900", fontSize: 15 }}>{i + 1}</Text>
                        </View>
                        <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={18} color={meta.color} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: authColors.title, fontWeight: "700", fontSize: 14.5 }}>
                            {t(meta.labelKey)}
                          </Text>
                          <Text style={{ color: authColors.muted, fontSize: 12 }}>{t(reqKey)}</Text>
                        </View>
                      </View>
                      {!last && (
                        <View
                          style={{
                            width: 2, height: 12, marginLeft: 16, marginVertical: 2,
                            backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 1,
                          }}
                        />
                      )}
                    </View>
                  );
                })}
              </View>

              <Text style={[styles.subtitle, { marginTop: 4, marginBottom: 24 }]}>
                {t("cert.signup.laterNote")}
              </Text>

              {/* Get Started */}
              <Pressable onPress={handleGetStarted} disabled={isSubmitting}>
                <LinearGradient
                  colors={["#FD165A", "#8938D5"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.button, isSubmitting && styles.buttonDisabled]}
                >
                  {isSubmitting ? (
                    <View style={styles.buttonContent}>
                      <ActivityIndicator color="#fff" />
                      <Text style={[styles.buttonText, { marginLeft: 8 }]}>{t("auth.signup.creatingAccount")}</Text>
                    </View>
                  ) : (
                    <Text style={styles.buttonText}>{t("auth.signup.getStartedBtn")}</Text>
                  )}
                </LinearGradient>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>

      <WizardModal
        visible={wizard.shouldShow}
        steps={wizardSteps}
        onDone={wizard.markSeen}
        finalLabel={t("wizard.signup.finalCta")}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: authColors.screenBackground,
  },
  scroll: {
    flexGrow: 1,
  },
  header: {
    alignItems: "center",
    paddingTop: 70,
    paddingBottom: 32,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 10,
  },
  wordmark: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 1,
    textAlign: "center",
    marginBottom: 16,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 8,
  },
  helpChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  helpChipText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "600",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  dotActive: {
    backgroundColor: "#fff",
    width: 20,
  },
  body: {
    flex: 1,
    padding: 24,
    paddingTop: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: authColors.title,
    marginBottom: 6,
  },
  subtitle: {
    color: authColors.muted,
    fontSize: 14,
    marginBottom: 28,
  },
  step2Header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  backButton: {
    padding: 4,
  },
  stepIndicator: {
    color: authColors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: authColors.inputBackground,
    borderWidth: 1,
    borderColor: authColors.inputBorder,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  inputRowFocused: {
    borderColor: "rgba(137, 56, 213, 0.7)",
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    color: authColors.inputText,
    fontSize: 15,
  },
  button: {
    height: 52,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  dividerText: {
    color: authColors.muted,
    marginHorizontal: 12,
    fontSize: 13,
  },
  appleButton: {
    width: "100%",
    height: 52,
    marginBottom: 4,
  },
  link: {
    textAlign: "center",
    color: authColors.purpleLight,
    marginTop: 16,
    fontSize: 14,
  },
  termsLabel: {
    color: authColors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 20,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  termsScroll: {
    maxHeight: 160,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 12,
  },
  termsText: {
    color: authColors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "rgba(137, 56, 213, 0.5)",
    backgroundColor: "rgba(137, 56, 213, 0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: "#8938D5",
    borderColor: "#8938D5",
  },
  checkboxLabel: {
    flex: 1,
    color: authColors.muted,
    fontSize: 14,
  },
  prefsLabel: {
    color: authColors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.3)",
    backgroundColor: "rgba(137, 56, 213, 0.05)",
  },
  chipSelected: {
    backgroundColor: "#8938D5",
    borderColor: "#8938D5",
  },
  chipText: {
    color: authColors.muted,
    fontSize: 13,
    fontWeight: "500",
  },
  chipTextSelected: {
    color: "#fff",
  },

  // ── Language toggle ──────────────────────────────────────────────────────────
  languageToggleWrap: {
    position: "absolute",
    right: 16,
    zIndex: 20,
  },

  // ── School dropdown ───────────────────────────────────────────────────────
  dropdown: {
    backgroundColor: authColors.inputBackground,
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.7)",
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    marginBottom: 14,
    marginTop: -14,
    paddingVertical: 8,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  dropdownItemPressed: {
    backgroundColor: "rgba(137, 56, 213, 0.1)",
  },
  dropdownItemText: {
    color: authColors.inputText,
    fontSize: 15,
  },
});
