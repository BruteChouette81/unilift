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
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { auth } from "@/firebaseConfig";
import { emailSignInCandidates, normalizeEmail } from "@/utils/emailIdentity";
const firebaseAuth: Auth = auth;

const REQUEST_TIMEOUT_MS = 15000;

// Sign-in failures that mean "this exact address / credential pair is not a
// match" — the only ones where retrying under the canonical address can help.
const RETRY_WITH_CANONICAL_EMAIL_CODES = new Set<string>([
  "auth/user-not-found",
  "auth/invalid-credential",
  "auth/wrong-password",
]);

type AuthAction = "login" | "signup" | "logout";
type AuthErrorLike = { code?: string; message?: string };

type NormalizedAuthError = {
  title: string;
  message: string;
  retryable: boolean;
  /**
   * i18n keys for the copy above. `title`/`message` hold the English defaults so
   * non-UI callers keep working; screens should go through `resolveAuthError`
   * to render the user's language. `titleKey` is absent when the title is the
   * caller-provided (already translated) fallback, and `messageKey` is absent
   * when the message is a raw Firebase string with no translation.
   */
  titleKey?: string;
  messageKey?: string;
};

type Translator = (key: string, params?: Record<string, string | number | undefined>) => string;

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
      messageKey: "auth.errors.timeout",
      retryable: true,
    };
  }

  switch (code) {
    case "auth/expo-go-unsupported":
      return {
        title: "Native build required",
        titleKey: "auth.errors.expoGoTitle",
        message: "Apple Sign-In doesn't work in Expo Go because the app bundle ID doesn't match. Run the app with expo run:ios instead.",
        messageKey: "auth.errors.expoGo",
        retryable: false,
      };
    case "ERR_REQUEST_CANCELED":
      return {
        title: fallbackTitle,
        message: "Apple Sign-In was cancelled.",
        messageKey: "auth.errors.appleCancelled",
        retryable: false,
      };
    case "auth/request-in-progress":
      return {
        title: "Please wait",
        titleKey: "auth.errors.inProgressTitle",
        message: "An authentication request is already in progress.",
        messageKey: "auth.errors.inProgress",
        retryable: false,
      };
    case "auth/missing-input":
      return {
        title: fallbackTitle,
        message: "Please fill all required fields.",
        messageKey: "auth.errors.missingInput",
        retryable: false,
      };
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return {
        title: fallbackTitle,
        message: "Invalid email or password.",
        messageKey: "auth.errors.invalidCredentials",
        retryable: false,
      };
    case "auth/invalid-email":
      return {
        title: fallbackTitle,
        message: "Please enter a valid email address.",
        messageKey: "auth.errors.invalidEmail",
        retryable: false,
      };
    case "auth/email-already-in-use":
      return {
        title: fallbackTitle,
        message: "This email is already in use.",
        messageKey: "auth.errors.emailInUse",
        retryable: false,
      };
    // Firebase's "one account per email address" setting firing: this mailbox
    // already has an account, just through the other sign-in method (typically
    // Apple vs. email+password). Same rule as emailInUse, different entry point.
    case "auth/account-exists-with-different-credential":
      return {
        title: fallbackTitle,
        message: "An account already exists for this email. Sign in with the method you used originally.",
        messageKey: "auth.errors.accountExistsOtherMethod",
        retryable: false,
      };
    case "auth/weak-password":
      return {
        title: fallbackTitle,
        message: "Password is too weak.",
        messageKey: "auth.errors.weakPassword",
        retryable: false,
      };
    case "auth/network-request-failed":
      return {
        title: "Network error",
        titleKey: "auth.errors.networkTitle",
        message: "Check your internet connection and try again.",
        messageKey: "auth.errors.network",
        retryable: true,
      };
    case "auth/too-many-requests":
      return {
        title: fallbackTitle,
        message: "Too many attempts. Please wait a moment and try again.",
        messageKey: "auth.errors.tooManyRequests",
        retryable: true,
      };
    case "auth/user-disabled":
      return {
        title: fallbackTitle,
        message: "This account has been disabled.",
        messageKey: "auth.errors.userDisabled",
        retryable: false,
      };
    case "auth/operation-not-allowed":
      return {
        title: fallbackTitle,
        message: "This sign-in method is not enabled.",
        messageKey: "auth.errors.operationNotAllowed",
        retryable: false,
      };
    default:
      return {
        title: fallbackTitle,
        message: message || "Something went wrong. Please try again.",
        // A raw Firebase message can't be translated; only the generic fallback can.
        messageKey: message ? undefined : "auth.errors.generic",
        retryable: true,
      };
  }
};

/**
 * Same as `normalizeAuthError`, but resolves the copy through the app's
 * translator so alerts render in the user's language.
 */
export const resolveAuthError = (
  error: unknown,
  t: Translator,
  fallbackTitle: string,
): NormalizedAuthError => {
  const normalized = normalizeAuthError(error, fallbackTitle);
  return {
    ...normalized,
    title: normalized.titleKey ? t(normalized.titleKey) : normalized.title,
    message: normalized.messageKey ? t(normalized.messageKey) : normalized.message,
  };
};

export const signInWithEmail = async (
  email: string,
  password: string,
): Promise<UserCredential> => {
  const trimmedEmail = email.trim();
  if (!trimmedEmail || !password) {
    throw createAuthError("auth/missing-input", "Please enter email and password.");
  }

  // Sign-ups are stored canonically (see utils/emailIdentity), so a user who
  // types an alias of their own address must still get in. The typed form is
  // tried first — accounts created before canonicalisation shipped are stored
  // exactly as typed, and they must not be locked out.
  const candidates = emailSignInCandidates(trimmedEmail);
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      return await withTimeout(
        signInWithEmailAndPassword(firebaseAuth, candidate, password),
        "login",
      );
    } catch (error) {
      lastError = error;
      const code = String((error as AuthErrorLike)?.code ?? "");
      // Only "no such account / bad credential" is worth retrying against the
      // canonical form. A locked-out, disabled or offline account fails the
      // same way for every alias — retrying just burns another attempt.
      if (!RETRY_WITH_CANONICAL_EMAIL_CODES.has(code)) throw error;
    }
  }

  throw lastError;
};

type AppleSignInResult = {
  identityToken: string;
  rawNonce: string;
  fullName: AppleAuthentication.AppleAuthenticationCredential["fullName"];
  email: string | null;
};

// Generate a cryptographically random nonce.
// Firebase validates that the idToken's `nonce` claim matches sha256(rawNonce).
const generateNonce = async (length = 32): Promise<string> => {
  const bytes = await Crypto.getRandomBytesAsync(length);
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._";
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += charset[bytes[i] % charset.length];
  }
  return out;
};

const sha256Hex = async (input: string): Promise<string> => {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
  );
};

export const requestAppleCredential = async (): Promise<AppleSignInResult> => {
  // Expo Go uses bundle ID host.exp.Exponent, so Apple's ID token audience won't
  // match the Firebase project's expected bundle ID — always fails with auth/invalid-credential.
  if (Constants.executionEnvironment === "storeClient") {
    throw createAuthError(
      "auth/expo-go-unsupported",
      "Apple Sign-In requires a native build.",
    );
  }

  const isAvailable = await AppleAuthentication.isAvailableAsync();
  if (!isAvailable) {
    throw createAuthError(
      "auth/operation-not-allowed",
      "Apple Sign-In is not available on this device.",
    );
  }

  const rawNonce = await generateNonce();
  const hashedNonce = await sha256Hex(rawNonce);

  const appleCredential = await withTimeout(
    AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    }),
    "login",
  );

  if (!appleCredential.identityToken) {
    throw createAuthError(
      "auth/invalid-credential",
      "Apple Sign-In did not return an identity token.",
    );
  }

  return {
    identityToken: appleCredential.identityToken,
    rawNonce,
    fullName: appleCredential.fullName,
    email: appleCredential.email,
  };
};

export const signInToFirebaseWithApple = async (
  identityToken: string,
  rawNonce: string,
): Promise<UserCredential> => {
  const provider = new OAuthProvider("apple.com");
  const firebaseCredential = provider.credential({
    idToken: identityToken,
    rawNonce,
  });

  return await withTimeout(
    signInWithCredential(firebaseAuth, firebaseCredential),
    "login",
  );
};

export const signInWithApple = async (): Promise<UserCredential> => {
  const { identityToken, rawNonce } = await requestAppleCredential();
  return await signInToFirebaseWithApple(identityToken, rawNonce);
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

  // One account per mailbox: the account is created under the canonical form of
  // the address, so every alias of a mailbox that already signed up collides
  // here and Firebase throws `auth/email-already-in-use`. See
  // utils/emailIdentity for what "canonical" means and why it stays deliverable.
  const canonicalEmail = normalizeEmail(trimmedEmail);

  const credential = await withTimeout(
    createUserWithEmailAndPassword(firebaseAuth, canonicalEmail, password),
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

  // The account may be stored under the typed address (pre-canonicalisation) or
  // under its canonical form (post-). Both alias the same mailbox, so firing at
  // both delivers exactly one real mail — the miss is a silent no-op under
  // Firebase's email-enumeration protection, or a user-not-found we swallow.
  const candidates = emailSignInCandidates(trimmed);
  const results = await Promise.allSettled(
    candidates.map((candidate) =>
      withTimeout(sendPasswordResetEmail(firebaseAuth, candidate), "login"),
    ),
  );

  // Only surface an error if *every* attempt failed — otherwise a mail is out.
  if (results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
};

export const signOutUser = async (): Promise<void> => {
  await withTimeout(signOut(firebaseAuth), "logout");
};

/**
 * Result of a foreground session re-validation.
 *  - "valid":   the session was confirmed against Firebase.
 *  - "invalid": Firebase definitively rejected the session (account disabled,
 *               deleted, or the refresh token was revoked) → must sign out.
 *  - "unknown": the check could not complete (e.g. transient network failure).
 *               The persisted session is still good; do NOT sign the user out.
 */
type SessionValidity = "valid" | "invalid" | "unknown";

// Firebase auth error codes that mean the credential is genuinely gone. Any
// other error (notably auth/network-request-failed) is treated as transient.
const SESSION_INVALIDATING_CODES = new Set<string>([
  "auth/user-token-expired",
  "auth/user-disabled",
  "auth/user-not-found",
  "auth/invalid-user-token",
  "auth/requires-recent-login",
]);

export const ensureSessionIsValid = async (): Promise<SessionValidity> => {
  const user = firebaseAuth.currentUser;
  if (!user) return "unknown";

  try {
    await user.reload();
    // Force a token refresh so a server-side revocation surfaces here.
    await user.getIdToken(true);
    return "valid";
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? "");
    return SESSION_INVALIDATING_CODES.has(code) ? "invalid" : "unknown";
  }
};
