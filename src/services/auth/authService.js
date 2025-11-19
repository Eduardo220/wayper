import { auth } from "../../firebaseConfig";
import { createUserIfNotExists } from "../firestone/userService";
import { sendPasswordResetEmail } from "firebase/auth";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";

// LOGIN COM GOOGLE
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);

  await createUserIfNotExists(result.user);
  return result.user;
}

// LOGIN COM EMAIL/SENHA
export async function signInEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);

  await createUserIfNotExists(result.user);
  return result.user;
}

// CRIAÇÃO DE NOVO USUÁRIO (email/senha)
export async function signUpEmail(email, password, username) {
  const result = await createUserWithEmailAndPassword(auth, email, password);

  await createUserIfNotExists(result.user, username);
  return result.user;
}

// LOGOUT
export async function logout() {
  return await signOut(auth);
}

// RESET PASSWORD
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return true;
  } catch (err) {
    console.log("ERRO NO RESET:", err);
    throw err;
  }
}
