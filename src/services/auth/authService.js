// services/auth/authService.js — VERSÃO ULTIMATE PRO MAX SUPREMA
// Ultra otimizado, seguro e estável

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  GoogleAuthProvider,
  signInWithCredential,
  updateProfile,
  onAuthStateChanged,
} from "firebase/auth";

import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { auth } from "../../firebaseConfig";
import { createUserIfNotExists } from "../firestone/userService";

// Necessário para Google OAuth no Expo
WebBrowser.maybeCompleteAuthSession();

/* ------------------------------------------------------------
   CONFIG GLOBAL
------------------------------------------------------------- */
const ENABLE_LOGS = false;

/// Log seguro
function log(...args) {
  if (ENABLE_LOGS) console.log("[authService]", ...args);
}

/// Sanitiza strings
function clean(str) {
  if (!str || typeof str !== "string") return "";
  return str.trim().replace(/\s+/g, " ");
}

/// Timeout para evitar travas do Firebase (caso raro)
async function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Tempo limite na operação Firebase.")), ms)
    ),
  ]);
}

/* ============================================================
   LOGIN COM EMAIL E SENHA
============================================================ */
export async function signInEmail(email, password) {
  email = clean(email).toLowerCase();
  password = clean(password);

  if (!email || !password) throw new Error("Faltou email ou senha.");

  try {
    const result = await withTimeout(
      signInWithEmailAndPassword(auth, email, password)
    );

    await createUserIfNotExists(result.user);
    return result.user;
  } catch (err) {
    log("Erro signInEmail:", err);
    throw err;
  }
}

/* ============================================================
   REGISTRO COM EMAIL / SENHA
============================================================ */
export async function signUpEmail(email, password, username) {
  email = clean(email).toLowerCase();
  password = clean(password);
  username = clean(username);

  if (!email || !password) throw new Error("Faltou email ou senha.");

  try {
    const result = await withTimeout(
      createUserWithEmailAndPassword(auth, email, password)
    );

    // Atualiza displayName se tiver username
    if (username) {
      await updateProfile(result.user, { displayName: username });
    }

    await createUserIfNotExists(result.user, username);

    return result.user;
  } catch (err) {
    log("Erro signUpEmail:", err);
    throw err;
  }
}

/* ============================================================
   GOOGLE AUTH — HOOK ULTRA ESTÁVEL
============================================================ */
export function useGoogleAuth() {
  return Google.useAuthRequest({
    androidClientId: "<TEU_ANDROID_CLIENT_ID>",
    iosClientId: "<TEU_IOS_CLIENT_ID>",
    webClientId: "<TEU_WEB_CLIENT_ID>",
    responseType: "id_token",
    selectAccount: true,
  });
}

export async function signInWithGoogleAsync(idToken) {
  if (!idToken) throw new Error("Faltou idToken do Google.");

  try {
    const credential = GoogleAuthProvider.credential(idToken);

    const result = await withTimeout(
      signInWithCredential(auth, credential)
    );

    await createUserIfNotExists(result.user);

    return result.user;
  } catch (err) {
    log("Erro signInWithGoogle:", err);
    throw err;
  }
}

/* ============================================================
   RESETAR SENHA
============================================================ */
export async function resetPassword(email) {
  email = clean(email).toLowerCase();
  if (!email) throw new Error("Digite um email válido.");

  try {
    await withTimeout(sendPasswordResetEmail(auth, email));
    return true;
  } catch (err) {
    log("Erro resetPassword:", err);
    throw err;
  }
}

/* ============================================================
   LOGOUT
============================================================ */
export async function logout() {
  try {
    return await withTimeout(signOut(auth));
  } catch (err) {
    log("Erro logout:", err);
    throw err;
  }
}

/* ============================================================
   LISTENER UNIVERSAL DE LOGIN
   - Pode ser usado no app inteiro
   - Retorna usuário formatado
============================================================ */
export function listenAuthChanges(callback) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      callback(null);
      return;
    }

    // formato seguro
    callback({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      emailVerified: user.emailVerified,
    });
  });
}

/* ============================================================
   GET USER ATUAL (SINCRONO)
============================================================ */
export function getCurrentUser() {
  return auth.currentUser || null;
}
