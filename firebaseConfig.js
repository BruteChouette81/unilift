// firebaseConfig.ts
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";
import {
  getFirestore
} from "firebase/firestore"; //getFirestore
import { runtimeConfig } from "@/constants/runtime-config";


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
const db = getFirestore(app);



export { auth, db };
