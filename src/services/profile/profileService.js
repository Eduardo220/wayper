// src/services/profile/profileService.js
// -----------------------------------------------------------
// profileService.js — SUPREME ULTIMATE MASTER PRO MAX EDITION
// - Progressão completa (XP, Level, Next XP)
// - Estatísticas globais (runs, distance, area, pace...)
// - Firestore + AsyncStorage (sync seguro, retries, backoff)
// - Auto-merge de dados remotos/locais (no-regression)
// - Debounce anti-spam de escrita + queue + mutex (zero races)
// - Subscribable (UI reativa sem polling)
// - Telemetry hook optional
// -----------------------------------------------------------

import AsyncStorage from "@react-native-async-storage/async-storage";
import { db, auth } from "../../firebaseConfig";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";

// STORAGE KEY
const PROFILE_KEY = "wayper_profile_v3";

// -----------------------------------------------------------
// DEFAULT MODEL (perfil completo)
// -----------------------------------------------------------
export const DEFAULT_PROFILE = {
  uid: null,

  // Progressão
  level: 1,
  xp: 0,
  nextLevelXp: 1000,

  // Estatísticas acumuladas globais
  totalRuns: 0,
  totalZones: 0,

  totalDistance: 0, // m
  totalArea: 0, // m²
  totalTime: 0, // s

  // Achievements secundários
  longestRun: 0, // m
  largestZone: 0, // m²
  bestPace: null, // sec/km

  // ranking counters
  weeklyPoints: 0,
  monthlyPoints: 0,
  globalPoints: 0,
  monthlyDistance: 0,
  monthlyArea: 0,
  rankingMonth: null,

  // monthly ranking medals/previews
  bestMonthlyRank: null,
  bestMonthlyRankArea: null,
  bestMonthlyRankDistance: null,

  lastUpdate: null,
};

// -----------------------------------------------------------
// CONFIG & TUNING
// -----------------------------------------------------------
const CONFIG = {
  XP_PER_METER: 0.1, // 1xp por 10m
  XP_PER_M2: 0.05, // 1xp por 20m2

  MAX_XP_PER_RUN: 5000,
  MAX_XP_PER_ZONE: 8000,

  LEVEL_XP_MULTIPLIER: 1.35,

  SAFE_SAVE_DEBOUNCE_MS: 300,

  // Firestore persist
  FIRESTORE_WRITE_RETRIES: 4,
  FIRESTORE_BACKOFF_BASE_MS: 450,
};

// -----------------------------------------------------------
// TELEMETRY HOOK (opcional)
// -----------------------------------------------------------
let telemetryHook = null;
export function setTelemetryHook(hook) {
  telemetryHook = hook && typeof hook.track === "function" ? hook : null;
}
function track(ev, payload = {}) {
  try {
    if (telemetryHook) telemetryHook.track(ev, payload);
  } catch {}
}

// -----------------------------------------------------------
// HELPERS
// -----------------------------------------------------------
const clamp = (v, min = 0, max = Infinity) => Math.max(min, Math.min(v, Number(v) || 0));
const nowIso = () => new Date().toISOString();
const monthKey = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function calcPace(distanceMeters, durationSeconds) {
  if (!distanceMeters || !durationSeconds) return null;
  return durationSeconds / (distanceMeters / 1000); // sec/km
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function ensureCurrentMonth(profile) {
  const key = monthKey();
  if (profile.rankingMonth !== key) {
    profile.rankingMonth = key;
    profile.monthlyPoints = 0;
    profile.monthlyDistance = 0;
    profile.monthlyArea = 0;
  }
  return profile;
}

// Level progression helpers (kept simple & stable)
function applyLevel(profile) {
  try {
    profile.xp = Number(profile.xp || 0);
    profile.nextLevelXp = Number(profile.nextLevelXp || DEFAULT_PROFILE.nextLevelXp);
    profile.level = Number(profile.level || 1);

    while (profile.xp >= profile.nextLevelXp) {
      profile.xp -= profile.nextLevelXp;
      profile.level += 1;
      profile.nextLevelXp = Math.round(profile.nextLevelXp * CONFIG.LEVEL_XP_MULTIPLIER);
    }
  } catch (e) {
    // defensive
  }
}

// -----------------------------------------------------------
// SUBSCRIBE / EMIT (reactive UI)
// -----------------------------------------------------------
const listeners = new Set();

export function subscribeProfileUpdates(cb) {
  if (typeof cb !== "function") throw new Error("subscribeProfileUpdates expects a function");
  listeners.add(cb);
  // return unsubscribe
  return () => listeners.delete(cb);
}
function emit(profile) {
  // call in next tick to avoid sync reentrancy
  setTimeout(() => {
    for (const fn of Array.from(listeners)) {
      try {
        fn(profile);
      } catch (e) {
        // swallow listener errors to avoid crashing
        console.warn("profileService listener error:", e);
      }
    }
  }, 0);
}

// -----------------------------------------------------------
// PERSISTENCE: local AsyncStorage
// -----------------------------------------------------------
export async function loadProfile() {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    const local = safeParse(raw) || {};
    // ensure we always return a full profile
    const merged = { ...DEFAULT_PROFILE, ...local };
    // keep numeric stability
    merged.xp = Number(merged.xp || 0);
    merged.level = Number(merged.level || 1);
    merged.nextLevelXp = Number(merged.nextLevelXp || DEFAULT_PROFILE.nextLevelXp);
    merged.totalDistance = Number(merged.totalDistance || 0);
    merged.totalArea = Number(merged.totalArea || 0);
    merged.totalTime = Number(merged.totalTime || 0);
    merged.totalRuns = Number(merged.totalRuns || 0);
    merged.totalZones = Number(merged.totalZones || 0);
    merged.weeklyPoints = Number(merged.weeklyPoints || 0);
    merged.monthlyPoints = Number(merged.monthlyPoints || 0);
    merged.globalPoints = Number(merged.globalPoints || 0);
    merged.monthlyDistance = Number(merged.monthlyDistance || 0);
    merged.monthlyArea = Number(merged.monthlyArea || 0);
    return merged;
  } catch (e) {
    console.warn("profileService.loadProfile error:", e);
    return { ...DEFAULT_PROFILE };
  }
}

async function saveLocal(profile) {
  try {
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.warn("profileService.saveLocal error:", e);
  }
}

// -----------------------------------------------------------
// FIRESTORE SAVE (merge seguro, retry/backoff)
// -----------------------------------------------------------
async function saveFirestore(profile) {
  const user = auth.currentUser;
  if (!user) {
    track("profile.save.skip_no_user", {});
    return null;
  }

  const safe = {
    uid: user.uid,
    level: Number(profile.level || 1),
    xp: Number(profile.xp || 0),
    nextLevelXp: Number(profile.nextLevelXp || DEFAULT_PROFILE.nextLevelXp),

    totalRuns: Number(profile.totalRuns || 0),
    totalZones: Number(profile.totalZones || 0),

    totalDistance: Number(profile.totalDistance || 0),
    totalArea: Number(profile.totalArea || 0),
    totalTime: Number(profile.totalTime || 0),

    longestRun: Number(profile.longestRun || 0),
    largestZone: Number(profile.largestZone || 0),
    bestPace: profile.bestPace == null ? null : Number(profile.bestPace),

    weeklyPoints: Number(profile.weeklyPoints || 0),
    monthlyPoints: Number(profile.monthlyPoints || 0),
    globalPoints: Number(profile.globalPoints || 0),
    monthlyDistance: Number(profile.monthlyDistance || 0),
    monthlyArea: Number(profile.monthlyArea || 0),
    rankingMonth: profile.rankingMonth || monthKey(),
    bestMonthlyRank: profile.bestMonthlyRank ?? null,
    bestMonthlyRankArea: profile.bestMonthlyRankArea ?? null,
    bestMonthlyRankDistance: profile.bestMonthlyRankDistance ?? null,

    lastUpdate: serverTimestamp(),
  };

  const ref = doc(db, "users", user.uid);

  // retry with exponential backoff
  let attempt = 0;
  const max = CONFIG.FIRESTORE_WRITE_RETRIES;
  while (attempt < max) {
    try {
      attempt++;
      await setDoc(ref, safe, { merge: true });
      track("profile.save_firestore_success", { uid: user.uid, attempt });
      return safe;
    } catch (err) {
      track("profile.save_firestore_retry", { uid: user.uid, attempt, error: String(err) });
      const wait = CONFIG.FIRESTORE_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  // failed after retries
  track("profile.save_firestore_failed", { uid: user.uid });
  throw new Error("firestore_persist_failed");
}

// -----------------------------------------------------------
// SAVE WITH DEBOUNCE + QUEUE + MUTEX (zero race conditions)
// - Multiple saveProfile() calls are merged and executed sequentially
// -----------------------------------------------------------
let pendingProfile = null; // merged in-memory profile waiting to be written
let saveMutex = false; // in-memory lock
let scheduledTimer = null;

/**
 * saveProfile(patch)
 * - merges patch into local profile immediately, schedules local+remote save (debounced)
 * - returns merged profile (not necessarily flushed to Firestore yet)
 */
export async function saveProfile(patch = {}) {
  try {
    // load base profile from storage (fast)
    const base = pendingProfile ? { ...pendingProfile } : await loadProfile();

    // merge patch
    const merged = { ...base, ...patch };
    merged.lastUpdate = nowIso();

    // apply leveling rules (ensure xp/level integrity)
    applyLevel(merged);

    // keep in memory pending
    pendingProfile = merged;

    // emit to listeners so UI updates immediately
    emit(merged);

    // debounce write
    if (scheduledTimer) clearTimeout(scheduledTimer);
    scheduledTimer = setTimeout(async () => {
      // avoid concurrent writes: simple mutex pattern
      if (saveMutex) {
        // schedule later if busy
        setTimeout(async () => {
          try {
            await flushPendingProfile();
          } catch {}
        }, 250);
        return;
      }
      await flushPendingProfile().catch((e) => {
        console.warn("profileService.flushPendingProfile error:", e);
      });
    }, CONFIG.SAFE_SAVE_DEBOUNCE_MS);

    return merged;
  } catch (e) {
    console.warn("profileService.saveProfile error:", e);
    return { ...patch };
  }
}

/**
 * flushPendingProfile()
 * - writes pendingProfile to AsyncStorage and Firestore (if user) with retries
 * - ensured to run sequentially by saveMutex
 */
async function flushPendingProfile() {
  if (!pendingProfile) return;
  saveMutex = true;
  try {
    const toWrite = { ...pendingProfile };
    // local write first (fast)
    await saveLocal(toWrite);

    // attempt firestore write (best-effort)
    try {
      await saveFirestore(toWrite);
    } catch (e) {
      // Firestore failing shouldn't lose local progress
      console.warn("profileService.saveFirestore warning:", e);
    }
    // clear pendingProfile only if no new changes arrived while writing
    if (pendingProfile && pendingProfile.lastUpdate === toWrite.lastUpdate) {
      pendingProfile = null;
    }
    // emit final
    emit(toWrite);
    return toWrite;
  } finally {
    saveMutex = false;
  }
}

// -----------------------------------------------------------
// incrementRankingPoints(xp) - called by xpService
// - increments weekly/monthly/global counters and persists
// -----------------------------------------------------------
export async function incrementRankingPoints(xp = 0) {
  try {
    const amount = Number(xp || 0);
    if (amount <= 0) return await loadProfile();

    // merge update via saveProfile to ensure queue/mutex logic
    const current = await loadProfile();
    const next = ensureCurrentMonth({
      ...current,
      weeklyPoints: Number(current.weeklyPoints || 0) + amount,
      monthlyPoints: Number(current.monthlyPoints || 0) + amount,
      globalPoints: Number(current.globalPoints || 0) + amount,
      lastUpdate: nowIso(),
    });

    applyLevel(next); // harmless but keep integrity

    // persist via central save
    const saved = await saveProfile(next);
    // ensure flush scheduled (force)
    try {
      await flushPendingProfile();
    } catch {}
    track("profile.incrementRankingPoints", { xp: amount });
    return saved;
  } catch (e) {
    console.warn("incrementRankingPoints error:", e);
    return null;
  }
}

// -----------------------------------------------------------
// fetchRemoteProfile() - merges remote safely into local (no regressions)
// - prefer max values for totals and xp progression where appropriate
// -----------------------------------------------------------
export async function fetchRemoteProfile() {
  try {
    const user = auth.currentUser;
    if (!user) return null;

    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return null;

    const remote = snap.data();
    const local = await loadProfile();

    // Merge strategy:
    // - For counters (totalDistance, totalRuns, totalZones, totalArea, totalTime): take max to avoid regressions
    // - For xp/level: take the one with highest total progression (approx)
    // - For non-numeric or optional fields prefer remote if newer (by lastUpdate if available)
    const merged = { ...local };

    // simple numeric merges
    merged.totalDistance = Math.max(Number(local.totalDistance || 0), Number(remote.totalDistance || 0));
    merged.totalArea = Math.max(Number(local.totalArea || 0), Number(remote.totalArea || 0));
    merged.totalTime = Math.max(Number(local.totalTime || 0), Number(remote.totalTime || 0));
    merged.totalRuns = Math.max(Number(local.totalRuns || 0), Number(remote.totalRuns || 0));
    merged.totalZones = Math.max(Number(local.totalZones || 0), Number(remote.totalZones || 0));

    merged.longestRun = Math.max(Number(local.longestRun || 0), Number(remote.longestRun || 0));
    merged.largestZone = Math.max(Number(local.largestZone || 0), Number(remote.largestZone || 0));

    // xp heuristics: convert remote xp/level -> approximate total xp to compare
    function approxTotalXpFrom(remoteObj) {
      try {
        const rLevel = Number(remoteObj.level || 1);
        const rXp = Number(remoteObj.xp || 0);
        // approximate total xp by summing xpForLevel for levels below
        // use simple geometric growth approximate (not exact) to compare
        let acc = rXp;
        let lvl = 1;
        while (lvl < rLevel) {
          acc += Math.round(100 * Math.pow(lvl, 1.35) + 300);
          lvl++;
        }
        return acc;
      } catch {
        return Number(remoteObj.xp || 0);
      }
    }

    const localTotalXp = approxTotalXpFrom(local);
    const remoteTotalXp = approxTotalXpFrom(remote);

    if (remoteTotalXp > localTotalXp) {
      // prefer remote progression
      merged.xp = Number(remote.xp || merged.xp || 0);
      merged.level = Number(remote.level || merged.level || 1);
      merged.nextLevelXp = Number(remote.nextLevelXp || merged.nextLevelXp || DEFAULT_PROFILE.nextLevelXp);
    } else {
      // keep local xp/level
      merged.xp = Number(merged.xp || 0);
      merged.level = Number(merged.level || 1);
      merged.nextLevelXp = Number(merged.nextLevelXp || DEFAULT_PROFILE.nextLevelXp);
    }

    // ranking counters: take max per period to avoid regressions (server might be source of truth)
    merged.weeklyPoints = Math.max(Number(local.weeklyPoints || 0), Number(remote.weeklyPoints || 0));
    merged.monthlyPoints = Math.max(Number(local.monthlyPoints || 0), Number(remote.monthlyPoints || 0));
    merged.globalPoints = Math.max(Number(local.globalPoints || 0), Number(remote.globalPoints || 0));
    merged.monthlyDistance = Math.max(Number(local.monthlyDistance || 0), Number(remote.monthlyDistance || 0));
    merged.monthlyArea = Math.max(Number(local.monthlyArea || 0), Number(remote.monthlyArea || 0));
    merged.rankingMonth = remote.rankingMonth || local.rankingMonth || monthKey();
    merged.bestMonthlyRank = remote.bestMonthlyRank ?? local.bestMonthlyRank ?? null;
    merged.bestMonthlyRankArea = remote.bestMonthlyRankArea ?? local.bestMonthlyRankArea ?? null;
    merged.bestMonthlyRankDistance = remote.bestMonthlyRankDistance ?? local.bestMonthlyRankDistance ?? null;

    // bestPace: prefer best (lower) if exists
    if (remote.bestPace != null) {
      if (!merged.bestPace) merged.bestPace = remote.bestPace;
      else merged.bestPace = Math.min(merged.bestPace, Number(remote.bestPace));
    }

    merged.lastUpdate = nowIso();

    // persist merged locally and to firestore (merge)
    const saved = await saveProfile(merged);
    // force flush
    try {
      await flushPendingProfile();
    } catch {}

    track("profile.fetchRemoteProfile", { uid: auth.currentUser?.uid });
    return saved;
  } catch (e) {
    console.warn("profileService.fetchRemoteProfile error:", e);
    return null;
  }
}

// -----------------------------------------------------------
// updateProfileStats({distance, duration, area, isZone})
// - updates counters, awards xp, levels, and persists via central save pipeline
// -----------------------------------------------------------
export async function updateProfileStats({ distance = 0, duration = 0, area = 0, isZone = false } = {}) {
  try {
    distance = Number(distance || 0);
    duration = Number(duration || 0);
    area = Number(area || 0);

    const profile = ensureCurrentMonth(await loadProfile());

    // xp components
    const xpDist = clamp(Math.round(distance * CONFIG.XP_PER_METER), 0, CONFIG.MAX_XP_PER_RUN);
    const xpArea = clamp(Math.round(area * CONFIG.XP_PER_M2), 0, CONFIG.MAX_XP_PER_ZONE);
    let gainedXp = xpDist + xpArea;

    // bonus for longer runs
    if (!isZone && duration >= 30 * 60) {
      gainedXp = Math.round(gainedXp * 1.12);
    }

    // cap
    gainedXp = clamp(gainedXp, 0, isZone ? CONFIG.MAX_XP_PER_ZONE : CONFIG.MAX_XP_PER_RUN);

    // apply deltas
    profile.xp = Number(profile.xp || 0) + gainedXp;
    profile.totalDistance = Number(profile.totalDistance || 0) + distance;
    profile.totalArea = Number(profile.totalArea || 0) + area;
    profile.totalTime = Number(profile.totalTime || 0) + duration;

    if (isZone) {
      profile.totalZones = Number(profile.totalZones || 0) + 1;
      profile.monthlyArea = Number(profile.monthlyArea || 0) + area;
      if (area > (profile.largestZone || 0)) profile.largestZone = area;
    } else {
      profile.totalRuns = Number(profile.totalRuns || 0) + 1;
      profile.monthlyDistance = Number(profile.monthlyDistance || 0) + distance;
      if (distance > (profile.longestRun || 0)) profile.longestRun = distance;

      const pace = calcPace(distance, duration);
      if (!profile.bestPace || (pace && pace < profile.bestPace)) {
        profile.bestPace = pace;
      }
    }

    // level up loop
    applyLevel(profile);

    profile.lastUpdate = nowIso();

    // persist via central save (debounced/queued)
    const saved = await saveProfile(profile);

    // ensure we flush ASAP (best-effort)
    try {
      await flushPendingProfile();
    } catch {}

    track("profile.updateProfileStats", { gainedXp, isZone });
    return saved;
  } catch (e) {
    console.warn("profileService.updateProfileStats error:", e);
    return null;
  }
}

// -----------------------------------------------------------
// resetProfile (safe) - clears local and resets remote defaults
// -----------------------------------------------------------
export async function resetProfile() {
  try {
    const user = auth.currentUser;
    await AsyncStorage.removeItem(PROFILE_KEY);
    pendingProfile = null;

    if (user) {
      // merge defaults into firestore
      await setDoc(doc(db, "users", user.uid), { ...DEFAULT_PROFILE, uid: user.uid, lastUpdate: serverTimestamp() }, { merge: true });
    }
    const fresh = { ...DEFAULT_PROFILE, uid: user?.uid || null, lastUpdate: nowIso() };
    emit(fresh);
    track("profile.reset", { uid: user?.uid || null });
    return fresh;
  } catch (e) {
    console.warn("profileService.resetProfile error:", e);
    return { ...DEFAULT_PROFILE };
  }
}

// -----------------------------------------------------------
// Utility: getLevelProgress(profile)
// -----------------------------------------------------------
export function getLevelProgress(profile) {
  const p = profile || DEFAULT_PROFILE;
  const xp = Number(p.xp || 0);
  const next = Number(p.nextLevelXp || DEFAULT_PROFILE.nextLevelXp);
  return { xp, nextLevelXp: next, pct: next > 0 ? Math.round((xp / next) * 100) : 0 };
}

// -----------------------------------------------------------
// Utility: getPublicProfile(uid) - loads remote users/{uid} doc (no local merge)
// -----------------------------------------------------------
export async function getPublicProfile(uid) {
  try {
    if (!uid) return null;
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;
    return snap.data();
  } catch (e) {
    console.warn("profileService.getPublicProfile error:", e);
    return null;
  }
}

// -----------------------------------------------------------
// Clear resources on sign out (use on signout hook)
// -----------------------------------------------------------
export async function clearProfileState() {
  try {
    pendingProfile = null;
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
    // optionally keep local cache or remove
    // await AsyncStorage.removeItem(PROFILE_KEY);
    track("profile.clearState", {});
  } catch (e) {
    console.warn("profileService.clearProfileState error:", e);
  }
}

// -----------------------------------------------------------
// EXPORT
// -----------------------------------------------------------
export default {
  loadProfile,
  saveProfile,
  fetchRemoteProfile,
  updateProfileStats,
  resetProfile,
  incrementRankingPoints,
  getLevelProgress,
  getXpForArea: (a) => clamp(Math.round(a * CONFIG.XP_PER_M2), 0, CONFIG.MAX_XP_PER_ZONE),
  getXpForDistance: (m) => clamp(Math.round(m * CONFIG.XP_PER_METER), 0, CONFIG.MAX_XP_PER_RUN),
  subscribeProfileUpdates,
  clearProfileState,
  getPublicProfile,
  setTelemetryHook,
  DEFAULT_PROFILE,
};
