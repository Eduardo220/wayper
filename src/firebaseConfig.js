// firebaseConfig.js — WAYPER ULTIMATE PRO MAX EDITION 🚀

import { initializeApp, getApps } from "firebase/app";
import {
  initializeAuth,
  getReactNativePersistence,
  getAuth,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

// FIRESTORE PRO MAX — melhor performance para React Native
import {
  initializeFirestore,
  getFirestore,
  memoryLocalCache,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

// =========================================================================
//  🔥 CONFIGURAÇÃO OFICIAL DO FIREBASE
// =========================================================================
const firebaseConfig = {
  apiKey: "AIzaSyDMEuHH1fq9qlGL6cfIK6jA9UvqD4YFS6Y",
  authDomain: "wayper-3ee61.firebaseapp.com",
  projectId: "wayper-3ee61",
  storageBucket: "wayper-3ee61.appspot.com",
  messagingSenderId: "284903184569",
  appId: "1:284903184569:web:956fb1d235443d002f2368",
  measurementId: "G-DQLGQ44YBV",
};

// =========================================================================
//  🔥 GARANTE QUE O FIREBASE NÃO INICIE 2 VEZES
// =========================================================================
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// =========================================================================
//  🔥 FIRESTORE — VERSÃO ULTRA RÁPIDA PARA REACT NATIVE
// =========================================================================
//
//  - experimentalForceLongPolling: resolve 100% os problemas em RN / 4G
//  - useFetchStreams: acelera o android
//  - memoryLocalCache: cache correto para React Native/Expo
//    persistentLocalCache usa IndexedDB, que nao existe no app nativo
//
let db;

try {
  db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
    localCache: memoryLocalCache(),
  });
} catch (e) {
  // Fast Refresh/dev-client pode tentar inicializar o Firestore de novo.
  db = getFirestore(app);
}

// =========================================================================
//  🔥 AUTH — INICIALIZAÇÃO SEGURA + PERSISTÊNCIA REAL
// =========================================================================
let auth;

try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (e) {
  // RN às vezes tenta recriar o Auth — então pegamos o existente:
  auth = getAuth(app);
}

// =========================================================================
//  🔥 EXPORTS
// =========================================================================
const storage = getStorage(app);

export { app, db, auth, storage };
export default app;
