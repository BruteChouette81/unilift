import { OAuthProvider, signInWithCredential } from "firebase/auth";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Alert,
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
import { authColors } from "@/constants/auth-theme";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { auth } from "@/firebaseConfig";
import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { normalizeAuthError } from "@/services/authService";

// ─── Legal Terms Placeholder ──────────────────────────────────────────────────
// TODO: Replace this string with your actual legal terms text.
const LEGAL_TERMS_TEXT = `[PASTE YOUR LEGAL TERMS HERE]

Exemple / Example:

En utilisant UniLift, vous acceptez nos conditions d'utilisation. UniLift est une plateforme de covoiturage entre étudiants. Nous ne sommes pas responsables des incidents survenus pendant les trajets. Les utilisateurs s'engagent à respecter les règles de conduite de la communauté.

By using UniLift, you agree to our terms of service. UniLift is a student carpooling platform. We are not liable for incidents occurring during rides. Users agree to follow community conduct guidelines.`;

export default function SignupScreen() {
  const router = useRouter();
  const { signUp, authActionLoading } = useAuth();
  const { t } = useLanguage();

  // TODO v2: preferences feature
  // const PREFERENCE_OPTIONS = [
  //   { key: "no_smoking", label: t("auth.signup.preferences.no_smoking") },
  //   { key: "music_ok", label: t("auth.signup.preferences.music_ok") },
  //   { key: "quiet_ride", label: t("auth.signup.preferences.quiet_ride") },
  //   { key: "pets_ok", label: t("auth.signup.preferences.pets_ok") },
  //   { key: "chatty", label: t("auth.signup.preferences.chatty") },
  //   { key: "fast_driver", label: t("auth.signup.preferences.fast_driver") },
  // ];

  // Navigation
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Step 2 fields
  const [age, setAge] = useState("");
  const [school, setSchool] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  // TODO v2: const [preferences, setPreferences] = useState<string[]>([]);

  // Apple flow — store token only; Firebase auth is deferred to step 2
  const [appleToken, setAppleToken] = useState<string | null>(null);
  const [appleDisplayName, setAppleDisplayName] = useState("");
  const [appleEmail, setAppleEmail] = useState("");

  // Focus states
  const [nameFocused, setNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [ageFocused, setAgeFocused] = useState(false);
  const [schoolFocused, setSchoolFocused] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const isSubmitting = submitting || authActionLoading;

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
      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!appleCredential.identityToken) {
        Alert.alert(t("auth.signup.appleSigninFailed"), t("auth.signup.appleNoToken"));
        return;
      }
      setAppleToken(appleCredential.identityToken);
      setAppleDisplayName(
        [appleCredential.fullName?.givenName, appleCredential.fullName?.familyName]
          .filter(Boolean)
          .join(" "),
      );
      setAppleEmail(appleCredential.email ?? "");
      setStep(2);
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
    data: { name: string; email: string; age: number; school: string },
  ) => {
    const res = await fetch(
      firestoreDocumentUrl("users", uid) +
        "?updateMask.fieldPaths=name&updateMask.fieldPaths=email&updateMask.fieldPaths=createdAt&updateMask.fieldPaths=age&updateMask.fieldPaths=school",
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
            age:       { integerValue: data.age },
            school:    { stringValue: data.school },
            // TODO v2: preferences: { arrayValue: { values: data.preferences.map((p) => ({ stringValue: p })) } },
          },
        }),
      },
    );

    if (!res.ok) {
      throw new Error(await res.text());
    }
  };

  const handleGetStarted = async () => {
    if (isSubmitting) return;
    if (!termsAccepted) {
      Alert.alert(t("auth.signup.termsTitle"), t("auth.signup.termsError"));
      return;
    }
    try {
      setSubmitting(true);

      const profilePayload = {
        age:    parseInt(age) || 0,
        school: school.trim(),
        // TODO v2: preferences,
      };

      if (appleToken) {
        // Apple flow — sign into Firebase now (deferred from step 1) then save profile
        const provider = new OAuthProvider("apple.com");
        const firebaseCredential = provider.credential({ idToken: appleToken });
        const userCred = await signInWithCredential(auth, firebaseCredential);
        const token = await userCred.user.getIdToken();

        await saveUserProfile(userCred.user.uid, token, {
          name:  appleDisplayName || userCred.user.displayName || "",
          email: appleEmail || userCred.user.email || "",
          ...profilePayload,
        });
        // Auth state change from signInWithCredential will navigate to tabs automatically
      } else {
        // Email flow
        const trimmedName  = name.trim();
        const trimmedEmail = email.trim();
        const cred  = await signUp(trimmedName, trimmedEmail, password);
        const token = await cred.user.getIdToken();

        await saveUserProfile(cred.user.uid, token, {
          name:  trimmedName,
          email: trimmedEmail,
          ...profilePayload,
        });

        router.replace("/(tabs)");
      }
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
          </View>
        </LinearGradient>

        {/* Form area */}
        <View style={styles.body}>
          {step === 1 ? (
            <>
              <Text style={styles.title}>{t("auth.signup.title")}</Text>
              <Text style={styles.subtitle}>{t("auth.signup.subtitle")}</Text>

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
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
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
          ) : (
            <>
              {/* Step 2 header */}
              <View style={styles.step2Header}>
                <Pressable onPress={() => setStep(1)} hitSlop={8} style={styles.backButton}>
                  <Text style={{fontSize: 20}}>←</Text>
                </Pressable>
                <Text style={styles.stepIndicator}>{t("auth.signup.stepIndicator")}</Text>
              </View>

              <Text style={styles.title}>{t("auth.signup.step2Title")}</Text>
              <Text style={styles.subtitle}>{t("auth.signup.step2Subtitle")}</Text>

              {/* Age */}
              <View style={[styles.inputRow, ageFocused && styles.inputRowFocused]}>
                <Text style={[{fontSize: 18}, styles.inputIcon]}>📅</Text>
                <TextInput
                  placeholder={t("auth.signup.agePlaceholder")}
                  placeholderTextColor={authColors.placeholder}
                  style={styles.textInput}
                  value={age}
                  onChangeText={(v) => setAge(v.replace(/[^0-9]/g, "").slice(0, 2))}
                  editable={!isSubmitting}
                  keyboardType="number-pad"
                  maxLength={2}
                  onFocus={() => setAgeFocused(true)}
                  onBlur={() => setAgeFocused(false)}
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
                  onFocus={() => setSchoolFocused(true)}
                  onBlur={() => setSchoolFocused(false)}
                />
              </View>

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

              {/* Get Started */}
              <Pressable onPress={handleGetStarted} disabled={isSubmitting} style={{ marginTop: 24 }}>
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
});
