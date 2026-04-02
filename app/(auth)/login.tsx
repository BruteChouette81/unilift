import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authColors } from "@/constants/auth-theme";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { normalizeAuthError, resetPassword } from "@/services/authService";

const MAX_ATTEMPTS      = 5;
const LOCKOUT_MS        = 30 * 1000; // 30 seconds
const STORAGE_KEY       = "unilift.login.ratelimit";

type RateLimitState = { attempts: number; lockedUntil: number };

async function loadRateLimit(): Promise<RateLimitState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { attempts: 0, lockedUntil: 0 };
  } catch {
    return { attempts: 0, lockedUntil: 0 };
  }
}

async function saveRateLimit(state: RateLimitState) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function clearRateLimit() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signInWithApple, authActionLoading } = useAuth();
  const { t } = useLanguage();

  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [submitting, setSubmitting]     = useState(false);

  // Rate limiting
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const [lockSecondsLeft, setLockSecondsLeft] = useState(0);
  const lockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLocked     = lockSecondsLeft > 0;
  const isSubmitting = submitting || authActionLoading || isLocked;

  // Load persisted rate-limit state on mount
  useEffect(() => {
    loadRateLimit().then((state) => {
      const now = Date.now();
      if (state.lockedUntil > now) {
        const secs = Math.ceil((state.lockedUntil - now) / 1000);
        setLockSecondsLeft(secs);
        setAttemptsLeft(0);
        startCountdown(secs);
      } else {
        setAttemptsLeft(MAX_ATTEMPTS - state.attempts);
      }
    });
    return () => { if (lockTimerRef.current) clearInterval(lockTimerRef.current); };
  }, []);

  function startCountdown(seconds: number) {
    if (lockTimerRef.current) clearInterval(lockTimerRef.current);
    let remaining = seconds;
    lockTimerRef.current = setInterval(() => {
      remaining -= 1;
      setLockSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(lockTimerRef.current!);
        lockTimerRef.current = null;
        // Reset attempts after lockout expires
        saveRateLimit({ attempts: 0, lockedUntil: 0 });
        setAttemptsLeft(MAX_ATTEMPTS);
      }
    }, 1000);
  }

  async function recordFailedAttempt() {
    const state = await loadRateLimit();
    const newAttempts = state.attempts + 1;
    if (newAttempts >= MAX_ATTEMPTS) {
      const lockedUntil = Date.now() + LOCKOUT_MS;
      await saveRateLimit({ attempts: newAttempts, lockedUntil });
      setAttemptsLeft(0);
      const secs = Math.ceil(LOCKOUT_MS / 1000);
      setLockSecondsLeft(secs);
      startCountdown(secs);
    } else {
      await saveRateLimit({ attempts: newAttempts, lockedUntil: 0 });
      setAttemptsLeft(MAX_ATTEMPTS - newAttempts);
    }
  }

  const handleLogin = async () => {
    if (isSubmitting) return;
    try {
      setSubmitting(true);
      if (!email.trim() || !password) {
        Alert.alert(t("auth.login.missingInfo"), t("auth.login.missingInfoMsg"));
        return;
      }
      await signIn(email, password);
      await clearRateLimit();
      router.replace("/(tabs)");
    } catch (err) {
      await recordFailedAttempt();
      const authError = normalizeAuthError(err, t("auth.login.loginFailed"));
      if (authError.retryable) {
        Alert.alert(authError.title, authError.message, [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.retry"), onPress: handleLogin },
        ]);
        return;
      }
      Alert.alert(authError.title, authError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAppleLogin = async () => {
    if (isSubmitting) return;
    try {
      setSubmitting(true);
      const cred = await signInWithApple();
      const token = await cred.user.getIdToken();
      void fetch(
        firestoreDocumentUrl("users", cred.user.uid) +
          "?updateMask.fieldPaths=name&updateMask.fieldPaths=email&updateMask.fieldPaths=createdAt",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            fields: {
              name:      { stringValue: cred.user.displayName ?? "" },
              email:     { stringValue: cred.user.email ?? "" },
              createdAt: { stringValue: new Date().toISOString() },
            },
          }),
        },
      );
      await clearRateLimit();
      router.replace("/(tabs)");
    } catch (err) {
      const authError = normalizeAuthError(err, t("auth.login.appleLoginFailed"));
      Alert.alert(authError.title, authError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = () => {
    Alert.prompt(
      "Reset Password",
      "Enter your email address and we'll send you a reset link.",
      async (inputEmail) => {
        if (!inputEmail?.trim()) return;
        try {
          await resetPassword(inputEmail.trim());
          Alert.alert("Email sent", `A password reset link was sent to ${inputEmail.trim()}.`);
        } catch (err) {
          const authError = normalizeAuthError(err, "Reset failed");
          Alert.alert(authError.title, authError.message);
        }
      },
      "plain-text",
      email,
      "email-address",
    );
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
        </LinearGradient>

        {/* Form area */}
        <View style={styles.body}>
          <Text style={styles.title}>{t("auth.login.title")}</Text>
          <Text style={styles.subtitle}>{t("auth.login.subtitle")}</Text>

          {/* Lockout banner */}
          {isLocked && (
            <View style={styles.lockBanner}>
              <Text style={styles.lockIcon}>🔒</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.lockTitle}>Too many attempts</Text>
                <Text style={styles.lockSub}>Try again in {lockSecondsLeft}s</Text>
              </View>
            </View>
          )}

          {/* Attempts warning (not locked yet) */}
          {!isLocked && attemptsLeft < MAX_ATTEMPTS && attemptsLeft > 0 && (
            <View style={styles.warnBanner}>
              <Text style={styles.warnText}>
                {attemptsLeft} attempt{attemptsLeft !== 1 ? "s" : ""} remaining before temporary block
              </Text>
            </View>
          )}

          {/* Email */}
          <View style={[styles.inputRow, emailFocused && styles.inputRowFocused, isLocked && styles.inputRowDisabled]}>
            <Text style={[{ fontSize: 18 }, styles.inputIcon]}>📧</Text>
            <TextInput
              placeholder={t("auth.login.emailPlaceholder")}
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
          <View style={[styles.inputRow, passwordFocused && styles.inputRowFocused, isLocked && styles.inputRowDisabled]}>
            <Text style={[{ fontSize: 18 }, styles.inputIcon]}>🔒</Text>
            <TextInput
              placeholder={t("auth.login.passwordPlaceholder")}
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
              <Text style={{ fontSize: 18 }}>{showPassword ? "🙈" : "👁"}</Text>
            </Pressable>
          </View>

          {/* Forgot password */}
          <Pressable onPress={handleForgotPassword} style={styles.forgotRow}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>

          {/* Login button */}
          <Pressable onPress={handleLogin} disabled={isSubmitting} style={{ marginTop: 8 }}>
            <LinearGradient
              colors={isLocked ? ["#374151", "#374151"] : ["#FD165A", "#8938D5"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.button, isSubmitting && styles.buttonDisabled]}
            >
              {submitting && !isLocked ? (
                <View style={styles.buttonContent}>
                  <ActivityIndicator color="#fff" />
                  <Text style={[styles.buttonText, { marginLeft: 8 }]}>{t("auth.login.loggingIn")}</Text>
                </View>
              ) : isLocked ? (
                <Text style={styles.buttonText}>Locked — {lockSecondsLeft}s</Text>
              ) : (
                <Text style={styles.buttonText}>{t("auth.login.loginBtn")}</Text>
              )}
            </LinearGradient>
          </Pressable>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t("common.or")}</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Apple Sign-In */}
          {Platform.OS === "ios" && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={13}
              style={styles.appleButton}
              onPress={handleAppleLogin}
            />
          )}

          <Text
            onPress={() => !isSubmitting && router.replace("/signup")}
            style={styles.link}
          >
            {t("auth.login.noAccount")} <Text style={{ fontWeight: "700" }}>{t("auth.login.signUpLink")}</Text>
          </Text>
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
    paddingTop: 80,
    paddingBottom: 40,
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

  // ── Banners ──────────────────────────────────────────────────────────────────
  lockBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(248,113,113,0.1)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.3)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  lockIcon: { fontSize: 20 },
  lockTitle: { color: "#f87171", fontWeight: "700", fontSize: 14 },
  lockSub:   { color: "#f87171", fontSize: 12, opacity: 0.8 },
  warnBanner: {
    backgroundColor: "rgba(251,191,36,0.08)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.25)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  warnText: { color: "#fbbf24", fontSize: 12, fontWeight: "600", textAlign: "center" },

  // ── Inputs ───────────────────────────────────────────────────────────────────
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
  inputRowFocused:  { borderColor: "rgba(137, 56, 213, 0.7)" },
  inputRowDisabled: { opacity: 0.45 },
  inputIcon:  { marginRight: 10 },
  textInput: {
    flex: 1,
    color: authColors.inputText,
    fontSize: 15,
  },

  // ── Forgot password ──────────────────────────────────────────────────────────
  forgotRow: {
    alignSelf: "flex-end",
    marginTop: -6,
    marginBottom: 14,
    paddingVertical: 2,
  },
  forgotText: {
    color: authColors.purpleLight,
    fontSize: 13,
    fontWeight: "600",
  },

  // ── Buttons ──────────────────────────────────────────────────────────────────
  button: {
    height: 52,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.7 },
  buttonContent: { flexDirection: "row", alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.1)" },
  dividerText: { color: authColors.muted, marginHorizontal: 12, fontSize: 13 },

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
});
