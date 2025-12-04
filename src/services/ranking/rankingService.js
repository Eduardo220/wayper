// src/services/rankingService.js
/**
 * rankingService.js — ULTIMATE PRO MAX
 *
 * Melhorias:
 *  - Caching TTL para reduzir leituras Firestore
 *  - Batched / paginated queries para respeitar limites Firestore
 *  - Score composto (normalização Z-score + pesos) para ranking justo
 *  - Percentis, ties handling, position by user
 *  - API compatível com fetchRanking({...}) antiga
 *  - computeLeaderboard(users, options) para uso offline/test
 *  - Telemetry hook optional (sentry/analytics)
 *
 * Nota: mantém compatibilidade com os campos exportados RANK_FIELDS e
 * função calculateEloChanges (comportamento preservado).
 */

import { db } from "./firebase";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDoc,
  doc,
} from "firebase/firestore";

/* ========================= Configuration ========================= */

const DEFAULT_LIMIT = 100;
const CACHE_TTL_MS = 1000 * 60 * 2; // 2 minutes cache default
const MAX_FIRESTORE_PAGE = 500; // limit per page to avoid large reads

// Default weights for composite score - tweak to taste
const DEFAULT_WEIGHTS = {
  zones: 1.0,
  area: 0.6,
  xp: 0.8,
  elo: 0.9,
  runs: 0.7,
  speed: 0.5,
};

// Map of available rankable fields (keeps compatibility)
export const RANK_FIELDS = {
  zones: "zones", // zonas capturadas
  area: "area", // área total dominada
  xp: "xp", // experiência total
  elo: "eloScore", // elo estilo Clash Royale
  runs: "totalRuns", // corridas livres
  speed: "topSpeed", // maior velocidade atingida
};

/* ========================= In-memory cache ========================= */
const _cache = new Map(); // key -> { ts, data }

/* Helper: simple TTL cache get/set */
function cacheGet(key, ttl = CACHE_TTL_MS) {
  const v = _cache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > ttl) {
    _cache.delete(key);
    return null;
  }
  return v.data;
}
function cacheSet(key, data) {
  _cache.set(key, { ts: Date.now(), data });
}

/* ========================= Utilities ========================= */

const safeNum = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function cleanUserForRanking(user) {
  if (!user || typeof user !== "object") return {};
  return {
    id: user.id || user.uid || null,
    name: user.name || "Jogador",
    avatar: user.avatar || null,
    city: user.city || "",
    neighborhood: user.neighborhood || "",
    xp: safeNum(user.xp, 0),
    level: user.level || inferLevel(safeNum(user.xp, 0)),
    zones: safeNum(user.zones, 0),
    area: safeNum(user.area, 0),
    eloScore: safeNum(user.eloScore, 1000),
    totalRuns: safeNum(user.totalRuns, 0),
    topSpeed: safeNum(user.topSpeed, 0),
    // optional temporal metrics - used for daily/weekly/monthly leaderboards
    dailyPoints: safeNum(user.dailyPoints, 0),
    weeklyPoints: safeNum(user.weeklyPoints, 0),
    monthlyPoints: safeNum(user.monthlyPoints, 0),
    // keep raw payload for debugging or future metrics
    raw: user,
  };
}

function inferLevel(xp) {
  return Math.floor(1 + safeNum(xp) / 500);
}

function sanitizeCriterion(criterion) {
  return RANK_FIELDS[criterion] ? criterion : "zones";
}

/* Z-score normalization helper
   Accepts array of numeric values -> returns map index->zscore
*/
function zScoreNormalize(values) {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance) || 1;
  return values.map((v) => (v - mean) / sd);
}

/* Percentile calculation (exclusive) */
function percentileFromSorted(sortedValues, v) {
  if (!sortedValues.length) return 0;
  const idx = sortedValues.findIndex((x) => x >= v);
  if (idx === -1) return 100;
  return Math.round(((idx / (sortedValues.length - 1)) * 100) || 0);
}

/* stable sort awarding identical scores same position (ties) */
function assignPositionsByScore(arr, scoreKey = "score") {
  // arr: array of objects with scoreKey numeric; returns positions map id->position (1-based)
  const copy = arr.slice().sort((a, b) => safeNum(b[scoreKey]) - safeNum(a[scoreKey]));
  const positions = {};
  let pos = 1;
  for (let i = 0; i < copy.length; i++) {
    if (i > 0 && safeNum(copy[i][scoreKey]) < safeNum(copy[i - 1][scoreKey])) {
      pos = i + 1;
    }
    positions[copy[i].id || `${i}`] = pos;
  }
  return positions;
}

/* ========================= Firestore helpers ========================= */

/**
 * fetchUsersFromFirestore(options)
 * - support pagination, scoping and safe reads
 */
async function fetchUsersFromFirestore({ city, neighborhood, friendsList, scope, limitTo = DEFAULT_LIMIT, telemetry = null } = {}) {
  try {
    const col = collection(db, "users");
    let q = col;

    // apply scope filters
    if (scope === "regional" && city) {
      q = query(col, where("city", "==", city));
    } else if (scope === "neighborhood" && city && neighborhood) {
      q = query(col, where("city", "==", city), where("neighborhood", "==", neighborhood));
    } else if (scope === "friends" && Array.isArray(friendsList) && friendsList.length > 0) {
      // Firestore 'in' accepts max 10 items per query; batch if needed
      const chunks = [];
      const CHUNK_SIZE = 10;
      for (let i = 0; i < friendsList.length; i += CHUNK_SIZE) {
        chunks.push(friendsList.slice(i, i + CHUNK_SIZE));
      }
      const results = [];
      for (const c of chunks) {
        const q2 = query(col, where("__name__", "in", c), limit(limitTo));
        const snap = await getDocs(q2);
        snap.forEach((d) => results.push({ id: d.id, ...d.data() }));
      }
      return results;
    }

    // final query with orderBy to fetch top candidates by default criterion isn't needed here
    const finalQ = query(q, limit(Math.min(limitTo || DEFAULT_LIMIT, MAX_FIRESTORE_PAGE)));
    const snap = await getDocs(finalQ);
    const out = [];
    snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
    return out;
  } catch (err) {
    if (telemetry && typeof telemetry.track === "function") telemetry.track("ranking.firestore_error", { error: String(err) });
    console.error("fetchUsersFromFirestore error", err);
    return [];
  }
}

/* ========================= Core: computeLeaderboard ========================= */

/**
 * computeLeaderboard(users, options)
 * - users: array of raw user documents (already sanitized or raw)
 * - options: {
 *     weights: {zones, area, xp, elo, runs, speed},
 *     primaryCriterion: 'zones' | 'area' | ...
 *     telemetry: optional telemetry object
 *   }
 *
 * returns: {
 *   leaderboard: [ { id, name, avatar, score, components: {...}, percentiles: {...}, rank } ],
 *   positionsMap: { id -> rank },
 *   sorted: sorted array same as leaderboard
 * }
 */
export function computeLeaderboard(users = [], options = {}) {
  const { weights = DEFAULT_WEIGHTS, primaryCriterion = "zones", telemetry = null } = options;

  try {
    // sanitize users
    const clean = users.map((u) => {
      const c = cleanUserForRanking(u);
      if (!c.id && u.id) c.id = u.id;
      return c;
    });

    // derive numeric arrays for normalization
    const fields = Object.keys(weights);
    const arrays = {};
    fields.forEach((f) => {
      arrays[f] = clean.map((u) => safeNum(u[RANK_FIELDS[f]] || u[f] || 0, 0));
    });

    // compute z-scores per metric
    const zmaps = {};
    fields.forEach((f) => {
      zmaps[f] = zScoreNormalize(arrays[f]);
    });

    // compose final score as weighted sum of z-scores (more stable than raw sums)
    const scored = clean.map((u, idx) => {
      let score = 0;
      const components = {};
      fields.forEach((f) => {
        const z = Number.isFinite(zmaps[f][idx]) ? zmaps[f][idx] : 0;
        const w = safeNum(weights[f], 0);
        components[f] = { raw: arrays[f][idx] || 0, z: z, w };
        score += z * w;
      });
      // add small boost for primaryCriterion raw value to favor the chosen sort when z-scores are close
      const primaryRaw = safeNum(u[RANK_FIELDS[primaryCriterion]] || u[primaryCriterion] || 0);
      score += primaryRaw * 1e-6;
      return { ...u, score, components };
    });

    // sort descending by score
    scored.sort((a, b) => safeNum(b.score) - safeNum(a.score));

    // compute percentiles per primary metric for UI insights
    const primaryArr = scored.map((s) => safeNum(s[RANK_FIELDS[primaryCriterion]] || 0)).slice().sort((a, b) => a - b);
    const leaderboard = scored.map((s) => {
      const primaryVal = safeNum(s[RANK_FIELDS[primaryCriterion]] || 0);
      const pct = percentileFromSorted(primaryArr, primaryVal);
      return {
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        city: s.city,
        neighborhood: s.neighborhood,
        score: s.score,
        components: s.components,
        percentiles: { [primaryCriterion]: pct },
        raw: s.raw,
      };
    });

    // assign stable positions
    const positionsMap = assignPositionsByScore(leaderboard, "score");

    // attach rank to leaderboard entries
    const final = leaderboard.map((e) => ({ ...e, rank: positionsMap[e.id] || null }));

    // telemetry
    if (telemetry && typeof telemetry.track === "function") {
      telemetry.track("ranking.compute", { count: final.length, primary: primaryCriterion });
    }

    return { leaderboard: final, positionsMap };
  } catch (err) {
    if (options.telemetry && typeof options.telemetry.track === "function") {
      options.telemetry.track("ranking.compute_error", { error: String(err) });
    }
    console.error("computeLeaderboard error", err);
    return { leaderboard: [], positionsMap: {} };
  }
}

/* ========================= Public convenience API ========================= */

/**
 * fetchRanking(options)
 * options:
 *  - city, neighborhood
 *  - scope: 'global' | 'regional' | 'neighborhood' | 'friends'
 *  - criterion: primary sort criterion (string from RANK_FIELDS keys)
 *  - friendsList: array of friend uids (for 'friends' scope)
 *  - limitTo: number
 *  - weights: override weights map
 *  - useCache: boolean
 *  - telemetry: optional telemetry object (must implement track)
 *
 * returns: { leaderboard: [...], positionsMap: {...} }
 */
export async function fetchRanking({
  city = null,
  neighborhood = null,
  scope = "global",
  criterion = "zones",
  friendsList = [],
  limitTo = DEFAULT_LIMIT,
  weights = DEFAULT_WEIGHTS,
  useCache = true,
  telemetry = null,
} = {}) {
  try {
    const key = `ranking:${scope}:${criterion}:${city || ""}:${neighborhood || ""}:${(friendsList || []).slice(0, 20).join(",")}:${limitTo}:${JSON.stringify(weights)}`;

    if (useCache) {
      const cached = cacheGet(key);
      if (cached) return cached;
    }

    // fetch raw users from firestore respecting scope
    const rawUsers = await fetchUsersFromFirestore({ city, neighborhood, friendsList, scope, limitTo, telemetry });

    // sanitize and compute leaderboard
    const { leaderboard, positionsMap } = computeLeaderboard(rawUsers, {
      weights,
      primaryCriterion: sanitizeCriterion(criterion),
      telemetry,
    });

    const result = { leaderboard: leaderboard.slice(0, limitTo), positionsMap };

    cacheSet(key, result);

    if (telemetry && typeof telemetry.track === "function") {
      telemetry.track("ranking.fetch_success", { scope, criterion, count: result.leaderboard.length });
    }

    return result;
  } catch (err) {
    if (telemetry && typeof telemetry.track === "function") {
      telemetry.track("ranking.fetch_error", { error: String(err) });
    }
    console.error("fetchRanking error", err);
    return { leaderboard: [], positionsMap: {} };
  }
}

/**
 * fetchTopUsers(criteria) - convenience to fetch top users only (fast path)
 * criteria: { field: "zones"|"area"..., scope, city, neighborhood, limitTo }
 */
export async function fetchTopUsers({ field = "zones", scope = "global", city = null, neighborhood = null, limitTo = 10, telemetry = null } = {}) {
  try {
    const orderField = RANK_FIELDS[field] || RANK_FIELDS.zones;
    const col = collection(db, "users");
    let q = query(col, orderBy(orderField, "desc"), limit(Math.min(limitTo, MAX_FIRESTORE_PAGE)));
    // scope filters
    if (scope === "regional" && city) q = query(col, where("city", "==", city), orderBy(orderField, "desc"), limit(Math.min(limitTo, MAX_FIRESTORE_PAGE)));
    if (scope === "neighborhood" && city && neighborhood) q = query(col, where("city", "==", city), where("neighborhood", "==", neighborhood), orderBy(orderField, "desc"), limit(Math.min(limitTo, MAX_FIRESTORE_PAGE)));

    const snap = await getDocs(q);
    const out = [];
    snap.forEach((d) => out.push(cleanUserForRanking({ id: d.id, ...d.data() })));
    if (telemetry && typeof telemetry.track === "function") telemetry.track("ranking.top_fetched", { field, scope, count: out.length });
    return out;
  } catch (err) {
    if (telemetry && typeof telemetry.track === "function") telemetry.track("ranking.top_error", { error: String(err) });
    console.error("fetchTopUsers error", err);
    return [];
  }
}

/**
 * getUserPosition(userId, options)
 * - loads relevant users (scope) and returns the position of a specific user including surrounding context
 * returns: { position: number, total: number, userEntry, neighbors: [...] }
 */
export async function getUserPosition(userId, { scope = "global", city = null, neighborhood = null, friendsList = [], criterion = "zones", window = 5, telemetry = null } = {}) {
  try {
    if (!userId) return null;
    // Fetch all relevant users (cap to limit reasonable)
    const limitTo = 500;
    const { leaderboard } = await fetchRanking({ city, neighborhood, scope, criterion, friendsList, limitTo, useCache: false, telemetry });

    const idx = leaderboard.findIndex((u) => u.id === userId);
    if (idx === -1) {
      // maybe user not in that subset; try to fetch user's profile to compute relative rank via top users
      try {
        const userDoc = await getDoc(doc(db, "users", userId));
        const udata = userDoc.exists() ? cleanUserForRanking({ id: userDoc.id, ...userDoc.data() }) : null;
        return { position: null, total: leaderboard.length, userEntry: udata, neighbors: [] };
      } catch {
        return { position: null, total: leaderboard.length, userEntry: null, neighbors: [] };
      }
    }
    const position = leaderboard[idx].rank || idx + 1;
    // neighbors slice
    const start = Math.max(0, idx - window);
    const neighbors = leaderboard.slice(start, Math.min(leaderboard.length, idx + window + 1));
    return { position, total: leaderboard.length, userEntry: leaderboard[idx], neighbors };
  } catch (err) {
    if (telemetry && typeof telemetry.track === "function") telemetry.track("ranking.getUserPosition_error", { error: String(err) });
    console.error("getUserPosition error", err);
    return null;
  }
}

/* ========================= Elo change table (kept backwards compatible) ========================= */

export function calculateEloChanges(user, action) {
  // Ações possíveis: capture_zone, lose_zone, run, streak, season_bonus
  const table = {
    capture_zone: +25,
    lose_zone: -20,
    run: +5,
    streak: +50,
    season_bonus: +200,
  };

  return table[action] || 0;
}

/* ========================= Exports ========================= */

export default {
  fetchRanking,
  fetchTopUsers,
  computeLeaderboard,
  getUserPosition,
  calculateEloChanges,
  RANK_FIELDS,
  // cache control
  _cache,
  cacheGet,
  cacheSet,
};
