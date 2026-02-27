import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { authColors, authStyles } from "@/constants/auth-theme";
import { useAuth } from "@/context/AuthContext";
import { normalizeAuthError } from "@/services/authService";

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, authActionLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  return (
    <View style={authStyles.container}>
      <View style={authStyles.card}>
        <Text style={authStyles.title}>Welcome Back</Text>
        <Text style={authStyles.subtitle}>Log in to continue with UniLift</Text>

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
          onPress={handleLogin}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <View style={authStyles.buttonContent}>
              <ActivityIndicator color="#FFFFFF" />
              <Text style={[authStyles.buttonText, authStyles.loadingText]}>
                Logging in...
              </Text>
            </View>
          ) : (
            <Text style={authStyles.buttonText}>Log In</Text>
          )}
        </Pressable>
        <Text
          onPress={() => !isSubmitting && router.replace("/signup")}
          style={authStyles.link}
        >
          Don&apos;t have an account? Sign up
        </Text>
      </View>
    </View>
  );
}
