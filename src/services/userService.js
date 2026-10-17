// src/services/userService.js
// -----------------------------------------------------------
// WAYPER USER SERVICE — SUPREME ULTRA MASTER PRIME EDITION
// -----------------------------------------------------------
// - Username único com cache inteligente
// - Criação atômica de perfil + subcoleções
// - Update ultra seguro com serverTimestamp()
// - XP integrado (básico)
// - Busca otimizada
// - Sanitização, anti-colisão, UUID fallback
// -----------------------------------------------------------

import { db } from "../firebaseConfig";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  runTransaction,
} from "firebase/firestore";

// ==========================================================
// LOGS
// ==========================================================
const ENABLE_LOGS = false;
const log = (...a) => ENABLE_LOGS && console.log("[userService]", ...a);

// ==========================================================
// HELPERS
// ==========================================================
function sanitize(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "");
}

// ==========================================================
// CACHE username → exists boolean
// ==========================================================
const usernameCache = new Map();

async function usernameExists(username) {
  username = sanitize(username);
  if (!username) return true;

  if (usernameCache.has(username)) return usernameCache.get(username);

  try {
    const q = query(collection(db, "users"), where("username", "==", username));
    const snap = await getDocs(q);

    const exists = !snap.empty;
    if (exists) usernameCache.set(username, true);

    return exists;
  } catch (err) {
    log("usernameExists error:", err);
    return true;
  }
}

// ==========================================================
// GERADOR DE USERNAME ULTRA RÁPIDO
// ==========================================================
async function generateUniqueUsername(base) {
  base = sanitize(base);
  if (!base || base.length < 3) base = "user";

  if (!(await usernameExists(base))) return base;

  for (let i = 1; i < 9999; i += 3) {
    const candidates = [`${base}${i}`, `${base}${i + 1}`, `${base}${i + 2}`];
    const checks = await Promise.all(candidates.map((u) => usernameExists(u)));
    const idx = checks.indexOf(false);
    if (idx !== -1) return candidates[idx];
  }

  throw new Error("username_unavailable");
}

// ==========================================================
// createUserIfNotExists — CRIAÇÃO ATÔMICA
// ==========================================================
export async function createUserIfNotExists(user, forcedUsername) {
  if (!user?.uid) return;

  const ref = doc(db, "users", user.uid);

  // tenta carregar
  let existing;
  try {
    existing = await getDoc(ref);
  } catch (err) {
    log("getDoc error:", err);
    return;
  }

  // usuário já existe — só dá refresh
  if (existing.exists()) {
    try {
      await updateDoc(ref, { lastActive: serverTimestamp() });
    } catch (e) {
      log("update lastActive error:", e);
    }
    return existing.data();
  }

  // gerar username base
  let base =
    sanitize(forcedUsername) ||
    sanitize(user.displayName || "") ||
    sanitize((user.email || "").split("@")[0]) ||
    "user";

  const username = await generateUniqueUsername(base);

  // payload oficial
  const payload = {
    uid: user.uid,
    username,
    name: user.displayName || "Novo Usuário",
    email: user.email || null,
    avatar:
      user.photoURL ||
      "https://cdn-icons-png.flaticon.com/512/149/149071.png",

    xp: 0,
    level: 1,

    totalDistance: 0,
    totalRuns: 0,
    totalArea: 0,
    totalZones: 0,
    monthlyDistance: 0,
    monthlyArea: 0,
    monthlyPoints: 0,
    weeklyPoints: 0,
    globalPoints: 0,

    isPrivate: false,
    profileVisibility: "public",

    createdAt: serverTimestamp(),
    lastActive: serverTimestamp(),

    badges: ["explorer"],

    settings: {
      notifications: true,
      mapStyle: "default",
      theme: "light",
    },
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await runTransaction(db, async (transaction) => {
        const current = await transaction.get(ref);
        if (current.exists()) return current.data();
        const reservation = doc(db, "usernames", payload.username);
        if ((await transaction.get(reservation)).exists()) throw new Error("username_taken");
        transaction.set(reservation, { uid: user.uid });
        transaction.set(ref, payload);
        for (const name of ["stats", "runs", "friends"]) transaction.set(doc(db, `users/${user.uid}/${name}/_init`), { createdAt: serverTimestamp() });
        return payload;
      });
      usernameCache.set(result.username, true);
      return result;
    } catch (err) {
      if (err.message !== "username_taken") { log("createUser error:", err); return null; }
      usernameCache.set(payload.username, true);
      payload.username = await generateUniqueUsername(base);
    }
  }
  return null;
}

// ==========================================================
// getUserData — Busca otimizada
// ==========================================================
export async function getUserData(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    log("getUserData error:", err);
    return null;
  }
}

// ==========================================================
// updateUser — Atualização
// ==========================================================
export async function updateUser(uid, data = {}) {
  if (!uid || !data || typeof data !== "object") return;
  if (Object.keys(data).some((key) => key === "username" || key.startsWith("username."))) throw new Error("username_immutable");

  try {
    await updateDoc(doc(db, "users", uid), {
      ...data,
      lastActive: serverTimestamp(),
    });
  } catch (err) {
    log("updateUser error:", err);
  }
}

// ==========================================================
// addXP — básico (XP contínuo é no xpService)
// ==========================================================
export async function addXP(uid, amount = 10) {
  const user = await getUserData(uid);
  if (!user) return null;

  const xp = (user.xp || 0) + amount;
  const level = Math.floor(xp / 100) + 1;

  await updateUser(uid, { xp, level });

  return { xp, level };
}

// ==========================================================
// EXPORT MASTER
// ==========================================================
const userService = {
  createUserIfNotExists,
  getUserData,
  updateUser,
  addXP,
};

export default userService;
