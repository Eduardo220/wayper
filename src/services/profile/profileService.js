// -----------------------------------------------------------
// profileService.js — Ultimate Pro Max Edition
// Sistema completo de progressão, XP, nível, km, km², stats.
// Persistência híbrida (local + Firestore) com fallback seguro.
// -----------------------------------------------------------

import AsyncStorage from "@react-native-async-storage/async-storage";
import { db, auth } from "../../firebaseConfig";
import { doc, setDoc, getDoc } from "firebase/firestore";

const PROFILE_KEY = "user_profile";

// ---------------- DEFAULT PROFILE MODEL --------------------
export const DEFAULT_PROFILE = {
  uid: null,

  // Progressão
  level: 1,
  xp: 0,
  nextLevelXp: 1000,

  // Estatísticas acumuladas
  totalRuns: 0,
  totalZones: 0,

  totalDistance: 0,      // metros corridos
  totalArea: 0,          // metros² conquistados
  totalTime: 0,          // segundos corridos

  // Dados secundários (opcional)
  longestRun: 0,         // metros
  largestZone: 0,        // m²
  bestPace: null,        // min/km
  lastUpdate: null,      
};


// ---------------- HELPERS --------------------
function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function calcPace(distance, durationSec) {
  if (!distance || !durationSec) return null;
  const pace = durationSec / (distance / 1000);
  return pace; // segundos por km
}


// ---------------- LOAD PROFILE --------------------
export async function loadProfile() {
  try {
    const local = await AsyncStorage.getItem(PROFILE_KEY);
    const parsed = safeParse(local);

    if (!parsed) {
      return DEFAULT_PROFILE;
    }

    return { ...DEFAULT_PROFILE, ...parsed };

  } catch (err) {
    console.log("loadProfile error:", err);
    return DEFAULT_PROFILE;
  }
}


// ---------------- SAVE PROFILE --------------------
export async function saveProfile(profile = {}) {
  try {
    const merged = { ...DEFAULT_PROFILE, ...profile };

    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(merged));

    // Firestore sync
    const user = auth.currentUser;
    if (user) {
      await setDoc(doc(db, "profiles", user.uid), merged, { merge: true });
    }

    return merged;
  } catch (err) {
    console.log("saveProfile error:", err);
    return profile;
  }
}


// ---------------- REMOTE LOAD (FIRESTORE) --------------------
export async function fetchRemoteProfile() {
  try {
    const user = auth.currentUser;
    if (!user) return null;

    const snap = await getDoc(doc(db, "profiles", user.uid));
    if (!snap.exists()) return null;

    const remote = snap.data();
    const local = await loadProfile();

    // merge com prioridade para maior progresso
    const merged = {
      ...local,
      ...remote,
    };

    await saveProfile(merged);
    return merged;
  } catch (err) {
    console.log("fetchRemoteProfile error:", err);
    return null;
  }
}


// ---------------- XP & LEVEL MECHANICS --------------------
function applyLevelSystem(profile) {
  while (profile.xp >= profile.nextLevelXp) {
    profile.xp -= profile.nextLevelXp;
    profile.level += 1;
    profile.nextLevelXp = Math.round(profile.nextLevelXp * 1.35); // escada dinâmica
  }
}


// ---------------- UPDATE STATS (RUN OR ZONE) --------------------
/**
 * updateProfileStats({
 *   distance: meters,
 *   duration: seconds,
 *   area: m²,
 *   isZone: boolean
 * })
 */
export async function updateProfileStats({
  distance = 0,
  duration = 0,
  area = 0,
  isZone = false,
}) {
  try {
    let profile = await loadProfile();

    // XP RULES
    const xpFromDistance = Math.round(distance / 10); // 1 XP a cada 10m
    const xpFromArea = Math.round(area / 20);         // 1 XP a cada 20m²
    const gainedXp = xpFromDistance + xpFromArea;

    profile.xp += gainedXp;
    profile.totalDistance += distance;
    profile.totalArea += area;
    profile.totalTime += duration;

    if (isZone) {
      profile.totalZones++;
      if (area > profile.largestZone) profile.largestZone = area;
    } else {
      profile.totalRuns++;
      if (distance > profile.longestRun) profile.longestRun = distance;

      const pace = calcPace(distance, duration);
      if (!profile.bestPace || (pace && pace < profile.bestPace)) {
        profile.bestPace = pace;
      }
    }

    applyLevelSystem(profile);

    profile.lastUpdate = new Date().toISOString();

    return await saveProfile(profile);
  } catch (err) {
    console.log("updateProfileStats error:", err);
    return null;
  }
}


// ---------------- RESET PROFILE (DEV ONLY) --------------------
export async function resetProfile() {
  try {
    await AsyncStorage.removeItem(PROFILE_KEY);

    const user = auth.currentUser;
    if (user) {
      await setDoc(doc(db, "profiles", user.uid), DEFAULT_PROFILE);
    }

    return DEFAULT_PROFILE;
  } catch (err) {
    console.log("resetProfile ERROR:", err);
    return DEFAULT_PROFILE;
  }
}


// ---------------- PUBLIC EXPORT --------------------
export default {
  loadProfile,
  saveProfile,
  updateProfileStats,
  fetchRemoteProfile,
  resetProfile,
  DEFAULT_PROFILE,
};
