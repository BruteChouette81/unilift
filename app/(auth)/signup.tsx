import { doc, setDoc } from "firebase/firestore";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { authColors, authStyles } from "@/constants/auth-theme";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/firebaseConfig";
import { normalizeAuthError } from "@/services/authService";

export default function SignupScreen() {
  const router = useRouter();
  const { signUp, signInWithApple, authActionLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isSubmitting = submitting || authActionLoading;

  const handleSignup = async () => {
    if (isSubmitting) return;

    try {
      setSubmitting(true);

      if (!email.trim() || !password || !name.trim()) {
        Alert.alert("Missing info", "Please fill in name, email and password.");
        return;
      }

      const trimmedEmail = email.trim();
      const trimmedName = name.trim();
      const cred = await signUp(trimmedName, trimmedEmail, password);

      void setDoc(doc(db, "users", cred.user.uid), {
        name: trimmedName,
        email: trimmedEmail,
        createdAt: new Date().toISOString(),
      }).catch(() => {
        Alert.alert(
          "Profile pending",
          "Account created, but profile save is delayed. Please check your internet.",
        );
      });

      router.replace("/(tabs)");
    } catch (err) {
      const authError = normalizeAuthError(err, "Signup failed");
      if (authError.retryable) {
        Alert.alert(authError.title, authError.message, [
          { text: "Cancel", style: "cancel" },
          { text: "Retry", onPress: handleSignup },
        ]);
        return;
      }
      Alert.alert(authError.title, authError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAppleSignup = async () => {
    if (isSubmitting) return;

    try {
      setSubmitting(true);
      const cred = await signInWithApple();

      void setDoc(
        doc(db, "users", cred.user.uid),
        {
          name: cred.user.displayName ?? "",
          email: cred.user.email ?? "",
          createdAt: new Date().toISOString(),
        },
        { merge: true },
      );

      router.replace("/(tabs)");
    } catch (err) {
      const authError = normalizeAuthError(err, "Apple signup failed");
      Alert.alert(authError.title, authError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={authStyles.container}>
      <View style={authStyles.card}>
        <Text style={authStyles.title}>Create Account</Text>
        <Text style={authStyles.subtitle}>Sign up to start using UniLift</Text>

        <TextInput
          placeholder="Name"
          placeholderTextColor={authColors.placeholder}
          style={authStyles.input}
          value={name}
          onChangeText={setName}
          editable={!isSubmitting}
        />
        <TextInput
          placeholder="Email"
          placeholderTextColor={authColors.placeholder}
          style={authStyles.input}
          value={email}
          onChangeText={setEmail}
          editable={!isSubmitting}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          placeholder="Password"
          placeholderTextColor={authColors.placeholder}
          secureTextEntry
          style={authStyles.input}
          value={password}
          onChangeText={setPassword}
          editable={!isSubmitting}
        />

        <Pressable
          style={[authStyles.button, isSubmitting && authStyles.buttonDisabled]}
          onPress={handleSignup}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <View style={authStyles.buttonContent}>
              <ActivityIndicator color="#FFFFFF" />
              <Text style={[authStyles.buttonText, authStyles.loadingText]}>
                Creating account...
              </Text>
            </View>
          ) : (
            <Text style={authStyles.buttonText}>Sign Up</Text>
          )}
        </Pressable>

        {Platform.OS === "ios" && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={10}
            style={{ width: "100%", height: 48, marginTop: 12 }}
            onPress={handleAppleSignup}
          />
        )}

        <Text
          onPress={() => !isSubmitting && router.replace("/login")}
          style={authStyles.link}
        >
          Already have an account? Log in
        </Text>
      </View>
    </View>
  );
}
