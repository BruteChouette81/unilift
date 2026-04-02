import {
  type Auth,
  createUserWithEmailAndPassword,
  OAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithCredential,
  signOut,
  updateProfile,
  type UserCredential,
} from "firebase/auth";
import * as AppleAuthentication from "expo-apple-authentication";
import { auth } from "@/firebaseConfig";
const firebaseAuth: Auth = auth;

const REQUEST_TIMEOUT_MS = 15000;

type AuthAction = "login" | "signup" | "logout";
type AuthErrorLike = { code?: string; message?: string };

export type NormalizedAuthError = {
  title: string;
  message: string;
  retryable: boolean;
};

const withTimeout = async <T>(
  promise: Promise<T>,
  action: AuthAction,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${action} timed out. Check internet and try again.`));
      }, timeoutMs);
    }),
  ]);
};

const createAuthError = (code: string, message: string) => {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  return error;
};

const isTimeoutError = (message: string) => message.toLowerCase().includes("timed out");

export const normalizeAuthError = (
  error: unknown,
  fallbackTitle = "Authentication failed",
): NormalizedAuthError => {
  const typed = (error ?? {}) as AuthErrorLike;
  const code = String(typed.code ?? "");
  const message = typed.message ?? "";

  if (isTimeoutError(message)) {
    return {
      title: fallbackTitle,
      message: "Request timed out. Check your internet and try again.",
      retryable: true,
    };
  }

  switch (code) {
    case "ERR_REQUEST_CANCELED":
      return {
        title: fallbackTitle,
        message: "Apple Sign-In was cancelled.",
        retryable: false,
      };
    case "auth/request-in-progress":
      return {
        title: "Please wait",
        message: "An authentication request is already in progress.",
        retryable: false,
      };
    case "auth/missing-input":
      return {
        title: fallbackTitle,
        message: "Please fill all required fields.",
        retryable: false,
      };
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return {
        title: fallbackTitle,
        message: "Invalid email or password.",
        retryable: false,
      };
    case "auth/invalid-email":
      return {
        title: fallbackTitle,
        message: "Please enter a valid email address.",
        retryable: false,
      };
    case "auth/email-already-in-use":
      return {
        title: fallbackTitle,
        message: "This email is already in use.",
        retryable: false,
      };
    case "auth/weak-password":
      return {
        title: fallbackTitle,
        message: "Password is too weak.",
        retryable: false,
      };
    case "auth/network-request-failed":
      return {
        title: "Network error",
        message: "Check your internet connection and try again.",
        retryable: true,
      };
    case "auth/too-many-requests":
      return {
        title: fallbackTitle,
        message: "Too many attempts. Please wait a moment and try again.",
        retryable: true,
      };
    case "auth/user-disabled":
      return {
        title: fallbackTitle,
        message: "This account has been disabled.",
        retryable: false,
      };
    case "auth/operation-not-allowed":
      return {
        title: fallbackTitle,
        message: "This sign-in method is not enabled.",
        retryable: false,
      };
    default:
      return {
        title: fallbackTitle,
        message: message || "Something went wrong. Please try again.",
        retryable: true,
      };
  }
};

export const mapAuthError = (error: unknown): string =>
  normalizeAuthError(error).message;

export const signInWithEmail = async (
  email: string,
  password: string,
): Promise<UserCredential> => {
  const trimmedEmail = email.trim();
  if (!trimmedEmail || !password) {
    throw createAuthError("auth/missing-input", "Please enter email and password.");
  }

  return await withTimeout(
    signInWithEmailAndPassword(firebaseAuth, trimmedEmail, password),
    "login",
  );
};

export const signInWithApple = async (): Promise<UserCredential> => {
  const isAvailable = await AppleAuthentication.isAvailableAsync();
  if (!isAvailable) {
    throw createAuthError(
      "auth/operation-not-allowed",
      "Apple Sign-In is not available on this device.",
    );
  }

  const appleCredential = await withTimeout(
    AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    }),
    "login",
  );

  if (!appleCredential.identityToken) {
    throw createAuthError(
      "auth/invalid-credential",
      "Apple Sign-In did not return an identity token.",
    );
  }

  const provider = new OAuthProvider("apple.com");
  const firebaseCredential = provider.credential({
    idToken: appleCredential.identityToken,
  });

  return await withTimeout(
    signInWithCredential(firebaseAuth, firebaseCredential),
    "login",
  );
};

export const signUpWithEmail = async (
  name: string,
  email: string,
  password: string,
): Promise<UserCredential> => {
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  if (!trimmedName || !trimmedEmail || !password) {
    throw createAuthError(
      "auth/missing-input",
      "Please fill in name, email and password.",
    );
  }

  const credential = await withTimeout(
    createUserWithEmailAndPassword(firebaseAuth, trimmedEmail, password),
    "signup",
  );

  if (firebaseAuth.currentUser && trimmedName) {
    await withTimeout(
      updateProfile(firebaseAuth.currentUser, { displayName: trimmedName }),
      "signup",
    );
  }

  return credential;
};

export const resetPassword = async (email: string): Promise<void> => {
  const trimmed = email.trim();
  if (!trimmed) throw createAuthError("auth/missing-input", "Please enter your email address.");
  await withTimeout(sendPasswordResetEmail(firebaseAuth, trimmed), "login");
};

export const signOutUser = async (): Promise<void> => {
  await withTimeout(signOut(firebaseAuth), "logout");
};

export const ensureSessionIsValid = async (): Promise<boolean> => {
  const user = firebaseAuth.currentUser;
  if (!user) return false;

  try {
    await user.reload();
    await user.getIdToken();
    return true;
  } catch {
    return false;
  }
};
