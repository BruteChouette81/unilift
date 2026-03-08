import { OAuthProvider, signInWithCredential } from "firebase/auth";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Alert,
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
import { auth } from "@/firebaseConfig";
import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { normalizeAuthError } from "@/services/authService";

const PREFERENCE_OPTIONS: { key: string; label: string }[] = [
  { key: "no_smoking", label: "No Smoking" },
  { key: "music_ok", label: "Music OK" },
  { key: "quiet_ride", label: "Quiet Ride" },
  { key: "pets_ok", label: "Pets OK" },
  { key: "chatty", label: "Chatty" },
  { key: "fast_driver", label: "Fast Driver" },
];

export default function SignupScreen() {
  const router = useRouter();
  const { signUp, authActionLoading } = useAuth();

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
  const [preferences, setPreferences] = useState<string[]>([]);

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

  const togglePreference = (key: string) => {
    setPreferences((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  };

  const handleContinue = () => {
    if (!name.trim() || !email.trim() || !password) {
      Alert.alert("Missing info", "Please fill in name, email and password.");
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
        Alert.alert("Apple Sign-In failed", "No identity token received. Please try again.");
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
      const authError = normalizeAuthError(err, "Apple signup failed");
      Alert.alert(authError.title, authError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const saveUserProfile = async (
    uid: string,
    token: string,
    data: { name: string; email: string; age: number; school: string; preferences: string[] },
  ) => {
    const res = await fetch(firestoreDocumentUrl("users", uid), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fields: {
          name:        { stringValue: data.name },
          email:       { stringValue: data.email },
          createdAt:   { stringValue: new Date().toISOString() },
          age:         { integerValue: data.age },
          school:      { stringValue: data.school },
          preferences: {
            arrayValue: {
              values: data.preferences.map((p) => ({ stringValue: p })),
            },
          },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }
  };

  const handleGetStarted = async () => {
    if (isSubmitting) return;
    try {
      setSubmitting(true);

      const profilePayload = {
        age:         parseInt(age) || 0,
        school:      school.trim(),
        preferences,
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
      const authError = normalizeAuthError(err, "Signup failed");
      if (authError.retryable) {
        Alert.alert(authError.title, authError.message, [
          { text: "Cancel", style: "cancel" },
          { text: "Retry", onPress: handleGetStarted },
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
          colors={["#3b0764", "#1e3a8a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.logoCircle}>
            <Ionicons name="flash" size={36} color="#fff" />
          </View>
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
              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>Sign up to start using UniLift</Text>

              {/* Name */}
              <View style={[styles.inputRow, nameFocused && styles.inputRowFocused]}>
                <Ionicons name="person-outline" size={20} color={authColors.muted} style={styles.inputIcon} />
                <TextInput
                  placeholder="Name"
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
                <Ionicons name="mail-outline" size={20} color={authColors.muted} style={styles.inputIcon} />
                <TextInput
                  placeholder="Email"
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
                <Ionicons name="lock-closed-outline" size={20} color={authColors.muted} style={styles.inputIcon} />
                <TextInput
                  placeholder="Password"
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
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={authColors.muted}
                  />
                </Pressable>
              </View>

              {/* Continue */}
              <Pressable onPress={handleContinue} disabled={isSubmitting} style={{ marginTop: 8 }}>
                <LinearGradient
                  colors={["#7C3AED", "#2563eb"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>Continue</Text>
                </LinearGradient>
              </Pressable>

              {/* Divider */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
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
                Already have an account? <Text style={{ fontWeight: "700" }}>Log in</Text>
              </Text>
            </>
          ) : (
            <>
              {/* Step 2 header */}
              <View style={styles.step2Header}>
                <Pressable onPress={() => setStep(1)} hitSlop={8} style={styles.backButton}>
                  <Ionicons name="arrow-back" size={22} color={authColors.purpleLight} />
                </Pressable>
                <Text style={styles.stepIndicator}>2 / 2</Text>
              </View>

              <Text style={styles.title}>Your Profile</Text>
              <Text style={styles.subtitle}>Help others know who they're riding with</Text>

              {/* Age */}
              <View style={[styles.inputRow, ageFocused && styles.inputRowFocused]}>
                <Ionicons name="calendar-outline" size={20} color={authColors.muted} style={styles.inputIcon} />
                <TextInput
                  placeholder="Age"
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
                <Ionicons name="school-outline" size={20} color={authColors.muted} style={styles.inputIcon} />
                <TextInput
                  placeholder="University or college"
                  placeholderTextColor={authColors.placeholder}
                  style={styles.textInput}
                  value={school}
                  onChangeText={setSchool}
                  editable={!isSubmitting}
                  onFocus={() => setSchoolFocused(true)}
                  onBlur={() => setSchoolFocused(false)}
                />
              </View>

              {/* Ride preferences */}
              <Text style={styles.prefsLabel}>Ride Preferences</Text>
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
              </View>

              {/* Get Started */}
              <Pressable onPress={handleGetStarted} disabled={isSubmitting} style={{ marginTop: 24 }}>
                <LinearGradient
                  colors={["#7C3AED", "#2563eb"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.button, isSubmitting && styles.buttonDisabled]}
                >
                  {isSubmitting ? (
                    <View style={styles.buttonContent}>
                      <ActivityIndicator color="#fff" />
                      <Text style={[styles.buttonText, { marginLeft: 8 }]}>Creating account...</Text>
                    </View>
                  ) : (
                    <Text style={styles.buttonText}>Get Started</Text>
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
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  wordmark: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1,
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
    borderColor: "rgba(124, 58, 237, 0.7)",
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
    borderColor: "rgba(124, 58, 237, 0.3)",
    backgroundColor: "rgba(124, 58, 237, 0.05)",
  },
  chipSelected: {
    backgroundColor: "#7C3AED",
    borderColor: "#7C3AED",
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
