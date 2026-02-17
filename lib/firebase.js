import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBnxWrpj42s2jn18P8YJDo4V2bI5_uLS3E",
  authDomain: "rental-car-system-c0060.firebaseapp.com",
  projectId: "rental-car-system-c0060",
  storageBucket: "rental-car-system-c0060.firebasestorage.app",
  messagingSenderId: "265952875801",
  appId: "1:265952875801:web:4ae142c8de19ec8c5b2188",
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const db = getFirestore(app);
export const auth = getAuth(app);