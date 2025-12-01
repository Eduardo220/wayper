// firebaseConfig.js

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeAuth,
  getReactNativePersistence,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirestore } from "firebase/firestore";

/* ============================================================
   CONFIGURAÇÃO DO FIREBASE
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyDMEuHH1fq9qlGL6cfIK6jA9UvqD4YFS6Y",
  authDomain: "wayper-3ee61.firebaseapp.com",
  projectId: "wayper-3ee61",
  storageBucket: "wayper-3ee61.appspot.com",
  messagingSenderId: "284903184569",
  appId: "1:284903184569:web:956fb1d235443d002f2368",
  measurementId: "G-DQLGQ44YBV",
};

/* ============================================================
   GARANTIR QUE O APP NÃO INICIALIZE 2 VEZES
   ============================================================ */
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/* ============================================================
   AUTH CORRETO PARA REACT NATIVE (persistência real)
   ============================================================ */
let auth;

try {
  // só inicializa se não existir
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  // se já existia, pega o auth existente
  auth = getApp().auth;
}

/* ============================================================
   FIRESTORE
   ============================================================ */
const db = getFirestore(app);

/* ============================================================
   EXPORTA TUDO CERTO
   ============================================================ */
export { auth, db };
export default app;
