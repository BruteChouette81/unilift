// firebaseConfig.ts
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
} from "firebase/firestore"; //getFirestore
import { runtimeConfig, isDev } from "@/constants/runtime-config";


const firebaseConfig = {
  apiKey: runtimeConfig.firebaseApiKey,
  authDomain: runtimeConfig.firebaseAuthDomain,
  projectId: runtimeConfig.firebaseProjectId,
  storageBucket: runtimeConfig.firebaseStorageBucket,
  messagingSenderId: runtimeConfig.firebaseMessagingSenderId,
  appId: runtimeConfig.firebaseAppId,
  measurementId: runtimeConfig.firebaseMeasurementId,
};

//
// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// ✅ Initialize Auth correctly for React Native
let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
  });
} catch (e) {
  // if already initialized (useful for hot reload)
  auth = getAuth(app);
}

// Firestore
//
// On React Native / Expo the default WebChannel transport that powers
// onSnapshot() frequently fails to establish a streaming connection, so live
// listeners silently hang and never deliver data (while one-time REST reads
// still work). Forcing long-polling makes onSnapshot reliable on-device.
// `initializeFirestore` must run before any getFirestore() call elsewhere in
// the app — this module is imported at startup (via AuthContext) so it does.
let db;
try {
  db = initializeFirestore(
    app,
    { experimentalForceLongPolling: true },
    runtimeConfig.firestoreDatabaseId,
  );
} catch (e) {
  // Already initialized (e.g. fast refresh) — reuse the existing instance.
  db = getFirestore(app, runtimeConfig.firestoreDatabaseId);
}

// [RIDE-DEBUG] Confirm the SDK is bound to the correct named database. Live
// listeners must use this `db` (not bare getFirestore(), which hits "(default)").
try {
  if (isDev) console.log("[RIDE-DEBUG] firestore db id:", db?._databaseId?.database);
} catch { /* non-fatal */ }

export { auth, db };
