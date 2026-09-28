import runRepository from "./runRepository.js";
import territoryRepository from "./territoryRepository.js";
import { listAchievements } from "./achievementRepository.js";
import { getUserProgress } from "./progressionRepository.js";
import { calculatePaceSecondsPerKm } from "../utils/pace.js";

export const PROFILE_STATS_SOURCE = {
  LOCAL: "local",
};

const ACTIVE_STATUSES = new Set([
  "ACTIVE",
  "RUNNING",
  "PAUSED",
  "RECOVERING",
  "FINISHING",
]);

const INVALID_STATUSES = new Set([
  "INVALID",
  "DISCARDED",
  "CANCELLED",
  "CANCELED",
  "DELETED",
  "REMOVED",
]);

const PENDING_SYNC_STATUSES = new Set([
  "PENDING",
  "PENDING_SYNC",
  "LOCAL_ONLY",
  "SYNCING",
]);

const FAILED_SYNC_STATUSES = new Set([
  "FAILED",
  "SYNC_FAILED",
]);

const nowIso = () => new Date().toISOString();

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function resolveUserId(options = {}) {
  return String(options.userId || options.uid || "offline");
}

function explicitOwnerId(record = {}) {
  return record.userId || record.ownerId || record.uid || record.actorId || null;
}

function belongsToUser(record = {}, userId = "offline") {
  const owner = explicitOwnerId(record);
  if (!owner) return true;
  return String(owner) === String(userId);
}

function runAliases(run = {}) {
  return [
    run.localRunId,
    run.remoteRunId,
    run.id,
    run.runId,
    run.legacyId,
  ]
    .map((value) => (value == null ? "" : String(value).trim()))
    .filter(Boolean);
}

function getDistanceMeters(run = {}) {
  return Math.max(0, toNumber(run.distanceMeters ?? run.distance, 0));
}

function getDurationSeconds(run = {}) {
  const seconds = toNumber(run.durationSeconds ?? run.duration, 0);
  if (seconds > 0) return Math.max(0, seconds);
  return Math.max(0, Math.round(toNumber(run.durationMs, 0) / 1000));
}

function getTimestamp(run = {}) {
  const raw = run.finishedAt || run.endedAt || run.endTime || run.date || run.createdAt || null;
  const ts = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(ts) ? ts : 0;
}

function getMode(run = {}) {
  const raw = String(run.mode || run.type || run.runMode || "free").toLowerCase();
  return raw === "zones" || raw === "zone" || raw === "territory" ? "zones" : "free";
}

function getTerritoryAreaFromRun(run = {}) {
  if (getMode(run) !== "zones") return 0;
  const summary = run.territorySummary || {};
  const capture = run.captureResult || {};
  return Math.max(0, toNumber(
    capture.capturedAreaM2 ??
    summary.totalAreaM2 ??
    summary.areaM2 ??
    run.areaM2 ??
    run.area,
    0
  ));
}

function isFinishedRunForStats(run = {}) {
  if (!run || typeof run !== "object") return false;
  if (run.deleted === true || run.removed === true || run.suspicious === true) return false;

  const status = normalizeStatus(run.status || run.runStatus || run.state);
  const offlineStatus = normalizeStatus(run.offlineStatus || run.localStatus);

  if (ACTIVE_STATUSES.has(status) || ACTIVE_STATUSES.has(offlineStatus)) return false;
  if (INVALID_STATUSES.has(status) || INVALID_STATUSES.has(offlineStatus)) return false;

  return true;
}

export {
  belongsToUser as recordBelongsToUser,
  getDistanceMeters as getRunDistanceMeters,
  getDurationSeconds as getRunDurationSeconds,
  getMode as getRunMode,
  getTerritoryAreaFromRun,
  getTimestamp as getRunTimestamp,
  isFailedSync as isFailedSyncRecord,
  isFinishedRunForStats,
  isPendingSync as isPendingSyncRecord,
};

function mergeRunForStats(previous = null, run = {}) {
  if (!previous) return { ...run };

  const previousDistance = getDistanceMeters(previous);
  const nextDistance = getDistanceMeters(run);
  const previousDuration = getDurationSeconds(previous);
  const nextDuration = getDurationSeconds(run);
  const previousArea = getTerritoryAreaFromRun(previous);
  const nextArea = getTerritoryAreaFromRun(run);
  const previousTs = getTimestamp(previous);
  const nextTs = getTimestamp(run);
  const preferred = nextTs >= previousTs ? run : previous;

  return {
    ...previous,
    ...preferred,
    distanceMeters: Math.max(previousDistance, nextDistance),
    distance: Math.max(previousDistance, nextDistance),
    durationSeconds: Math.max(previousDuration, nextDuration),
    duration: Math.max(previousDuration, nextDuration),
    areaM2: Math.max(previousArea, nextArea),
    area: Math.max(previousArea, nextArea),
    mode: getMode(previous) === "zones" || getMode(run) === "zones" ? "zones" : "free",
  };
}

function dedupeRuns(runs = [], userId = "offline") {
  const groups = new Map();
  const aliasToGroup = new Map();
  let anonymousIndex = 0;
  let scanned = 0;
  let accepted = 0;

  for (const run of Array.isArray(runs) ? runs : []) {
    scanned += 1;
    if (!isFinishedRunForStats(run) || !belongsToUser(run, userId)) continue;
    accepted += 1;

    const aliases = runAliases(run);
    const known = aliases.find((alias) => aliasToGroup.has(alias));
    const groupKey = known ? aliasToGroup.get(known) : aliases[0] || `anonymous:${anonymousIndex++}`;

    aliases.forEach((alias) => aliasToGroup.set(alias, groupKey));
    groups.set(groupKey, mergeRunForStats(groups.get(groupKey), run));
  }

  return {
    runs: Array.from(groups.values()),
    scanned,
    accepted,
    duplicateCount: Math.max(0, accepted - groups.size),
  };
}

function isPendingSync(record = {}) {
  const syncStatus = normalizeStatus(record.syncStatus);
  const offlineStatus = normalizeStatus(record.offlineStatus);
  return record.pendingSync === true ||
    PENDING_SYNC_STATUSES.has(syncStatus) ||
    PENDING_SYNC_STATUSES.has(offlineStatus);
}

function isFailedSync(record = {}) {
  const syncStatus = normalizeStatus(record.syncStatus);
  const offlineStatus = normalizeStatus(record.offlineStatus);
  return FAILED_SYNC_STATUSES.has(syncStatus) || FAILED_SYNC_STATUSES.has(offlineStatus);
}

function currentMonthStartTs(date = new Date()) {
  const start = new Date(date);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function areaFromTerritory(territory = {}) {
  return Math.max(0, toNumber(territory.areaM2 ?? territory.area, 0));
}

function getAchievementFacts(achievements = []) {
  const list = Array.isArray(achievements) ? achievements : [];
  const unlocked = list.filter((item) => item?.unlocked);
  const recentAchievements = unlocked
    .slice()
    .sort((a, b) => String(b.unlockedAt || "").localeCompare(String(a.unlockedAt || "")))
    .slice(0, 5);

  return {
    achievementsTotal: list.length,
    achievementsUnlocked: unlocked.length,
    unlockedAchievements: unlocked,
    recentAchievements,
  };
}

export function buildLocalProfileStats({
  runs = [],
  territories = [],
  progress = {},
  achievements = [],
  userId = "offline",
  now = new Date(),
} = {}) {
  const deduped = dedupeRuns(runs, userId);
  const cleanRuns = deduped.runs;
  const monthStart = currentMonthStartTs(now);
  const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  const runStats = cleanRuns.reduce((acc, run) => {
    const distance = getDistanceMeters(run);
    const duration = getDurationSeconds(run);
    const mode = getMode(run);
    const ts = getTimestamp(run);
    const pace = calculatePaceSecondsPerKm(duration, distance / 1000);
    const area = getTerritoryAreaFromRun(run);

    acc.totalDistanceMeters += distance;
    acc.totalDurationSeconds += duration;
    acc.longestRunMeters = Math.max(acc.longestRunMeters, distance);
    acc.bestPaceSecondsPerKm = pace && pace > 0
      ? Math.min(acc.bestPaceSecondsPerKm || pace, pace)
      : acc.bestPaceSecondsPerKm;
    acc.largestZoneAreaM2 = Math.max(acc.largestZoneAreaM2, area);
    acc.totalRunTerritoryAreaM2 += area;

    if (mode === "zones") acc.zoneRuns += 1;
    else acc.freeRuns += 1;

    if (ts >= weekStart) acc.weeklyDistanceMeters += distance;
    if (ts >= monthStart) {
      acc.monthlyDistanceMeters += distance;
      acc.monthlyAreaM2 += area;
    }

    if (isPendingSync(run)) acc.pendingRunSyncCount += 1;
    if (isFailedSync(run)) acc.failedRunSyncCount += 1;

    return acc;
  }, {
    totalDistanceMeters: 0,
    totalDurationSeconds: 0,
    freeRuns: 0,
    zoneRuns: 0,
    longestRunMeters: 0,
    largestZoneAreaM2: 0,
    totalRunTerritoryAreaM2: 0,
    bestPaceSecondsPerKm: null,
    weeklyDistanceMeters: 0,
    monthlyDistanceMeters: 0,
    monthlyAreaM2: 0,
    pendingRunSyncCount: 0,
    failedRunSyncCount: 0,
  });

  const cleanTerritories = (Array.isArray(territories) ? territories : [])
    .filter((territory) => territory && belongsToUser(territory, userId));
  const territoryAreaM2 = cleanTerritories.reduce((sum, territory) => sum + areaFromTerritory(territory), 0);
  const pendingTerritorySyncCount = cleanTerritories.filter(isPendingSync).length;
  const failedTerritorySyncCount = cleanTerritories.filter(isFailedSync).length;
  const territoryLargest = cleanTerritories.reduce(
    (max, territory) => Math.max(max, areaFromTerritory(territory)),
    0
  );
  const cellIds = new Set();
  cleanTerritories.forEach((territory) => {
    (Array.isArray(territory.cellIds) ? territory.cellIds : []).forEach((cellId) => {
      if (cellId != null) cellIds.add(String(cellId));
    });
  });

  const progressTotalArea = Math.max(0, toNumber(progress.totalTerritoryAreaM2 ?? progress.totalArea, 0));
  const totalTerritoryAreaM2 = Math.max(territoryAreaM2, progressTotalArea, runStats.totalRunTerritoryAreaM2);
  const totalZones = cleanTerritories.length || Math.max(0, Math.round(toNumber(progress.territoryCaptures, 0)));
  const achievementsFacts = getAchievementFacts(achievements);
  const totalXp = Math.max(0, Math.round(toNumber(progress.totalXp, 0)));
  const averagePaceSecondsPerKm = calculatePaceSecondsPerKm(
    runStats.totalDurationSeconds,
    runStats.totalDistanceMeters / 1000
  );
  const pendingSyncCount = runStats.pendingRunSyncCount + pendingTerritorySyncCount;
  const failedSyncCount = runStats.failedRunSyncCount + failedTerritorySyncCount;
  const hasLocalData = cleanRuns.length > 0 ||
    totalTerritoryAreaM2 > 0 ||
    totalXp > 0 ||
    achievementsFacts.achievementsUnlocked > 0;

  return {
    source: PROFILE_STATS_SOURCE.LOCAL,
    userId,
    updatedAt: nowIso(),
    hasLocalData,
    totalRuns: cleanRuns.length,
    freeRuns: runStats.freeRuns,
    zoneRuns: runStats.zoneRuns,
    totalDistanceMeters: runStats.totalDistanceMeters,
    totalDistance: runStats.totalDistanceMeters,
    totalDurationSeconds: runStats.totalDurationSeconds,
    totalTime: runStats.totalDurationSeconds,
    averagePaceSecondsPerKm,
    avgPace: averagePaceSecondsPerKm,
    bestPaceSecondsPerKm: runStats.bestPaceSecondsPerKm,
    bestPace: runStats.bestPaceSecondsPerKm,
    longestRunMeters: runStats.longestRunMeters,
    longestRun: runStats.longestRunMeters,
    totalTerritoryAreaM2,
    totalArea: totalTerritoryAreaM2,
    totalZones,
    largestZoneAreaM2: Math.max(runStats.largestZoneAreaM2, territoryLargest),
    largestZone: Math.max(runStats.largestZoneAreaM2, territoryLargest),
    totalCapturedCells: Math.max(cellIds.size, Math.round(toNumber(progress.totalCapturedCells, 0))),
    weeklyDistanceMeters: runStats.weeklyDistanceMeters,
    monthlyDistanceMeters: runStats.monthlyDistanceMeters,
    monthlyAreaM2: runStats.monthlyAreaM2,
    pendingRunSyncCount: runStats.pendingRunSyncCount,
    pendingTerritorySyncCount,
    pendingSyncCount,
    failedRunSyncCount: runStats.failedRunSyncCount,
    failedTerritorySyncCount,
    failedSyncCount,
    duplicateRunCount: deduped.duplicateCount,
    scannedRunCount: deduped.scanned,
    acceptedRunCount: deduped.accepted,
    totalXp,
    xp: Math.max(0, Math.round(toNumber(progress.xp, 0))),
    level: Math.max(1, Math.round(toNumber(progress.level, 1))),
    nextLevelXp: Math.max(1, Math.round(toNumber(progress.nextLevelXp, 100))),
    progressToNextLevel: Math.max(0, Math.min(1, toNumber(progress.progressToNextLevel, 0))),
    progressToNextLevelPct: Math.max(0, Math.min(100, Math.round(toNumber(progress.progressToNextLevelPct, 0)))),
    progress,
    ...achievementsFacts,
    syncStatus: failedSyncCount > 0 ? "SYNC_FAILED" : pendingSyncCount > 0 ? "PENDING_SYNC" : "LOCAL_ONLY",
    offlineStatus: failedSyncCount > 0 ? "SYNC_FAILED" : pendingSyncCount > 0 ? "PENDING_SYNC" : "LOCAL_ONLY",
  };
}

export async function getLocalProfileStats(options = {}) {
  const userId = resolveUserId(options);
  const [runsResult, territoriesResult, progressResult, achievementsResult] = await Promise.allSettled([
    runRepository.list(),
    territoryRepository.list({ status: "active" }),
    getUserProgress({ userId }),
    listAchievements({ userId }),
  ]);

  const runsValue = runsResult.status === "fulfilled" ? runsResult.value : null;
  const territoriesValue = territoriesResult.status === "fulfilled" ? territoriesResult.value : null;
  const progress = progressResult.status === "fulfilled" ? progressResult.value : {};
  const achievements = achievementsResult.status === "fulfilled" ? achievementsResult.value : [];

  const stats = buildLocalProfileStats({
    runs: Array.isArray(runsValue?.data) ? runsValue.data : [],
    territories: Array.isArray(territoriesValue?.data) ? territoriesValue.data : [],
    progress,
    achievements,
    userId,
    now: options.now instanceof Date ? options.now : new Date(),
  });

  return {
    ...stats,
    errors: {
      runs: runsResult.status === "rejected" ? runsResult.reason : runsValue?.error || null,
      territories: territoriesResult.status === "rejected" ? territoriesResult.reason : territoriesValue?.error || null,
      progress: progressResult.status === "rejected" ? progressResult.reason : null,
      achievements: achievementsResult.status === "rejected" ? achievementsResult.reason : null,
    },
  };
}

export default {
  PROFILE_STATS_SOURCE,
  buildLocalProfileStats,
  getLocalProfileStats,
};
