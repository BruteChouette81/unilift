import Constants from "expo-constants";

type ExtraConfig = {
  EXPO_PUBLIC_FIREBASE_API_KEY?: string;
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
  EXPO_PUBLIC_FIREBASE_PROJECT_ID?: string;
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
  EXPO_PUBLIC_FIREBASE_APP_ID?: string;
  EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID?: string;
  EXPO_PUBLIC_FIRESTORE_DATABASE_ID?: string;
  EXPO_PUBLIC_APP_ENV?: string;
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST?: string;
  GOOGLE_MAPS_API_KEY?: string;
  EXPO_PUBLIC_FACEBOOK_APP_ID?: string;
  EXPO_PUBLIC_INSTAGRAM_APP_ID?: string;
  EXPO_PUBLIC_TIKTOK_CLIENT_KEY?: string;
  EXPO_PUBLIC_SPOTIFY_CLIENT_ID?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

const fromEnv = (key: keyof ExtraConfig): string | undefined => {
  const value = extra[key];
  return typeof value === "string" ? value.trim() : undefined;
};

const required = (key: keyof ExtraConfig): string => {
  const value = fromEnv(key);
  if (!value) {
    throw new Error(`Missing required runtime config: ${key}`);
  }
  return value;
};

export const appEnv = fromEnv("EXPO_PUBLIC_APP_ENV") ?? "production";
export const isDev = appEnv === "dev";

export const runtimeConfig = {
  firebaseApiKey: required("EXPO_PUBLIC_FIREBASE_API_KEY"),
  firebaseAuthDomain: required("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  firebaseProjectId: required("EXPO_PUBLIC_FIREBASE_PROJECT_ID"),
  firebaseStorageBucket: required("EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET"),
  firebaseMessagingSenderId: required(
    "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  ),
  firebaseAppId: required("EXPO_PUBLIC_FIREBASE_APP_ID"),
  firebaseMeasurementId: required("EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID"),
  firestoreDatabaseId: isDev
    ? "uniliftdev"
    : (fromEnv("EXPO_PUBLIC_FIRESTORE_DATABASE_ID") ?? "uniliftdefault"),
  // Initial Stripe publishable key used before the /config response arrives.
  // In dev mode, the test key is used immediately so Stripe is never initialized
  // with a live key that mismatches the test secret key on the server.
  stripePublishableKey: isDev
    ? (fromEnv("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST") ?? "")
    : (fromEnv("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY") ?? ""),
  googleMapsApiKey: required("GOOGLE_MAPS_API_KEY"),
};

export const firestoreBaseUrl = `https://firestore.googleapis.com/v1/projects/${runtimeConfig.firebaseProjectId}/databases/${encodeURIComponent(
  runtimeConfig.firestoreDatabaseId,
)}/documents`;

export const firestoreCollectionUrl = (collection: string) =>
  `${firestoreBaseUrl}/${collection}`;

export const firestoreDocumentUrl = (collection: string, id: string) =>
  `${firestoreCollectionUrl(collection)}/${id}`;

export const withFirebaseApiKey = (url: string) => {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}key=${runtimeConfig.firebaseApiKey}`;
};

export const firebaseStorageBaseUrl = `https://firebasestorage.googleapis.com/v0/b/${runtimeConfig.firebaseStorageBucket}/o`;

export const apiBaseUrl = "https://api-qsxtpust2a-uc.a.run.app";

export function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isDev) return fetch(url, init);
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set("X-App-Env", "dev");
  return fetch(url, { ...init, headers });
}

// Debug logging that is a no-op outside dev. Use for temporary `[RIDE-DEBUG]`
// style diagnostics so production builds stay silent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const devLog = (...args: any[]): void => { if (isDev) console.log(...args); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const devWarn = (...args: any[]): void => { if (isDev) console.warn(...args); };

export const facebookAppId = fromEnv("EXPO_PUBLIC_FACEBOOK_APP_ID") ?? "";

// Public OAuth client identifiers for the social-connect flows. The matching
// secrets live only in functions/.env and are used server-side during the
// code→token exchange. An empty string disables that provider's connect button.
export const socialClientIds = {
  instagram: fromEnv("EXPO_PUBLIC_INSTAGRAM_APP_ID") ?? "",
  tiktok: fromEnv("EXPO_PUBLIC_TIKTOK_CLIENT_KEY") ?? "",
  spotify: fromEnv("EXPO_PUBLIC_SPOTIFY_CLIENT_ID") ?? "",
};
