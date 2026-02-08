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


const firebaseConfig = {

  apiKey: "AIzaSyDQMdY0la_sZuHvumHjFl4ibfCsOe1UW6Q",

  authDomain: "unilift-6e756.firebaseapp.com",

  projectId: "unilift-6e756",

  storageBucket: "unilift-6e756.firebasestorage.app",

  messagingSenderId: "682863404857",

  appId: "1:682863404857:web:a3a8c9a0436ccec5232ae8",

  measurementId: "G-WWHVR2KVMX"

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

