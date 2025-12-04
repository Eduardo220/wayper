// src/services/firestore/userService.js — VERSÃO ULTRA POWER ULTIMATE

import { db } from "../../firebaseConfig";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

/* ------------------------------------------------------------
   GLOBAL
------------------------------------------------------------- */

const ENABLE_LOGS = false;

function log(...a) {
  if (ENABLE_LOGS) console.log("[userService]", ...a);
}

function clean(str) {
  if (!str || typeof str !== "string") return "";
  return str.trim().toLowerCase().replace(/\s+/g, "");
}

// Cache em memória para evitar consultas repetidas
const usernameCache = new Set();

/* ============================================================
   VERIFICA SE USERNAME EXISTE (ULTRA OTIMIZADO)
============================================================ */
export async function isUsernameAvailable(username) {
  username = clean(username);

  if (!username) return false;

  // Cache local salva requisições
  if (usernameCache.has(username)) return false;

  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", username));
    const snapshot = await getDocs(q);

    const available = snapshot.empty;

    if (!available) usernameCache.add(username);

    return available;
  } catch (err) {
    log("Erro isUsernameAvailable:", err);
    return false;
  }
}

/* ============================================================
   GERA USERNAME ÚNICO (ULTRA SMART)
============================================================ */
async function generateUniqueUsername(base) {
  base = clean(base.replace(/[^a-z0-9._]/gi, ""));

  if (!base || base.length < 3) base = "user";

  // Tenta primeiro o próprio base
  if (await isUsernameAvailable(base)) return base;

  for (let i = 1; i <= 9999; i++) {
    const candidate = `${base}${i}`;
    if (await isUsernameAvailable(candidate)) {
      return candidate;
    }
  }

  return `user${crypto.randomUUID().slice(0, 6)}`;
}

/* ============================================================
   CRIA USER NO FIRESTORE SE NÃO EXISTIR
============================================================ */
export async function createUserIfNotExists(user, usernameInput) {
  if (!user?.uid) return;

  const userRef = doc(db, "users", user.uid);
  let snap;

  try {
    snap = await getDoc(userRef);
  } catch (err) {
    log("Erro ao buscar user:", err);
    return;
  }

  // Se já existe → atualiza lastActive e sai
  if (snap.exists()) {
    try {
      await updateDoc(userRef, {
        lastActive: serverTimestamp(),
      });
      log("Usuário já existia → lastActive atualizado");
    } catch (err) {
      log("Erro update lastActive:", err);
    }
    return;
  }

  /* -----------------------------
     GERA USERNAME BASE
     ----------------------------- */
  let baseUsername =
    clean(usernameInput) ||
    clean(user.displayName?.replace(/\s+/g, "")) ||
    clean(user.email.split("@")[0]) ||
    "user";

  baseUsername = baseUsername.replace(/[^a-z0-9._]/gi, "");
  if (!baseUsername) baseUsername = "user";

  /* -----------------------------
     CRIA USERNAME ÚNICO
     ----------------------------- */
  const username = await generateUniqueUsername(baseUsername);

  /* -----------------------------
     PAYLOAD PROFISSIONAL ULTRA FULL
     ----------------------------- */
  const payload = {
    uid: user.uid,
    username,
    name: user.displayName || "Novo Usuário",
    email: user.email,
    avatar:
      user.photoURL ||
      "https://cdn-icons-png.flaticon.com/512/149/149071.png",

    // Sistema de gamificação
    xp: 0,
    level: 1,
    totalArea: 0,
    totalZones: 0,

    // Metadados
    createdAt: serverTimestamp(),
    lastActive: serverTimestamp(),
    badges: ["explorer"],

    // Futuro upgrade para configs
    settings: {
      notifications: true,
      mapStyle: "default",
      theme: "light",
    },
  };

  try {
    await setDoc(userRef, payload);
    log(`Usuário criado → ${username}`);
  } catch (err) {
    log("Erro ao criar user:", err);
  }
}

/* ============================================================
   BUSCA DADOS DO USUÁRIO
============================================================ */
export async function getUserData(uid) {
  if (!uid) return null;

  const ref = doc(db, "users", uid);

  try {
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    log("Erro getUserData:", err);
    return null;
  }
}

/* ============================================================
   UPDATE GENÉRICO (ULTRA RÁPIDO)
============================================================ */
export async function updateUser(uid, data = {}) {
  if (!uid || !data) return;

  const ref = doc(db, "users", uid);

  try {
    await updateDoc(ref, {
      ...data,
      lastActive: serverTimestamp(),
    });
    log("User atualizado:", data);
  } catch (err) {
    log("Erro updateUser:", err);
  }
}

/* ============================================================
   ACRESCENTA XP (SISTEMA DE LEVEL PROFISSIONAL)
============================================================ */
export async function addXP(uid, amount = 10) {
  const user = await getUserData(uid);
  if (!user) return;

  const newXP = user.xp + amount;
  const newLevel = Math.floor(newXP / 100) + 1;

  await updateUser(uid, { xp: newXP, level: newLevel });

  return { xp: newXP, level: newLevel };
}
