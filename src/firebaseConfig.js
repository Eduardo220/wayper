// firebaseConfig.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDMEuHH1fq9qlGL6cfIK6jA9UvqD4YFS6Y",
  authDomain: "wayper-3ee61.firebaseapp.com",
  projectId: "wayper-3ee61",
  storageBucket: "wayper-3ee61.appspot.com", // ✅ corrigido
  messagingSenderId: "284903184569",
  appId: "1:284903184569:web:956fb1d235443d002f2368",
  measurementId: "G-DQLGQ44YBV",
};

// ✅ Garante que só uma instância do Firebase é usada
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// ✅ Cria e exporta instâncias
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
