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
import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { normalizeAuthError } from "@/services/authService";

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signInWithApple, authActionLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isSubmitting = submitting || authActionLoading;

  const handleLogin = async () => {
    if (isSubmitting) return;
    try {
      setSubmitting(true);
      if (!email.trim() || !password) {
        Alert.alert("Missing info", "Please enter email and password.");
        return;
      }
      await signIn(email, password);
      router.replace("/(tabs)");
    } catch (err) {
      const authError = normalizeAuthError(err, "Login failed");
      if (authError.retryable) {
        Alert.alert(authError.title, authError.message, [
          { text: "Cancel", style: "cancel" },
          { text: "Retry", onPress: handleLogin },
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
      void fetch(firestoreDocumentUrl("users", cred.user.uid), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fields: {
            name:      { stringValue: cred.user.displayName ?? "" },
            email:     { stringValue: cred.user.email ?? "" },
            createdAt: { stringValue: new Date().toISOString() },
          },
        }),
      });
      router.replace("/(tabs)");
    } catch (err) {
      const authError = normalizeAuthError(err, "Apple login failed");
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
        </LinearGradient>

        {/* Form area */}
        <View style={styles.body}>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Log in to continue with UniLift</Text>

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

          {/* Login button */}
          <Pressable onPress={handleLogin} disabled={isSubmitting} style={{ marginTop: 8 }}>
            <LinearGradient
              colors={["#7C3AED", "#2563eb"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.button, isSubmitting && styles.buttonDisabled]}
            >
              {isSubmitting ? (
                <View style={styles.buttonContent}>
                  <ActivityIndicator color="#fff" />
                  <Text style={[styles.buttonText, { marginLeft: 8 }]}>Logging in...</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>Log In</Text>
              )}
            </LinearGradient>
          </Pressable>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
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
            No account? <Text style={{ fontWeight: "700" }}>Sign up</Text>
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
});
