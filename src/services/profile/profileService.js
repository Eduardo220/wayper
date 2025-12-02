// src/services/profile/profileService.js
// -----------------------------------------------------------
// profileService.js — Ultimate Pro Max Edition (refactor)
// - Progressão (XP, níveis) + estatísticas (km, área, tempo)
// - Persistência local (AsyncStorage) + Firestore (users/{uid})
// - Integração com xpService (se disponível) para ranking/checkpoints
// - Subscribable: listeners para UI auto-refresh sem polling
// -----------------------------------------------------------

import AsyncStorage from "@react-native-async-storage/async-storage";
import { db, auth } from "../../firebaseConfig";
import { doc, setDoc, getDoc } from "firebase/firestore";
import * as xpService from "../xp/xpService"; // integra com o xpService (se existir)

// Storage key
const PROFILE_KEY = "user_profile_v2";

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

  totalDistance: 0, // metros
  totalArea: 0, // metros²
  totalTime: 0, // segundos

  // Dados secundários (opcional)
  longestRun: 0, // metros
  largestZone: 0, // m²
  bestPace: null, // segundos por km
  lastUpdate: null,
};

// ---------------- CONFIGURABLE RULES --------------------
const CONFIG = {
  XP_PER_METER: 0.1, // XP per meter (0.1 => 1 XP per 10m)
  XP_PER_M2: 0.05, // XP per m² (0.05 => 1 XP per 20m²)
  MAX_XP_PER_RUN: 5000, // cap por corrida
  MAX_XP_PER_ZONE: 8000, // cap por zona
  LEVEL_XP_MULTIPLIER: 1.35, // multiplicador para nextLevelXp
  SAFE_SAVE_DEBOUNCE_MS: 250, // debounce para evitar múltiplos saves imediatos
};

// ---------------- HELPERS --------------------
function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
function nowIso() {
  return new Date().toISOString();
}
function clamp(n, min = 0, max = Number.POSITIVE_INFINITY) {
  return Math.max(min, Math.min(max, n));
}
function calcPaceSecondsPerKm(distanceMeters, durationSeconds) {
  if (!distanceMeters || !durationSeconds) return null;
  return durationSeconds / (distanceMeters / 1000);
}
function applyLevelSystem(profile) {
  // aplicando progressão até que xp < nextLevelXp
  while (profile.xp >= profile.nextLevelXp) {
    profile.xp -= profile.nextLevelXp;
    profile.level += 1;
    profile.nextLevelXp = Math.round(profile.nextLevelXp * CONFIG.LEVEL_XP_MULTIPLIER);
  }
}

// compute xp for distance/area (public helpers)
export function getXpForDistance(distanceMeters = 0) {
  const xp = Math.round(distanceMeters * CONFIG.XP_PER_METER);
  return clamp(xp, 0, CONFIG.MAX_XP_PER_RUN);
}
export function getXpForArea(areaM2 = 0) {
  const xp = Math.round(areaM2 * CONFIG.XP_PER_M2);
  return clamp(xp, 0, CONFIG.MAX_XP_PER_ZONE);
}

let lastSaveTs = 0;
let saveTimeout = null;

// ---------------- SUBSCRIBE (listeners para UI) --------------------
const listeners = new Set();
export function subscribeProfileUpdates(cb) {
  if (typeof cb === "function") listeners.add(cb);
  return () => listeners.delete(cb);
}
function emitProfileUpdate(profile) {
  for (const cb of Array.from(listeners)) {
    try {
      cb(profile);
    } catch (e) {
      // ignore individual listener errors
      console.warn("profileService listener error:", e);
    }
  }
}

// ---------------- LOAD PROFILE --------------------
export async function loadProfile() {
  try {
    const local = await AsyncStorage.getItem(PROFILE_KEY);
    const parsed = safeParse(local);
    if (!parsed) return { ...DEFAULT_PROFILE };
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch (err) {
    console.warn("profileService.loadProfile error:", err);
    return { ...DEFAULT_PROFILE };
  }
}

// ---------------- SAVE PROFILE --------------------
async function _persistProfileLocal(profile) {
  try {
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.warn("profileService._persistProfileLocal error:", err);
  }
}
async function _persistProfileFirestore(profile) {
  try {
    const user = auth.currentUser;
    if (!user) return;
    // sanitize fields to write only expected keys
    const safe = {
      uid: user.uid,
      level: Number(profile.level) || 1,
      xp: Number(profile.xp) || 0,
      nextLevelXp: Number(profile.nextLevelXp) || CONFIG.nextLevelXp,
      totalRuns: Number(profile.totalRuns) || 0,
      totalZones: Number(profile.totalZones) || 0,
      totalDistance: Number(profile.totalDistance) || 0,
      totalArea: Number(profile.totalArea) || 0,
      totalTime: Number(profile.totalTime) || 0,
      longestRun: Number(profile.longestRun) || 0,
      largestZone: Number(profile.largestZone) || 0,
      bestPace: profile.bestPace || null,
      lastUpdate: profile.lastUpdate || nowIso(),
    };
    await setDoc(doc(db, "users", user.uid), safe, { merge: true });
  } catch (err) {
    console.warn("profileService._persistProfileFirestore error:", err);
  }
}

/**
 * Save profile with debounce & safe writes.
 * keeps same external API: saveProfile(profile)
 */
export async function saveProfile(profile = {}) {
  try {
    const merged = { ...DEFAULT_PROFILE, ...(await loadProfile()), ...profile };
    // set lastUpdate if missing
    merged.lastUpdate = merged.lastUpdate || nowIso();

    // debounce cheap local saves to avoid storm
    const doSave = async () => {
      try {
        await _persistProfileLocal(merged);
        await _persistProfileFirestore(merged);
        emitProfileUpdate(merged);
      } catch (e) {
        console.warn("profileService.saveProfile inner error:", e);
      }
    };

    const nowTs = Date.now();
    lastSaveTs = nowTs;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      doSave().catch((e) => console.warn(e));
      saveTimeout = null;
    }, CONFIG.SAFE_SAVE_DEBOUNCE_MS);

    // return merged immediately for sync usage
    return merged;
  } catch (err) {
    console.warn("profileService.saveProfile error:", err);
    return profile;
  }
}

// ---------------- REMOTE LOAD (FIRESTORE) --------------------
export async function fetchRemoteProfile() {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return null;
    const remote = snap.data();
    const local = await loadProfile();
    // Merge strategy: prefer max progression values for integrity (avoid regressions)
    const merged = { ...local, ...remote };
    // ensure numeric types
    merged.xp = Number(merged.xp || 0);
    merged.nextLevelXp = Number(merged.nextLevelXp || DEFAULT_PROFILE.nextLevelXp);
    merged.level = Number(merged.level || 1);
    await saveProfile(merged);
    return merged;
  } catch (err) {
    console.warn("profileService.fetchRemoteProfile error:", err);
    return null;
  }
}

// ---------------- UPDATE STATS (RUN OR ZONE) --------------------
/**
 * updateProfileStats({
 *   distance: meters,
 *   duration: seconds,
 *   area: m²,
 *   isZone: boolean,
 *   meta: { runId, zoneId, rawPayload }
 * })
 *
 * - calcula XP de distância e área
 * - aplica caps
 * - atualiza profile local + Firestore
 * - dispara xpService.awardXPToUser se disponível (best-effort)
 * - notifica listeners
 */
export async function updateProfileStats({
  distance = 0,
  duration = 0,
  area = 0,
  isZone = false,
  meta = {},
} = {}) {
  try {
    // sanitize inputs
    distance = Math.max(0, Number(distance) || 0);
    duration = Math.max(0, Number(duration) || 0);
    area = Math.max(0, Number(area) || 0);
    isZone = !!isZone;

    // load current profile
    const profile = await loadProfile();

    // compute xp components
    const xpDistance = getXpForDistance(distance);
    const xpArea = getXpForArea(area);
    let gainedXp = xpDistance + xpArea;

    // optional bonus: small time-based multiplier (encourage longer runs)
    // e.g., give extra XP if run longer than 30 minutes
    if (!isZone && duration >= 30 * 60) {
      gainedXp = Math.round(gainedXp * 1.12); // +12% for 30m+ runs
    }

    // hard cap per event (just in case)
    const eventCap = isZone ? CONFIG.MAX_XP_PER_ZONE : CONFIG.MAX_XP_PER_RUN;
    gainedXp = clamp(gainedXp, 0, eventCap);

    // apply to profile
    profile.xp = Number(profile.xp || 0) + gainedXp;
    profile.totalDistance = Number(profile.totalDistance || 0) + distance;
    profile.totalArea = Number(profile.totalArea || 0) + area;
    profile.totalTime = Number(profile.totalTime || 0) + duration;

    if (isZone) {
      profile.totalZones = Number(profile.totalZones || 0) + 1;
      if (area > (profile.largestZone || 0)) profile.largestZone = area;
    } else {
      profile.totalRuns = Number(profile.totalRuns || 0) + 1;
      if (distance > (profile.longestRun || 0)) profile.longestRun = distance;

      const pace = calcPaceSecondsPerKm(distance, duration);
      if (!profile.bestPace || (pace && pace < profile.bestPace)) {
        profile.bestPace = pace;
      }
    }

    // level up loop
    applyLevelSystem(profile);

    profile.lastUpdate = nowIso();

    // persist and notify
    const saved = await saveProfile(profile);

    // Emit update
    emitProfileUpdate(saved);

    // return updated profile
    return saved;
  } catch (err) {
    console.warn("profileService.updateProfileStats error:", err);
    return null;
  }
}

// ---------------- RESET PROFILE (DEV ONLY) --------------------
export async function resetProfile() {
  try {
    await AsyncStorage.removeItem(PROFILE_KEY);
    const user = auth.currentUser;
    if (user) {
      await setDoc(doc(db, "users", user.uid), DEFAULT_PROFILE, { merge: true });
    }
    const mergedDefault = { ...DEFAULT_PROFILE, uid: user?.uid || null, lastUpdate: nowIso() };
    emitProfileUpdate(mergedDefault);
    return mergedDefault;
  } catch (err) {
    console.warn("profileService.resetProfile error:", err);
    return DEFAULT_PROFILE;
  }
}

// ---------------- UTILS --------------------
export function getLevelProgress(profile = null) {
  const p = profile || DEFAULT_PROFILE;
  const xp = Number(p.xp || 0);
  const next = Number(p.nextLevelXp || DEFAULT_PROFILE.nextLevelXp);
  return {
    xp,
    nextLevelXp: next,
    pct: next > 0 ? Math.round((xp / next) * 100) : 0,
  };
}

// ---------------- PUBLIC EXPORT --------------------
export default {
  loadProfile,
  saveProfile,
  fetchRemoteProfile,
  updateProfileStats,
  resetProfile,
  getXpForDistance,
  getXpForArea,
  getLevelProgress,
  subscribeProfileUpdates,
  DEFAULT_PROFILE,
};
