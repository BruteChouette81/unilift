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
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
  EXPO_PUBLIC_ORS_API_KEY?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

const fromEnv = (key: keyof ExtraConfig): string | undefined => {
  const value = process.env[key] ?? extra[key];
  return typeof value === "string" ? value.trim() : undefined;
};

const required = (key: keyof ExtraConfig): string => {
  const value = fromEnv(key);
  if (!value) {
    throw new Error(`Missing required runtime config: ${key}`);
  }
  return value;
};

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
  firestoreDatabaseId:
    fromEnv("EXPO_PUBLIC_FIRESTORE_DATABASE_ID") ?? "uniliftdefault",
  stripePublishableKey: required("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
  orsApiKey: required("EXPO_PUBLIC_ORS_API_KEY"),
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
