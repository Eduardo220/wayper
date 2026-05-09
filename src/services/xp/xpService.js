// src/services/xp/xpService.js
// WAYPER — XP SERVICE (MINIMAL PRO MAX)
// - Versão enxuta, rápida e segura
// - Integrada ao profileService (stats + ranking points)
// - Anti-fraud básico, previews, persistência Firestore com retry
// - API pública: awardRunXP, awardZoneXP, awardPartnerXP, awardMedalXP, awardXP
// - Uso recomendado: mobile client (expo / react-native)

import AsyncStorage from "@react-native-async-storage/async-storage";
import { db, auth } from "../../firebaseConfig";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import * as profileService from "../profile/profileService";

const ENABLE_LOGS = false;
const log = (...a) => ENABLE_LOGS && console.log("[xpService]", ...a);

// Keys
const KEY_DAILY_PARTNERS = "xp_visited_partners_by_day_v2";
const KEY_ZONE_COOLDOWNS = "xp_zone_cooldowns_v1";

// Defaults / tuning (small, fácil de ajustar)
const DEFAULTS = {
  XP_PER_METER: 1 / 8,
  XP_PER_AREA: 1 / 15,
  XP_PER_SECOND: 1 / 20,
  MEDAL_BONUS_XP: 50,
  MIN_PARTNER_XP: 20,
  PARTNER_TIERS: { common: 1, rare: 1.25, epic: 1.5, legendary: 2 },
  MAX_SPEED_M_S: 10, // basic anti-fraud
  MAX_JUMP_M: 500,
  ZONE_COOLDOWN_MS: 20 * 60 * 1000, // 20min local cooldown
  PARTNER_COOLDOWN_MS: 24 * 60 * 60 * 1000, // 24h per partner
  WRITE_RETRIES: 3,
  WRITE_BACKOFF_MS: 600,
};

// Telemetry hook (opcional)
let telemetry = null;
export function setTelemetryHook(hook) {
  telemetry = hook && typeof hook.track === "function" ? hook : null;
}
function track(ev, payload = {}) {
  try {
    if (telemetry) telemetry.track(ev, payload);
  } catch (e) {
    log("telemetry error", e);
  }
}

// Helpers
const toNum = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (v, a = 0, b = Number.POSITIVE_INFINITY) => Math.max(a, Math.min(b, v));
const nowIso = () => new Date().toISOString();

// Minimal haversine (meters)
function haversineMeters(a, b) {
  try {
    const R = 6371e3;
    const toRad = (d) => (d * Math.PI) / 180;
    const φ1 = toRad(toNum(a.latitude));
    const φ2 = toRad(toNum(b.latitude));
    const Δφ = toRad(toNum(b.latitude) - toNum(a.latitude));
    const Δλ = toRad(toNum(b.longitude) - toNum(a.longitude));
    const aa =
      Math.sin(Δφ / 2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
    return R * c;
  } catch {
    return Infinity;
  }
}

// Anti-fraud basic: instantaneous jump or too many high-speed segments
export function antiFraudBasic(path = []) {
  if (!Array.isArray(path) || path.length < 2) return { ok: true };
  let highSpeedCount = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dt = Math.max(1, (toNum(b.timestamp) - toNum(a.timestamp)) / 1000);
    const d = haversineMeters(a, b);
    const speed = d / dt;
    if (!Number.isFinite(speed)) continue;
    if (d > DEFAULTS.MAX_JUMP_M) return { ok: false, reason: "instant_jump" };
    if (speed > DEFAULTS.MAX_SPEED_M_S) highSpeedCount++;
  }
  if (highSpeedCount > Math.max(2, Math.floor(path.length / 8))) return { ok: false, reason: "sustained_high_speed" };
  return { ok: true };
}

// Simple pacing multiplier — reward consistent movement (small bonus)
function simplePacingMultiplier(path = []) {
  if (!Array.isArray(path) || path.length < 3) return 1.0;
  const speeds = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dt = Math.max(1, (toNum(b.timestamp) - toNum(a.timestamp)) / 1000);
    const d = haversineMeters(a, b);
    speeds.push(d / dt);
  }
  if (!speeds.length) return 1.0;
  const mean = speeds.reduce((s, x) => s + x, 0) / speeds.length;
  const variance = speeds.reduce((s, x) => s + (x - mean) ** 2, 0) / speeds.length;
  const sd = Math.sqrt(variance) || 0.00001;
  const cv = sd / (mean || 0.00001);
  const raw = 1.12 - clamp(cv, 0, 1.2) * 0.18; // tuned light
  return clamp(raw, 0.85, 1.25);
}

// computeRunXP minimal but robust
export function computeRunXP({ path = [], distance = 0, durationMs = 0, area = 0 } = {}) {
  distance = Math.max(0, toNum(distance));
  durationMs = Math.max(0, toNum(durationMs));
  area = Math.max(0, toNum(area));
  const durationSec = Math.round(durationMs / 1000);

  const fromMeters = Math.round(distance * DEFAULTS.XP_PER_METER);
  const fromArea = Math.round(area * DEFAULTS.XP_PER_AREA);
  const fromTime = Math.round(durationSec * DEFAULTS.XP_PER_SECOND);

  const pacing = simplePacingMultiplier(path);

  // moving ratio: percent of time with speed >= walking threshold (0.4 m/s)
  let movingSec = 0;
  if (Array.isArray(path) && path.length > 1) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const dt = Math.max(1, (toNum(b.timestamp) - toNum(a.timestamp)) / 1000);
      const d = haversineMeters(a, b);
      const speed = d / dt;
      if (speed >= 0.4) movingSec += dt;
    }
  }
  const movingRatio = durationSec > 0 ? clamp(movingSec / durationSec, 0, 1) : 0.0;
  const activityMultiplier = 0.65 + 0.35 * movingRatio; // 0.65..1.0

  // simple long-run bonus
  let longRunMult = 1.0;
  if (durationSec >= 60 * 60) longRunMult = 1.22;
  else if (durationSec >= 40 * 60) longRunMult = 1.14;
  else if (durationSec >= 20 * 60) longRunMult = 1.08;

  const rawTotal = Math.round((fromMeters + fromArea + fromTime) * pacing * activityMultiplier * longRunMult);

  return {
    components: { fromMeters, fromArea, fromTime },
    multipliers: { pacing, activityMultiplier, longRunMult },
    movingRatio,
    rawTotal,
  };
}

// load/save helpers for partner/zone cooldowns
async function loadJSON(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
async function saveJSON(key, v) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(v || {}));
  } catch {}
}

// safe persist to Firestore (single merged write into users/{uid})
async function safePersistToFirestore(profileObj = {}) {
  const user = auth.currentUser;
  if (!user) {
    log("safePersistToFirestore: no user");
    return null;
  }

  const safePayload = {
    xp: toNum(profileObj.xp, 0),
    level: toNum(profileObj.level, 1),
    nextLevelXp: toNum(profileObj.nextLevelXp || 1000),
    totalDistance: toNum(profileObj.totalDistance, 0),
    totalArea: toNum(profileObj.totalArea, 0),
    totalTime: toNum(profileObj.totalTime, 0),
    totalRuns: toNum(profileObj.totalRuns, 0),
    totalZones: toNum(profileObj.totalZones, 0),
    longestRun: toNum(profileObj.longestRun, 0),
    largestZone: toNum(profileObj.largestZone, 0),
    bestPace: profileObj.bestPace == null ? null : toNum(profileObj.bestPace),
    weeklyPoints: toNum(profileObj.weeklyPoints || 0),
    monthlyPoints: toNum(profileObj.monthlyPoints || 0),
    globalPoints: toNum(profileObj.globalPoints || 0),
    lastUpdate: serverTimestamp(),
  };

  const userRef = doc(db, "users", user.uid);
  let attempt = 0;
  while (attempt < DEFAULTS.WRITE_RETRIES) {
    try {
      attempt++;
      await setDoc(userRef, safePayload, { merge: true });
      track("xp.persist_success", { uid: user.uid });
      return safePayload;
    } catch (e) {
      track("xp.persist_retry", { uid: user.uid, attempt, error: String(e) });
      await new Promise((r) => setTimeout(r, DEFAULTS.WRITE_BACKOFF_MS * attempt));
    }
  }
  track("xp.persist_failed", { uid: user ? user.uid : null });
  throw new Error("persist_failed");
}

/* =====================
   PUBLIC API
   ===================== */

/**
 * awardRunXP(runData, options)
 * runData: { path, distanceMeters, durationMs, area }
 * options: { persist: true|false } (default true)
 */
export async function awardRunXP(runData = {}, options = {}) {
  try {
    const { path = [], distanceMeters = 0, durationMs = 0, area = 0 } = runData;
    const opts = { persist: true, ...options };

    // anti-fraud
    const anti = antiFraudBasic(path);
    if (!anti.ok) {
      track("xp.fraud_block", { reason: anti.reason });
      return { blocked: true, reason: anti.reason };
    }

    // compute
    const computed = computeRunXP({ path, distance: distanceMeters, durationMs, area });
    const xp = Math.max(0, computed.rawTotal);

    // update profile stats (this handles xp & totals via profileService)
    const before = await profileService.loadProfile();
    const updated = await profileService.updateProfileStats({
      distance: distanceMeters,
      duration: Math.round(durationMs / 1000),
      area,
      isZone: false,
    });

    // increment ranking points by XP gained
    try {
      await profileService.incrementRankingPoints(xp);
    } catch (e) {
      // if not implemented, ignore silently
      log("incrementRankingPoints missing or failed", e);
    }

    // ensure xp increased (profileService should have done it) — if not, add direct award
    const after = await profileService.loadProfile();
    const deltaXp = Math.max(0, (after.xp || 0) - (before.xp || 0));
    if (deltaXp < xp) {
      // add missing xp
      await profileService.saveProfile({ xp: (after.xp || 0) + (xp - deltaXp) });
    }

    // persist aggregated profile to firestore
    if (opts.persist) {
      await safePersistToFirestore(await profileService.loadProfile());
    }

    track("xp.run_awarded", { xp, distance: distanceMeters });
    return { xp, computed, profile: await profileService.loadProfile() };
  } catch (e) {
    log("awardRunXP error", e);
    track("xp.run_error", { error: String(e) });
    return { error: String(e) };
  }
}

/**
 * awardZoneXP(zoneData, options)
 * zoneData: { id, area, contestedCount }
 */
export async function awardZoneXP(zoneData = {}, options = {}) {
  try {
    const { id: zoneId, area = 0, contestedCount = 1 } = zoneData;
    if (!zoneId) throw new Error("zoneId required");

    const cooldowns = await loadJSON(KEY_ZONE_COOLDOWNS);
    const now = Date.now();
    const last = cooldowns[zoneId] || 0;
    if (now - last < DEFAULTS.ZONE_COOLDOWN_MS) {
      track("xp.zone_ignored_recent", { zoneId });
      return { xp: 0, reason: "cooldown" };
    }

    const base = Math.round(area * DEFAULTS.XP_PER_AREA);
    const contestedBonus = Math.round(Math.log(Math.max(1, contestedCount)) * 10);
    let xp = base + contestedBonus;
    if (area < 50) xp = Math.round(xp * 1.12);
    xp = clamp(xp, 0, 20000);

    // apply stats + ranking increment
    await profileService.updateProfileStats({ distance: 0, duration: 0, area, isZone: true });
    try { await profileService.incrementRankingPoints(xp); } catch {}

    // persist
    if (options.persist !== false) await safePersistToFirestore(await profileService.loadProfile());

    // set cooldown locally
    cooldowns[zoneId] = now;
    await saveJSON(KEY_ZONE_COOLDOWNS, cooldowns);

    track("xp.zone_awarded", { xp, zoneId });
    return { xp, profile: await profileService.loadProfile() };
  } catch (e) {
    log("awardZoneXP error", e);
    track("xp.zone_error", { error: String(e) });
    return { error: String(e) };
  }
}

/**
 * awardPartnerXP(partner, options)
 * partner: { id, tier?, bonusXP? }
 */
export async function awardPartnerXP(partner = {}, options = {}) {
  try {
    if (!partner || !partner.id) throw new Error("partner.id required");
    const tier = partner.tier || "common";
    const mult = DEFAULTS.PARTNER_TIERS[tier] || 1;
    const base = Math.max(toNum(partner.bonusXP, DEFAULTS.MIN_PARTNER_XP), DEFAULTS.MIN_PARTNER_XP);
    const xp = Math.round(base * mult);

    // daily visited check
    const today = new Date().toISOString().slice(0, 10);
    const visited = await loadJSON(KEY_DAILY_PARTNERS);
    if (!visited[today]) visited[today] = [];
    if (visited[today].includes(partner.id)) {
      track("xp.partner_duplicate", { partnerId: partner.id });
      return { alreadyVisited: true, xp: 0, profile: await profileService.loadProfile() };
    }

    // apply (no deltas)
    await awardXP(xp, {}, { persist: true });

    // mark visited
    visited[today].push(partner.id);
    await saveJSON(KEY_DAILY_PARTNERS, visited);

    track("xp.partner_awarded", { xp, partnerId: partner.id, tier });
    return { xp, profile: await profileService.loadProfile() };
  } catch (e) {
    log("awardPartnerXP error", e);
    track("xp.partner_error", { error: String(e) });
    return { error: String(e) };
  }
}

/**
 * awardMedalXP(medalName)
 */
export async function awardMedalXP(medalName = "medal", options = {}) {
  try {
    const xp = DEFAULTS.MEDAL_BONUS_XP;
    await awardXP(xp, {}, options);
    track("xp.medal_awarded", { xp, medalName });
    return { xp, profile: await profileService.loadProfile() };
  } catch (e) {
    log("awardMedalXP error", e);
    return { error: String(e) };
  }
}

/**
 * awardXP(amount, deltas, options)
 * amount: number, deltas: { distance, duration, area, isZone }
 */
export async function awardXP(amount = 0, deltas = {}, options = {}) {
  try {
    const safeAmount = Math.max(0, Math.round(toNum(amount)));
    if (safeAmount === 0) return { applied: 0, profile: await profileService.loadProfile() };

    // if there are deltas, update stats which may also award XP logic in profileService
    if (deltas && (deltas.distance || deltas.duration || deltas.area)) {
      await profileService.updateProfileStats({
        distance: toNum(deltas.distance || 0),
        duration: toNum(deltas.duration || 0),
        area: toNum(deltas.area || 0),
        isZone: !!deltas.isZone,
      });
    }

    // direct XP bump
    const before = await profileService.loadProfile();
    const newXp = (before.xp || 0) + safeAmount;
    await profileService.saveProfile({ xp: newXp });

    // increment ranking points
    try { await profileService.incrementRankingPoints(safeAmount); } catch (e) { log("incRanking failed", e); }

    // persist
    if (options.persist !== false) await safePersistToFirestore(await profileService.loadProfile());

    track("xp.direct_awarded", { xp: safeAmount });
    return { applied: safeAmount, profile: await profileService.loadProfile() };
  } catch (e) {
    log("awardXP error", e);
    track("xp.direct_error", { error: String(e) });
    return { error: String(e) };
  }
}

/* Previews */
export function computeRunXPPreview(runData = {}) {
  return computeRunXP(runData);
}
export function computeZoneXPPreview(zoneData = {}) {
  const area = toNum(zoneData.area || 0);
  const contestedCount = Math.max(1, toNum(zoneData.contestedCount || 1));
  const base = Math.round(area * DEFAULTS.XP_PER_AREA);
  const contestedBonus = Math.round(Math.log(Math.max(1, contestedCount)) * 10);
  let xp = base + contestedBonus;
  if (area < 50) xp = Math.round(xp * 1.12);
  return { xp: clamp(xp, 0, 20000), components: { base, contestedBonus } };
}

// Exports
const xpService = {
  awardRunXP,
  awardZoneXP,
  awardPartnerXP,
  awardMedalXP,
  awardXP,
  computeRunXPPreview,
  computeZoneXPPreview,
  setTelemetryHook,
  // internals for testing/debug
  _internals: { computeRunXP, antiFraudBasic, safePersistToFirestore },
};

export default xpService;
