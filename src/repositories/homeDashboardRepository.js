import { auth } from "../firebaseConfig.js";
import activeRunTrackingService from "../services/runTracking/activeRunTrackingService.js";
import { ACTIVE_RUN_STATUS } from "../services/runTracking/activeRunState.js";
import { calculatePaceSecondsPerKm } from "../utils/pace.js";
import { listAchievements } from "./achievementRepository.js";
import {
  buildLocalProfileStats,
  getRunDistanceMeters,
  getRunDurationSeconds,
  getRunMode,
  getRunTimestamp,
  getTerritoryAreaFromRun,
  isFailedSyncRecord,
  isFinishedRunForStats,
  isPendingSyncRecord,
  recordBelongsToUser,
} from "./profileStats.js";
import { getProgressSummary } from "./progressionRepository.js";
import { RANKING_SOURCE, listRanking } from "./rankingRepository.js";
import runRepository from "./runRepository.js";
import runSyncQueueRepository from "./runSyncQueueRepository.js";
import territoryRepository from "./territoryRepository.js";
import { loadCurrentProfile } from "./userProfileRepository.js";

export const HOME_DASHBOARD_SOURCE = {
  LOCAL: "local",
  CACHE: "cache",
  REMOTE: "remote",
  EMPTY: "empty",
};

const LIVE_ACTIVE_STATUSES = new Set([
  ACTIVE_RUN_STATUS.RUNNING,
  ACTIVE_RUN_STATUS.PAUSED,
  ACTIVE_RUN_STATUS.RECOVERING,
  ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
]);

const DEFAULT_RANKING_REQUEST = {
  mode: "xp",
  criterion: "xp",
  period: "all",
  scope: "global",
  limitTo: 10,
  allowCache: true,
  allowDemo: false,
};

const emptyResult = (data, source = HOME_DASHBOARD_SOURCE.LOCAL, error = null) => ({
  data,
  source,
  error,
});

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function dateString(value) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function resolveUserId(profileResult = null, options = {}) {
  return String(
    options.userId ||
      auth.currentUser?.uid ||
      profileResult?.data?.userDoc?.uid ||
      profileResult?.data?.userDoc?.id ||
      profileResult?.data?.profile?.uid ||
      "offline"
  );
}

function resolveDisplayProfile(profileResult = null) {
  const profile = profileResult?.data?.profile || {};
  const userDoc = profileResult?.data?.userDoc || {};
  return {
    ...profile,
    ...userDoc,
    uid: userDoc.uid || userDoc.id || profile.uid || auth.currentUser?.uid || "offline",
    name:
      userDoc.name ||
      userDoc.displayName ||
      profile.displayName ||
      profile.name ||
      auth.currentUser?.displayName ||
      "Atleta Wayper",
    username:
      userDoc.username ||
      profile.username ||
      auth.currentUser?.email?.split("@")?.[0] ||
      "wayper",
    avatar:
      userDoc.avatar ||
      userDoc.photoURL ||
      profile.avatar ||
      profile.photoURL ||
      auth.currentUser?.photoURL ||
      null,
  };
}

function runIdentityValues(run = {}) {
  return [run.id, run.localRunId, run.remoteRunId, run.runId, run.legacyId]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .map(String);
}

function sameRunIdentity(run = {}, id = null) {
  if (!id) return false;
  const target = String(id);
  return runIdentityValues(run).some((value) => value === target);
}

export function normalizeHomeActiveRun(snapshot = null) {
  if (!snapshot?.activeRunId) {
    return {
      hasActiveRun: false,
      activeRunId: null,
      status: "IDLE",
      actionLabel: "Iniciar corrida",
      message: "Pronto para registrar uma corrida livre ou por zonas.",
    };
  }

  const status = normalizeStatus(snapshot.status || ACTIVE_RUN_STATUS.RUNNING);
  if (!LIVE_ACTIVE_STATUSES.has(status)) {
    return {
      hasActiveRun: false,
      activeRunId: null,
      status: "IDLE",
      actionLabel: "Iniciar corrida",
      message: "Pronto para registrar uma corrida livre ou por zonas.",
    };
  }

  const isPaused = status === ACTIVE_RUN_STATUS.PAUSED;
  const distanceMeters = Math.max(0, toNumber(snapshot.distanceMeters ?? snapshot.distance, 0));
  const durationSeconds = Math.max(0, toNumber(snapshot.durationSeconds ?? snapshot.duration, 0));

  return {
    hasActiveRun: true,
    activeRunId: String(snapshot.activeRunId),
    status,
    mode: getRunMode(snapshot),
    startedAt: dateString(snapshot.startedAt),
    updatedAt: dateString(snapshot.lastUpdatedAt || snapshot.updatedAt),
    distanceMeters,
    durationSeconds,
    paceSecondsPerKm: calculatePaceSecondsPerKm(durationSeconds, distanceMeters / 1000) || null,
    actionLabel: isPaused ? "Retomar corrida" : "Continuar corrida",
    message: isPaused
      ? "Existe uma corrida pausada preservada localmente."
      : "Existe uma corrida ativa preservada localmente.",
  };
}

export function getLatestFinishedRun(runs = [], options = {}) {
  const activeRunId = options.activeRunId ? String(options.activeRunId) : null;
  const userId = options.userId || "offline";
  const finished = (Array.isArray(runs) ? runs : [])
    .filter((run) => isFinishedRunForStats(run))
    .filter((run) => recordBelongsToUser(run, userId))
    .filter((run) => !sameRunIdentity(run, activeRunId))
    .sort((a, b) => getRunTimestamp(b) - getRunTimestamp(a));

  return finished[0] || null;
}

export function normalizeHomeRun(run = null) {
  if (!run) return null;
  const distanceMeters = getRunDistanceMeters(run);
  const durationSeconds = getRunDurationSeconds(run);
  const mode = getRunMode(run);
  const territoryAreaM2 = getTerritoryAreaFromRun(run);
  const syncStatus = normalizeStatus(run.syncStatus || run.offlineStatus || (run.synced ? "SYNCED" : ""));
  const failedSync = isFailedSyncRecord(run);
  const pendingSync = isPendingSyncRecord(run) && !failedSync;

  return {
    id: run.id || run.localRunId || run.remoteRunId || run.runId || run.legacyId || null,
    localRunId: run.localRunId || null,
    remoteRunId: run.remoteRunId || null,
    title: run.name || run.title || (mode === "zones" ? "Corrida por zonas" : "Corrida livre"),
    date: dateString(run.finishedAt || run.endedAt || run.date || run.createdAt),
    mode,
    distanceMeters,
    durationSeconds,
    paceSecondsPerKm: calculatePaceSecondsPerKm(durationSeconds, distanceMeters / 1000) || null,
    territoryAreaM2,
    syncStatus: syncStatus || (pendingSync ? "PENDING_SYNC" : failedSync ? "SYNC_FAILED" : "LOCAL_ONLY"),
    syncLabel: failedSync ? "Falha no sync" : pendingSync ? "Pendente de sync" : "Local/sincronizada",
    pendingSync,
    failedSync,
    raw: run,
  };
}

function getLatestTerritory(territories = [], userId = "offline") {
  const list = (Array.isArray(territories) ? territories : [])
    .filter((territory) => territory && recordBelongsToUser(territory, userId))
    .sort((a, b) => {
      const left = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const right = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
    });
  return list[0] || null;
}

function normalizeTerritorySummary(stats = {}, territories = [], userId = "offline") {
  const latest = getLatestTerritory(territories, userId);
  return {
    totalAreaM2: Math.max(0, toNumber(stats.totalTerritoryAreaM2 || stats.totalArea, 0)),
    territoryCount: Math.max(0, Math.round(toNumber(stats.totalZones, 0))),
    capturedCells: Math.max(0, Math.round(toNumber(stats.totalCapturedCells, 0))),
    latest: latest
      ? {
          id: latest.id || latest.localId || null,
          areaM2: Math.max(0, toNumber(latest.areaM2 ?? latest.area, 0)),
          cellCount: Array.isArray(latest.cellIds) ? latest.cellIds.length : 0,
          createdAt: dateString(latest.createdAt || latest.updatedAt),
          syncStatus: normalizeStatus(latest.syncStatus || latest.offlineStatus || ""),
        }
      : null,
  };
}

function normalizeRankingSummary(result = null, userId = "offline", request = DEFAULT_RANKING_REQUEST) {
  const source = result?.source || RANKING_SOURCE.EMPTY;
  const data = Array.isArray(result?.data)
    ? result.data.map((item, index) => ({ ...item, rank: item.rank || index + 1 }))
    : [];
  const myRow = data.find((item) => {
    const id = String(item.id || item.userId || item.uid || "");
    return id && id === String(userId);
  }) || null;

  return {
    source,
    sourceLabel:
      source === RANKING_SOURCE.REMOTE ? "remoto" :
        source === RANKING_SOURCE.CACHE ? "cache" :
          source === RANKING_SOURCE.LOCAL ? "local" :
            source === RANKING_SOURCE.DEMO ? "demo" : "vazio",
    mode: request.mode || request.criterion || "xp",
    period: request.period || "all",
    count: data.length,
    limited: result?.limited === true,
    updatedAt: result?.updatedAt || result?.cachedAt || null,
    myRank: myRow?.rank || (source === RANKING_SOURCE.LOCAL && data.length === 1 ? 1 : null),
    myValue: myRow?.totalXp ?? myRow?.xp ?? myRow?.distance ?? myRow?.area ?? myRow?.totalRuns ?? null,
    hasRealData: source !== RANKING_SOURCE.EMPTY && source !== RANKING_SOURCE.DEMO && data.length > 0,
    demo: source === RANKING_SOURCE.DEMO,
    items: data.slice(0, 3),
  };
}

function normalizeSyncSummary(stats = {}, queueResult = null) {
  const queue = Array.isArray(queueResult?.data) ? queueResult.data : [];
  const failedRuns = Math.max(0, Math.round(toNumber(stats.failedRunSyncCount, 0)));
  const pendingRuns = Math.max(0, Math.round(toNumber(stats.pendingRunSyncCount, 0)));
  const failedTerritories = Math.max(0, Math.round(toNumber(stats.failedTerritorySyncCount, 0)));
  const pendingTerritories = Math.max(0, Math.round(toNumber(stats.pendingTerritorySyncCount, 0)));
  const failedTotal = failedRuns + failedTerritories;
  const pendingTotal = pendingRuns + pendingTerritories;

  return {
    pendingRuns,
    failedRuns,
    pendingTerritories,
    failedTerritories,
    pendingTotal,
    failedTotal,
    queueCount: queue.length,
    hasIssues: pendingTotal > 0 || failedTotal > 0 || queue.length > 0,
    retryAvailable: pendingRuns > 0 || failedRuns > 0 || queue.length > 0,
  };
}

function errorsFromResults(results = {}) {
  return Object.fromEntries(
    Object.entries(results).map(([key, result]) => [
      key,
      result?.status === "rejected" ? result.reason : result?.value?.error || null,
    ])
  );
}

function valueOrFallback(result, fallback) {
  return result?.status === "fulfilled" ? result.value : fallback;
}

export async function loadHomeDashboard(options = {}) {
  const profileSettled = await Promise.allSettled([loadCurrentProfile()]);
  const profileResult = valueOrFallback(profileSettled[0], emptyResult({ profile: {}, userDoc: null }, HOME_DASHBOARD_SOURCE.LOCAL));
  const userId = resolveUserId(profileResult, options);
  const rankingRequest = {
    ...DEFAULT_RANKING_REQUEST,
    ...(options.rankingRequest || {}),
    allowDemo: false,
  };

  const [
    activeRunResult,
    runsResult,
    territoriesResult,
    progressResult,
    achievementsResult,
    rankingResult,
    queueResult,
  ] = await Promise.allSettled([
    activeRunTrackingService.getActiveRunSnapshot?.(),
    runRepository.list(),
    territoryRepository.list({ status: "active" }),
    getProgressSummary({ userId }),
    listAchievements({ userId }),
    listRanking(rankingRequest),
    runSyncQueueRepository.listPending(),
  ]);

  const activeRun = normalizeHomeActiveRun(valueOrFallback(activeRunResult, null));
  const runsResponse = valueOrFallback(runsResult, emptyResult([]));
  const territoriesResponse = valueOrFallback(territoriesResult, emptyResult([]));
  const progress = valueOrFallback(progressResult, {});
  const achievements = valueOrFallback(achievementsResult, []);
  const runs = Array.isArray(runsResponse?.data) ? runsResponse.data : [];
  const territories = Array.isArray(territoriesResponse?.data) ? territoriesResponse.data : [];
  const now = options.now instanceof Date ? options.now : new Date();

  const stats = buildLocalProfileStats({
    runs,
    territories,
    progress,
    achievements,
    userId,
    now,
  });
  const lastRun = normalizeHomeRun(getLatestFinishedRun(runs, {
    userId,
    activeRunId: activeRun.activeRunId,
  }));
  const ranking = normalizeRankingSummary(valueOrFallback(rankingResult, null), userId, rankingRequest);
  const sync = normalizeSyncSummary(stats, valueOrFallback(queueResult, null));
  const territory = normalizeTerritorySummary(stats, territories, userId);
  const recentAchievement = stats.recentAchievements?.[0] || progress.recentAchievements?.[0] || null;

  return {
    source: HOME_DASHBOARD_SOURCE.LOCAL,
    updatedAt: new Date().toISOString(),
    userId,
    profile: resolveDisplayProfile(profileResult),
    profileSource: profileResult?.source || HOME_DASHBOARD_SOURCE.LOCAL,
    activeRun,
    stats,
    progress,
    achievements,
    recentAchievement,
    lastRun,
    territory,
    ranking,
    sync,
    states: {
      isNewUser: !activeRun.hasActiveRun && !lastRun && !stats.hasLocalData,
      hasRuns: stats.totalRuns > 0,
      hasXp: toNumber(stats.totalXp, 0) > 0,
      hasTerritory: toNumber(territory.totalAreaM2, 0) > 0 || territory.territoryCount > 0,
      hasRanking: ranking.hasRealData,
      hasSyncIssues: sync.hasIssues,
    },
    errors: errorsFromResults({
      profile: profileSettled[0],
      activeRun: activeRunResult,
      runs: runsResult,
      territories: territoriesResult,
      progress: progressResult,
      achievements: achievementsResult,
      ranking: rankingResult,
      queue: queueResult,
    }),
  };
}

export async function retryHomeRunSync() {
  return runSyncQueueRepository.retry();
}

export default {
  HOME_DASHBOARD_SOURCE,
  loadHomeDashboard,
  retryHomeRunSync,
  normalizeHomeActiveRun,
  normalizeHomeRun,
  getLatestFinishedRun,
};
