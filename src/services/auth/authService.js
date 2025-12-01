// services/auth/authService.js

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  GoogleAuthProvider,
  signInWithCredential,
} from "firebase/auth";

import { auth } from "../../firebaseConfig";
import { createUserIfNotExists } from "../firestone/userService";

/* ============================================================
   LOGIN COM EMAIL E SENHA
   ============================================================ */
export async function signInEmail(email, password) {
  if (!email || !password) {
    throw new Error("Faltou email ou senha.");
  }

  const result = await signInWithEmailAndPassword(auth, email, password);
  await createUserIfNotExists(result.user);

  return result.user;
}

/* ============================================================
   REGISTRAR CONTA (EMAIL + SENHA)
   ============================================================ */
export async function signUpEmail(email, password, username) {
  if (!email || !password) {
    throw new Error("Faltou email ou senha.");
  }

  const result = await createUserWithEmailAndPassword(auth, email, password);
  await createUserIfNotExists(result.user, username);

  return result.user;
}

/* ============================================================
   LOGIN COM GOOGLE (USANDO ID TOKEN DO EXPO-AUTH-SESSION)
   ============================================================ */
export async function signInGoogleWithIdToken(idToken) {
  if (!idToken) {
    throw new Error("Faltou idToken do Google.");
  }

  const credential = GoogleAuthProvider.credential(idToken);
  const result = await signInWithCredential(auth, credential);

  await createUserIfNotExists(result.user);

  return result.user;
}

/* ============================================================
   RESETAR SENHA
   ============================================================ */
export async function resetPassword(email) {
  if (!email) {
    throw new Error("Faltou email.");
  }

  await sendPasswordResetEmail(auth, email);
  return true;
}

/* ============================================================
   LOGOUT
   ============================================================ */
export async function logout() {
  return signOut(auth);
}
