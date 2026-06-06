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
import { saveProfile } from "../services/profile/profileService.js";

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
    return Array.isArray(parsed?.data) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveCache(params = {}, data = []) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const payload = {
    data,
    cachedAt: new Date().toISOString(),
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
    if (cached?.data?.length) {
      return ok(cached.data, {
        source: RANKING_SOURCE.CACHE,
        cachedAt: cached.cachedAt || null,
      });
    }

    return ok([], { source: RANKING_SOURCE.EMPTY });
  } catch (error) {
    const cached = request.allowCache === false ? null : await loadCache(request);
    if (cached?.data?.length) {
      return fail(error, cached.data, {
        source: RANKING_SOURCE.CACHE,
        cachedAt: cached.cachedAt || null,
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
