// src/services/xp/xpService.js
// -----------------------------------------------------------
// xpService.js — ULTIMATE XP ENGINE (corridas, zonas, parceiros)
// - Integrado com profileService (local + sync Firestore)
// - Segurança, validação, batching Firestore, single-responsibility
// - API pública compatível: awardRunXP, awardPartnerXP, awardMedalXP, awardXP
// -----------------------------------------------------------

import AsyncStorage from "@react-native-async-storage/async-storage";
import { db, auth } from "../../firebaseConfig";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

import { loadProfile, saveProfile } from "../profile/profileService";

// ---------------------------- CONSTANTS ----------------------------
const KEY_DAILY_PARTNERS = "xp_visited_partners_by_day_v1";

const DEFAULTS = {
  XP_PER_METER: 1 / 8, // 1 XP a cada 8m
  XP_PER_AREA: 1 / 15, // 1 XP a cada 15m²
  XP_PER_SECOND: 1 / 20, // 1 XP a cada 20s correndo
  LEVEL_MULTIPLIER: 1.32, // curva de XP ao subir de level
  MIN_PARTNER_XP: 20,
  MEDAL_BONUS_XP: 50,
  LEVEL_UP_BONUS: 100, // bônus ao subir level
};

// small helper to safely coerce numbers
const toNum = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// safe logger wrapper
const debug = (...args) => {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[xpService]", ...args);
  }
};

// ---------------------------- DAILY VISITED CACHE ----------------------------
async function loadVisitedMap() {
  try {
    const raw = await AsyncStorage.getItem(KEY_DAILY_PARTNERS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    debug("loadVisitedMap error:", err);
    return {};
  }
}

async function saveVisitedMap(map) {
  try {
    await AsyncStorage.setItem(KEY_DAILY_PARTNERS, JSON.stringify(map || {}));
  } catch (err) {
    debug("saveVisitedMap error:", err);
  }
}

// ---------------------------- XP CALCS ----------------------------
export function computeRunXP({ distance = 0, duration = 0, area = 0 }) {
  // sanitize inputs
  distance = Math.max(0, toNum(distance));
  duration = Math.max(0, toNum(duration));
  area = Math.max(0, toNum(area));

  const fromMeters = Math.round(distance * DEFAULTS.XP_PER_METER);
  const fromArea = Math.round(area * DEFAULTS.XP_PER_AREA);
  const fromTime = Math.round(duration * DEFAULTS.XP_PER_SECOND);

  const total = Math.max(0, fromMeters + fromArea + fromTime);

  return {
    fromMeters,
    fromArea,
    fromTime,
    total,
  };
}

export async function computePartnerXP(partner = {}) {
  // sanitize
  const base = Math.max(toNum(partner.bonusXP, 0), DEFAULTS.MIN_PARTNER_XP);
  // You can extend this: read streak, partner rarity, time-based bonuses, etc.
  const streakMultiplier = 1.25;
  const xpFinal = Math.round(base * streakMultiplier);
  return xpFinal;
}

// ---------------------------- LEVEL & PROFILE APPLY ----------------------------
/**
 * applyXPToProfile
 * - Aplica XP no profile local (loadProfile/saveProfile)
 * - Aceita `deltas` para manter totais (distance, area, duration, isZone)
 * - Atualiza longestRun/largestZone/bestPace/totalRuns/totalZones
 */
async function applyXPToProfile(rawXP = 0, deltas = {}) {
  try {
    const xpToAdd = Math.max(0, Math.round(toNum(rawXP)));
    const distance = Math.max(0, toNum(deltas.distance));
    const area = Math.max(0, toNum(deltas.area));
    const duration = Math.max(0, toNum(deltas.duration));
    const isZone = Boolean(deltas.isZone);

    // load local profile
    let profile = (await loadProfile()) || {};
    // merge against defaults defensively
    profile = { ...(profile || {}), ...profile };

    // ensure numeric fields exist
    profile.xp = toNum(profile.xp, 0);
    profile.level = toNum(profile.level, 1);
    profile.nextLevelXp = Math.max(1, toNum(profile.nextLevelXp, 1000));
    profile.totalDistance = toNum(profile.totalDistance, 0);
    profile.totalArea = toNum(profile.totalArea, 0);
    profile.totalTime = toNum(profile.totalTime, 0);
    profile.totalRuns = toNum(profile.totalRuns, 0);
    profile.totalZones = toNum(profile.totalZones, 0);
    profile.longestRun = toNum(profile.longestRun, 0);
    profile.largestZone = toNum(profile.largestZone, 0);
    profile.bestPace = profile.bestPace == null ? null : toNum(profile.bestPace);

    // apply xp and deltas
    profile.xp += xpToAdd;
    profile.totalDistance += distance;
    profile.totalArea += area;
    profile.totalTime += duration;

    if (isZone) {
      profile.totalZones += 1;
      if (area > profile.largestZone) profile.largestZone = area;
    } else if (distance > 0) {
      profile.totalRuns += 1;
      if (distance > profile.longestRun) profile.longestRun = distance;

      // pace: seconds per km
      if (duration > 0 && distance > 0) {
        const pace = duration / (distance / 1000);
        if (!profile.bestPace || (pace && pace < profile.bestPace)) {
          profile.bestPace = pace;
        }
      }
    }

    // level-up loop (stable incremental)
    while (profile.xp >= profile.nextLevelXp) {
      profile.xp -= profile.nextLevelXp;
      profile.level += 1;
      profile.nextLevelXp = Math.max(1, Math.round(profile.nextLevelXp * DEFAULTS.LEVEL_MULTIPLIER));
      // optional level-up bonus applied as XP (keeps player moving forward)
      profile.xp += DEFAULTS.LEVEL_UP_BONUS;
    }

    profile.lastUpdate = new Date().toISOString();

    const saved = await saveProfile(profile);
    return saved;
  } catch (err) {
    debug("applyXPToProfile error:", err);
    throw err;
  }
}

// ---------------------------- FIRESTORE SYNC (single write, merged) ----------------------------
async function persistProfileToFirestore(updatedProfile = {}) {
  try {
    const user = auth.currentUser;
    if (!user) {
      debug("persistProfileToFirestore: no authenticated user.");
      return null;
    }

    const safe = {
      xp: toNum(updatedProfile.xp, 0),
      level: toNum(updatedProfile.level, 1),
      nextLevelXp: toNum(updatedProfile.nextLevelXp, 1000),
      totalDistance: toNum(updatedProfile.totalDistance, 0),
      totalArea: toNum(updatedProfile.totalArea, 0),
      totalTime: toNum(updatedProfile.totalTime, 0),
      totalRuns: toNum(updatedProfile.totalRuns, 0),
      totalZones: toNum(updatedProfile.totalZones, 0),
      longestRun: toNum(updatedProfile.longestRun, 0),
      largestZone: toNum(updatedProfile.largestZone, 0),
      bestPace: updatedProfile.bestPace == null ? null : toNum(updatedProfile.bestPace),
      lastUpdate: serverTimestamp(),
    };

    const profileRef = doc(db, "profiles", user.uid);
    // single merge write
    await setDoc(profileRef, safe, { merge: true });
    return safe;
  } catch (err) {
    debug("persistProfileToFirestore error:", err);
    throw err;
  }
}

// ---------------------------- PUBLIC: awardRunXP ----------------------------
/**
 * awardRunXP({ distance, duration, area })
 * - returns { xpBreakdown, appliedXP, profile }
 */
export async function awardRunXP({ distance = 0, duration = 0, area = 0 } = {}) {
  try {
    // sanitize
    distance = Math.max(0, toNum(distance));
    duration = Math.max(0, toNum(duration));
    area = Math.max(0, toNum(area));

    const xpBreakdown = computeRunXP({ distance, duration, area });
    const totalXP = xpBreakdown.total;

    // apply to local profile and update totals in same call
    const updatedProfile = await applyXPToProfile(totalXP, { distance, duration, area, isZone: false });

    // persist once to Firestore (single merged write)
    await persistProfileToFirestore(updatedProfile);

    return {
      xpBreakdown,
      applied: totalXP,
      profile: updatedProfile,
    };
  } catch (err) {
    debug("awardRunXP error:", err);
    return null;
  }
}

// ---------------------------- PUBLIC: awardPartnerXP ----------------------------
/**
 * awardPartnerXP(partner)
 * - prevents duplicate partner XP in same day (local cache)
 * - returns { xp, profile, alreadyVisited }
 */
export async function awardPartnerXP(partner = {}) {
  try {
    if (!partner || !partner.id) throw new Error("partner must have an id");

    const user = auth.currentUser;
    if (!user) {
      debug("awardPartnerXP: no authenticated user");
      return null;
    }

    const today = new Date().toISOString().slice(0, 10);
    const visited = await loadVisitedMap();
    if (!visited[today]) visited[today] = [];

    if (visited[today].includes(partner.id)) {
      return { alreadyVisited: true, xp: 0, profile: await loadProfile() };
    }

    const xp = await computePartnerXP(partner);

    // apply xp and persist locally
    const updatedProfile = await applyXPToProfile(xp, { distance: 0, duration: 0, area: 0, isZone: false });

    // mark visited and save cache
    visited[today].push(partner.id);
    await saveVisitedMap(visited);

    // persist once to Firestore with visited partners
    try {
      const userRef = doc(db, "profiles", user.uid);
      const payload = {
        xp: updatedProfile.xp,
        level: updatedProfile.level,
        nextLevelXp: updatedProfile.nextLevelXp,
        lastPartner: partner.id,
        lastPartnerXP: xp,
        // store visited structure (careful, could be large; stored by date)
        visitedPartners: visited,
        lastUpdate: serverTimestamp(),
      };
      await setDoc(userRef, payload, { merge: true });
    } catch (innerErr) {
      debug("awardPartnerXP firestore write failed:", innerErr);
      // don't abort; local profile is already updated
    }

    return { xp, profile: updatedProfile, alreadyVisited: false };
  } catch (err) {
    debug("awardPartnerXP error:", err);
    return null;
  }
}

// ---------------------------- PUBLIC: awardMedalXP ----------------------------
export async function awardMedalXP(medalName = "medal") {
  try {
    const xp = DEFAULTS.MEDAL_BONUS_XP;
    const updatedProfile = await applyXPToProfile(xp, { distance: 0, duration: 0, area: 0, isZone: false });

    const user = auth.currentUser;
    if (user) {
      try {
        await setDoc(
          doc(db, "profiles", user.uid),
          {
            xp: updatedProfile.xp,
            level: updatedProfile.level,
            nextLevelXp: updatedProfile.nextLevelXp,
            lastMedal: medalName,
            lastMedalXP: xp,
            lastUpdate: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (err) {
        debug("awardMedalXP firestore write failed:", err);
      }
    }

    return { xp, profile: updatedProfile };
  } catch (err) {
    debug("awardMedalXP error:", err);
    return null;
  }
}

// ---------------------------- PUBLIC: direct award ----------------------------
export async function awardXP(amount = 0, deltas = {}) {
  try {
    const safeAmount = Math.max(0, toNum(amount));
    const updatedProfile = await applyXPToProfile(safeAmount, deltas);

    // persist
    try {
      await persistProfileToFirestore(updatedProfile);
    } catch (e) {
      debug("awardXP persist failed:", e);
    }

    return { applied: safeAmount, profile: updatedProfile };
  } catch (err) {
    debug("awardXP error:", err);
    return null;
  }
}

// ---------------------------- EXPORT ----------------------------
export default {
  awardRunXP,
  awardPartnerXP,
  awardMedalXP,
  awardXP,
  computeRunXP,
  computePartnerXP,
};
