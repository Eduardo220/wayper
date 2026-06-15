import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, db } from "../firebaseConfig.js";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  fetchAllRanking,
  fetchLocalLeadersRanking,
  fetchMonthlyRanking,
  fetchWeeklyRanking,
} from "../services/ranking/index.js";
import { getRankingMonthKey } from "../services/ranking/constants.js";
import { normalizeLocalLeaderRanking } from "../services/ranking/ranking.localLeaders.js";
import { loadLocalTerritoryLeaderboards } from "../services/territory/index.js";
import { loadProfile, saveProfile } from "../services/profile/profileService.js";
import { getLocalProfileStats } from "./profileStats.js";

export const RANKING_SOURCE = {
  REMOTE: "remote",
  CACHE: "cache",
  LOCAL: "local",
  DEMO: "demo",
  EMPTY: "empty",
};

export const RANKING_CACHE_KEY_PREFIX = "wayper:rankingCache:v1";

const ok = (data, meta = {}) => ({
  data,
  source: meta.source || RANKING_SOURCE.EMPTY,
  loading: false,
  error: null,
  ...meta,
});

const fail = (error, fallback = [], meta = {}) => ({
  data: fallback,
  source: meta.source || RANKING_SOURCE.EMPTY,
  loading: false,
  error,
  ...meta,
});

function cacheKey(params = {}) {
  const stable = {
    scope: params.scope || "global",
    city: params.city || null,
    neighborhood: params.neighborhood || null,
    criterion: params.criterion || "area",
    period: params.period || "all",
    mode: params.mode || params.criterion || "area",
  };
  return `${RANKING_CACHE_KEY_PREFIX}:${JSON.stringify(stable)}`;
}

async function loadCache(params = {}) {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(params));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed?.data)) return null;
    return {
      ...parsed,
      updatedAt: parsed.updatedAt || parsed.cachedAt || null,
      cachedAt: parsed.cachedAt || parsed.updatedAt || null,
    };
  } catch {
    return null;
  }
}

async function saveCache(params = {}, data = []) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const payload = {
    data,
    cachedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: RANKING_SOURCE.REMOTE,
  };
  try {
    await AsyncStorage.setItem(cacheKey(params), JSON.stringify(payload));
  } catch {}
  return payload;
}

async function fetchRemoteRanking(params = {}) {
  const {
    period = "all",
    mode = params.criterion || "area",
  } = params;
  const args = {
    scope: params.scope || "global",
    city: params.city || null,
    neighborhood: params.neighborhood || null,
    friendsList: params.friendsList || [],
    criterion: params.criterion || mode,
    limitTo: params.limitTo || 200,
  };

  if (mode === "localLeaders") return fetchLocalLeadersRanking({ limitTo: args.limitTo });
  if (period === "weekly") return fetchWeeklyRanking(args);
  if (period === "monthly" && !["stolenArea", "cellsLed"].includes(mode)) return fetchMonthlyRanking(args);
  return fetchAllRanking(args);
}

async function loadLocalLeaderFallback() {
  try {
    const leaderboards = await loadLocalTerritoryLeaderboards();
    const data = normalizeLocalLeaderRanking(Array.isArray(leaderboards) ? leaderboards : []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function normalizeMode(params = {}) {
  const mode = String(params.mode || params.criterion || "area");
  if (mode === "km") return "distance";
  if (mode === "totalRuns") return "runs";
  if (mode === "totalXp") return "xp";
  return mode;
}

function metricValue(item = {}, mode = "area", period = "all") {
  const normalizedMode = normalizeMode({ mode });
  const monthly = period === "monthly";
  if (normalizedMode === "distance") return Number(monthly ? item.monthlyDistance ?? item.distance : item.distance) || 0;
  if (normalizedMode === "xp") return Number(item.totalXp ?? item.xp) || 0;
  if (normalizedMode === "runs") return Number(item.totalRuns) || 0;
  if (normalizedMode === "localLeaders" || normalizedMode === "cellsLed") return Number(item.cellsLedCount) || 0;
  if (normalizedMode === "stolenArea") return Number(item.totalStolenAreaM2) || 0;
  return Number(monthly ? item.monthlyArea ?? item.area : item.area) || 0;
}

function hasRankingValue(item = {}, mode = "area", period = "all") {
  return metricValue(item, mode, period) > 0;
}

function normalizeName(profile = {}, user = null) {
  return profile.name ||
    profile.displayName ||
    profile.username ||
    user?.displayName ||
    user?.email?.split("@")?.[0] ||
    "Voce";
}

function normalizeAvatar(profile = {}) {
  return profile.avatar || profile.photoURL || null;
}

function buildLocalUserRow(stats = {}, profile = {}, request = {}) {
  const user = auth.currentUser;
  const id = String(user?.uid || profile.uid || stats.userId || "offline");
  if (!id) return null;

  const totalDistance = Number(stats.totalDistanceMeters || stats.totalDistance || 0);
  const totalArea = Number(stats.totalTerritoryAreaM2 || stats.totalArea || 0);
  const monthlyDistance = Number(stats.monthlyDistanceMeters || profile.monthlyDistance || 0);
  const monthlyArea = Number(stats.monthlyAreaM2 || profile.monthlyArea || 0);
  const totalXp = Number(stats.totalXp || profile.totalXp || 0);
  const totalRuns = Number(stats.totalRuns || profile.totalRuns || 0);

  const row = {
    id,
    userId: id,
    uid: id,
    name: normalizeName(profile, user),
    displayName: profile.displayName || profile.name || normalizeName(profile, user),
    username: profile.username || user?.email?.split("@")?.[0] || "",
    avatar: normalizeAvatar(profile),
    photoURL: profile.photoURL || profile.avatar || null,
    city: profile.city || "",
    source: RANKING_SOURCE.LOCAL,
    localOnly: true,
    totalXp,
    xp: totalXp,
    level: Number(stats.level || profile.level || 1),
    totalRuns,
    freeRuns: Number(stats.freeRuns || 0),
    zoneRuns: Number(stats.zoneRuns || 0),
    distance: totalDistance,
    totalDistance,
    monthlyDistance,
    area: totalArea,
    totalArea,
    monthlyArea,
    totalZones: Number(stats.totalZones || profile.totalZones || 0),
    cellsLedCount: Number(stats.totalCapturedCells || profile.cellsLedCount || 0),
    totalStolenAreaM2: Number(profile.totalStolenAreaM2 || 0),
    localUpdatedAt: stats.updatedAt || null,
    syncStatus: stats.syncStatus || "LOCAL_ONLY",
    pendingSyncCount: Number(stats.pendingSyncCount || 0),
  };

  return hasRankingValue(row, request.mode, request.period) ? row : null;
}

function mergeLocalRow(rows = [], localRow = null) {
  if (!localRow) return Array.isArray(rows) ? rows : [];
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id || row?.userId || row?.uid || "");
    if (id) map.set(id, row);
  }
  const localId = String(localRow.id || localRow.userId || localRow.uid);
  map.set(localId, {
    ...(map.get(localId) || {}),
    ...localRow,
    source: map.has(localId) ? map.get(localId)?.source || RANKING_SOURCE.CACHE : RANKING_SOURCE.LOCAL,
    localOverlay: map.has(localId),
  });
  return Array.from(map.values());
}

async function loadLocalUserRanking(request = {}) {
  try {
    const profile = await loadProfile();
    const userId = String(auth.currentUser?.uid || profile?.uid || "offline");
    const stats = await getLocalProfileStats({ userId });
    const row = buildLocalUserRow(stats, profile || {}, request);
    return row ? [row] : [];
  } catch {
    return [];
  }
}

function buildDemoRanking(request = {}) {
  if (request.allowDemo !== true || typeof __DEV__ === "undefined" || !__DEV__) return [];
  const mode = normalizeMode(request);
  const base = [
    { id: "demo-1", name: "Demo Wayper", totalRuns: 8, distance: 21000, monthlyDistance: 8000, area: 12000, monthlyArea: 3500, totalXp: 420, xp: 420, level: 4 },
    { id: "demo-2", name: "Atleta Demo", totalRuns: 5, distance: 14000, monthlyDistance: 6000, area: 8000, monthlyArea: 2500, totalXp: 280, xp: 280, level: 3 },
  ];
  return base
    .filter((item) => hasRankingValue(item, mode, request.period))
    .map((item, index) => ({ ...item, source: RANKING_SOURCE.DEMO, demo: true, rank: index + 1 }));
}

export async function listRanking(params = {}) {
  const request = {
    ...params,
    mode: params.mode || params.criterion || "area",
    period: params.period || "all",
  };

  try {
    const remote = await fetchRemoteRanking(request);
    if (Array.isArray(remote) && remote.length > 0) {
      await saveCache(request, remote);
      return ok(remote, { source: RANKING_SOURCE.REMOTE });
    }

    if (request.mode === "localLeaders") {
      const localLeaders = await loadLocalLeaderFallback();
      if (localLeaders.length > 0) {
        return ok(localLeaders, { source: RANKING_SOURCE.LOCAL });
      }
    }

    const cached = request.allowCache === false ? null : await loadCache(request);
    const localRanking = await loadLocalUserRanking(request);
    if (cached?.data?.length) {
      const data = mergeLocalRow(cached.data, localRanking[0]);
      return ok(data, {
        source: RANKING_SOURCE.CACHE,
        cachedAt: cached.cachedAt || null,
        updatedAt: cached.updatedAt || cached.cachedAt || null,
        localOverlay: localRanking.length > 0,
      });
    }

    if (localRanking.length > 0) {
      return ok(localRanking, {
        source: RANKING_SOURCE.LOCAL,
        updatedAt: localRanking[0]?.localUpdatedAt || null,
        limited: localRanking.length === 1,
      });
    }

    const demo = buildDemoRanking(request);
    if (demo.length > 0) {
      return ok(demo, { source: RANKING_SOURCE.DEMO, demo: true });
    }

    return ok([], { source: RANKING_SOURCE.EMPTY });
  } catch (error) {
    const cached = request.allowCache === false ? null : await loadCache(request);
    const localRanking = await loadLocalUserRanking(request);
    if (cached?.data?.length) {
      const data = mergeLocalRow(cached.data, localRanking[0]);
      return fail(error, data, {
        source: RANKING_SOURCE.CACHE,
        cachedAt: cached.cachedAt || null,
        updatedAt: cached.updatedAt || cached.cachedAt || null,
        localOverlay: localRanking.length > 0,
      });
    }
    if (localRanking.length > 0) {
      return fail(error, localRanking, {
        source: RANKING_SOURCE.LOCAL,
        updatedAt: localRanking[0]?.localUpdatedAt || null,
        limited: localRanking.length === 1,
      });
    }
    return fail(error, [], { source: RANKING_SOURCE.EMPTY });
  }
}

export async function persistMyMonthlyPreview(ranking = [], options = {}) {
  const uid = options.uid || auth.currentUser?.uid;
  const period = options.period || "monthly";
  const mode = options.mode || "area";

  if (!uid || period !== "monthly" || !["area", "distance"].includes(mode)) {
    return ok(null, { source: RANKING_SOURCE.LOCAL, skipped: true });
  }

  const me = (Array.isArray(ranking) ? ranking : []).find((item) => item?.id === uid);
  if (!me?.rank) return ok(null, { source: RANKING_SOURCE.LOCAL, skipped: true });

  const field = mode === "distance" ? "bestMonthlyRankDistance" : "bestMonthlyRankArea";
  const payload = {
    monthlyRankPreview: me.rank,
    [field]: me.rank,
    bestMonthlyRank: me.rank,
    rankingMonth: getRankingMonthKey(),
  };

  try {
    await saveProfile(payload);
  } catch {}

  try {
    await setDoc(
      doc(db, "users", uid),
      {
        ...payload,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return ok(payload, { source: RANKING_SOURCE.REMOTE, syncStatus: "SYNCED" });
  } catch (error) {
    return fail(error, payload, {
      source: RANKING_SOURCE.LOCAL,
      syncStatus: "SYNC_FAILED",
    });
  }
}

export default {
  RANKING_SOURCE,
  listRanking,
  persistMyMonthlyPreview,
};
