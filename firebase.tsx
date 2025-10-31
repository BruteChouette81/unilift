// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

//firebase init, firebase deploy

const firebaseConfig = {

  apiKey: "AIzaSyDQMdY0la_sZuHvumHjFl4ibfCsOe1UW6Q",

  authDomain: "unilift-6e756.firebaseapp.com",

  projectId: "unilift-6e756",

  storageBucket: "unilift-6e756.firebasestorage.app",

  messagingSenderId: "682863404857",

  appId: "1:682863404857:web:a3a8c9a0436ccec5232ae8",

  measurementId: "G-WWHVR2KVMX"

};


const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
