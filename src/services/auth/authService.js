// services/auth/authService.js — WAYPER ULTRA™ EDITION
// O serviço de autenticação mais sólido, rápido e seguro possível no Expo + Firebase

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  GoogleAuthProvider,
  signInWithCredential,
  updateProfile,
  onAuthStateChanged,
  getAuth,
} from "firebase/auth";

import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { auth } from "../../firebaseConfig";
import { googleAuthConfig } from "../../config/env";
import { createUserIfNotExists } from "../userService";

/* ============================================================
   FIX GOOGLE AUTH SESSIONS (OBRIGATÓRIO NO EXPO)
============================================================ */
WebBrowser.maybeCompleteAuthSession();

/* ============================================================
   CONFIGURAÇÕES
============================================================ */
const ENABLE_LOGS = false;
const REQUEST_TIMEOUT = 8000;

const ERRORS_MAP = {
  "auth/invalid-email": "Email inválido.",
  "auth/user-not-found": "Usuário não encontrado.",
  "auth/wrong-password": "Senha incorreta.",
  "auth/email-already-in-use": "Email já está em uso.",
  "auth/weak-password": "Senha muito fraca.",
  "auth/too-many-requests": "Muitas tentativas. Tente mais tarde.",
  "auth/network-request-failed": "Erro de rede. Verifique sua conexão.",
};

/* ============================================================
   HELPERS PRO EDITION
============================================================ */

function log(...args) {
  if (ENABLE_LOGS) console.log("[authService]", ...args);
}

function clean(str) {
  if (!str || typeof str !== "string") return "";
  return str.trim().replace(/\s+/g, " ");
}

function formatError(err) {
  const code = err?.code || "";
  return ERRORS_MAP[code] || err.message || "Erro inesperado.";
}

async function withTimeout(promise, ms = REQUEST_TIMEOUT) {
  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("timeout")), ms);
  });

  try {
    return await Promise.race([promise, timer]);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeUser(user) {
  if (!user) return null;

  return {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    photoURL: user.photoURL || null,
    emailVerified: user.emailVerified || false,
    providerId: user.providerId || null,
  };
}

/* ============================================================
   LOGIN EMAIL / SENHA
============================================================ */
export async function signInEmail(email, password) {
  email = clean(email).toLowerCase();
  password = clean(password);

  if (!email || !password) throw new Error("Digite email e senha.");

  try {
    const res = await withTimeout(
      signInWithEmailAndPassword(auth, email, password)
    );

    await createUserIfNotExists(res.user);

    return normalizeUser(res.user);
  } catch (err) {
    log("signInEmail error:", err);
    throw new Error(formatError(err));
  }
}

/* ============================================================
   REGISTRO EMAIL / SENHA
============================================================ */
export async function signUpEmail(email, password, username) {
  email = clean(email).toLowerCase();
  password = clean(password);
  username = clean(username);

  try {
    const res = await withTimeout(
      createUserWithEmailAndPassword(auth, email, password)
    );

    if (username) {
      await updateProfile(res.user, { displayName: username });
    }

    await createUserIfNotExists(res.user, username);

    return normalizeUser(res.user);
  } catch (err) {
    log("signUpEmail error:", err);
    throw new Error(formatError(err));
  }
}

/* ============================================================
   GOOGLE AUTH — ULTRA VERSÃO
============================================================ */
export function useGoogleAuth() {
  return Google.useAuthRequest({
    ...(googleAuthConfig.androidClientId
      ? { androidClientId: googleAuthConfig.androidClientId }
      : {}),
    ...(googleAuthConfig.iosClientId
      ? { iosClientId: googleAuthConfig.iosClientId }
      : {}),
    ...(googleAuthConfig.webClientId
      ? { webClientId: googleAuthConfig.webClientId }
      : {}),
    ...(googleAuthConfig.expoClientId
      ? { expoClientId: googleAuthConfig.expoClientId }
      : {}),
    responseType: "id_token",
    selectAccount: true,
  });
}

export async function signInWithGoogleAsync(idToken) {
  if (!idToken) throw new Error("Erro ao autenticar com Google.");

  try {
    const credential = GoogleAuthProvider.credential(idToken);

    const res = await withTimeout(signInWithCredential(auth, credential));

    await createUserIfNotExists(res.user);

    return normalizeUser(res.user);
  } catch (err) {
    log("signInWithGoogle error:", err);
    throw new Error(formatError(err));
  }
}

/* ============================================================
   RESET PASSWORD
============================================================ */
export async function resetPassword(email) {
  email = clean(email).toLowerCase();

  if (!email) throw new Error("Informe o email.");

  try {
    await withTimeout(sendPasswordResetEmail(auth, email));
    return true;
  } catch (err) {
    throw new Error(formatError(err));
  }
}

/* ============================================================
   LOGOUT
============================================================ */
export async function logout() {
  try {
    await withTimeout(signOut(auth));
    return true;
  } catch (err) {
    throw new Error(formatError(err));
  }
}

/* ============================================================
   LISTENER UNIVERSAL
============================================================ */
export function listenAuthChanges(callback) {
  return onAuthStateChanged(auth, (user) => {
    callback(normalizeUser(user));
  });
}

/* ============================================================
   GET USER ATUAL
============================================================ */
export function getCurrentUser() {
  return normalizeUser(getAuth().currentUser);
}
