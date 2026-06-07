import AsyncStorage from "@react-native-async-storage/async-storage";
import runRepository from "./runRepository.js";
import {
  evaluateAchievementsFromProgress,
  getAchievementProgressSummary,
} from "./achievementRepository.js";

export const USER_PROGRESS_STORAGE_KEY = "wayper_user_progress_v1";
export const XP_EVENTS_STORAGE_KEY = "wayper_xp_events_v1";
export const PROGRESSION_SCHEMA_VERSION = 1;

export const PROGRESS_SYNC_STATUS = {
  PENDING: "PENDING",
  SYNCED: "SYNCED",
  FAILED: "FAILED",
};

export const PROGRESS_OFFLINE_STATUS = {
  LOCAL_ONLY: "LOCAL_ONLY",
  PENDING_SYNC: "PENDING_SYNC",
  SYNCED: "SYNCED",
  SYNC_FAILED: "SYNC_FAILED",
};

export const XP_EVENT_TYPE = {
  RUN_COMPLETED: "RUN_COMPLETED",
  DISTANCE_RUN: "DISTANCE_RUN",
  DURATION_RUN: "DURATION_RUN",
  FIRST_RUN: "FIRST_RUN",
  ZONE_RUN_COMPLETED: "ZONE_RUN_COMPLETED",
  TERRITORY_CAPTURED: "TERRITORY_CAPTURED",
};

export const XP_RULES = {
  minDistanceMeters: 100,
  minDurationSeconds: 60,
  runCompletedXp: 5,
  xpPerDistanceMeter: 1 / 100,
  xpPerDurationSecond: 1 / 600,
  firstRunBonusXp: 10,
  zoneRunBonusXp: 5,
  xpPerTerritoryAreaM2: 1 / 100,
  xpPerCapturedCell: 2,
  maxTerritoryXpPerRun: 500,
};

export const LEVEL_THRESHOLDS = [0, 100, 250, 500, 900];
export const LEVEL_GROWTH_FACTOR = 1.55;

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
]);

const nowIso = () => new Date().toISOString();

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = Number.POSITIVE_INFINITY) {
  return Math.max(min, Math.min(max, value));
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function resolveUserId(input = {}, options = {}) {
  return String(options.userId || input.userId || input.ownerId || input.uid || "offline");
}

function safeIdPart(value) {
  return String(value || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function getRunIdentity(run = {}) {
  return String(
    run.localRunId ||
    run.id ||
    run.runId ||
    run.remoteRunId ||
    run.legacyId ||
    ""
  );
}

function normalizeRunMode(run = {}) {
  const raw = String(run.mode || run.type || run.runMode || "free").toLowerCase();
  return raw === "zones" || raw === "zone" || raw === "territory" ? "zones" : "free";
}

function getDistanceMeters(run = {}) {
  return Math.max(0, toNumber(run.distanceMeters ?? run.distance, 0));
}

function getDurationSeconds(run = {}) {
  const seconds = toNumber(run.durationSeconds ?? run.duration, 0);
  if (seconds > 0) return Math.max(0, seconds);
  return Math.max(0, Math.round(toNumber(run.durationMs, 0) / 1000));
}

function getTerritoryAreaM2(run = {}) {
  if (normalizeRunMode(run) !== "zones") return 0;
  const capture = run.captureResult || {};
  const captureOk = capture.ok === true || run.territoryCaptureFailedReason == null;
  if (!captureOk && !run.territoryId && !run.zoneId) return 0;
  return Math.max(0, toNumber(
    capture.capturedAreaM2 ??
    run.areaM2 ??
    run.area,
    0
  ));
}

function getCapturedCells(run = {}) {
  if (normalizeRunMode(run) !== "zones") return [];
  const capture = run.captureResult || {};
  const cells = Array.isArray(run.capturedCells)
    ? run.capturedCells
    : Array.isArray(capture.cellIds)
      ? capture.cellIds
      : [];
  return Array.from(new Set(cells.map((cell) => String(cell)).filter(Boolean)));
}

function isFinishedRunEligible(run = {}) {
  const status = normalizeStatus(run.status || run.runStatus || run.state);
  const offlineStatus = normalizeStatus(run.offlineStatus || run.localStatus);

  if (ACTIVE_STATUSES.has(status) || ACTIVE_STATUSES.has(offlineStatus)) {
    return { ok: false, reason: "active_or_finishing_run" };
  }
  if (INVALID_STATUSES.has(status) || INVALID_STATUSES.has(offlineStatus) || run.suspicious === true) {
    return { ok: false, reason: "invalid_run" };
  }

  const runId = getRunIdentity(run);
  if (!runId) return { ok: false, reason: "missing_run_id" };

  const distanceMeters = getDistanceMeters(run);
  const durationSeconds = getDurationSeconds(run);
  if (distanceMeters < XP_RULES.minDistanceMeters) return { ok: false, reason: "distance_too_short" };
  if (durationSeconds < XP_RULES.minDurationSeconds) return { ok: false, reason: "duration_too_short" };

  return { ok: true, runId, distanceMeters, durationSeconds };
}

function thresholdForLevel(level) {
  const safeLevel = Math.max(1, Math.round(toNumber(level, 1)));
  if (safeLevel <= LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[safeLevel - 1];

  let previous = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  let delta = previous - LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 2];
  for (let currentLevel = LEVEL_THRESHOLDS.length + 1; currentLevel <= safeLevel; currentLevel += 1) {
    delta = Math.round(delta * LEVEL_GROWTH_FACTOR);
    previous += delta;
  }
  return previous;
}

export function getLevelInfo(input = 0) {
  const totalXp = Math.max(0, Math.round(toNumber(typeof input === "object" ? input.totalXp : input, 0)));
  let level = 1;
  while (totalXp >= thresholdForLevel(level + 1)) {
    level += 1;
  }

  const currentLevelTotalXp = thresholdForLevel(level);
  const nextLevelTotalXp = thresholdForLevel(level + 1);
  const nextLevelXp = Math.max(1, nextLevelTotalXp - currentLevelTotalXp);
  const xp = Math.max(0, totalXp - currentLevelTotalXp);
  const progressToNextLevel = clamp(xp / nextLevelXp, 0, 1);

  return {
    totalXp,
    level,
    xp,
    currentLevelXp: currentLevelTotalXp,
    nextLevelXp,
    nextLevelTotalXp,
    progressToNextLevel,
    progressToNextLevelPct: Math.round(progressToNextLevel * 100),
  };
}

function defaultProgress(userId = "offline") {
  const now = nowIso();
  const levelInfo = getLevelInfo(0);
  return {
    localId: `progress:${userId}`,
    remoteId: null,
    userId,
    source: "local",
    totalXp: 0,
    xp: levelInfo.xp,
    level: levelInfo.level,
    nextLevelXp: levelInfo.nextLevelXp,
    nextLevelTotalXp: levelInfo.nextLevelTotalXp,
    progressToNextLevel: levelInfo.progressToNextLevel,
    progressToNextLevelPct: levelInfo.progressToNextLevelPct,
    totalRuns: 0,
    totalDistanceMeters: 0,
    totalDurationSeconds: 0,
    freeRuns: 0,
    zoneRuns: 0,
    territoryCaptures: 0,
    totalTerritoryAreaM2: 0,
    totalCapturedCells: 0,
    firstRunAt: null,
    lastRunAt: null,
    processedRunIds: [],
    processedRunEventTypes: {},
    syncStatus: PROGRESS_SYNC_STATUS.PENDING,
    offlineStatus: PROGRESS_OFFLINE_STATUS.LOCAL_ONLY,
    schemaVersion: PROGRESSION_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    lastSyncAttemptAt: null,
    lastSyncedAt: null,
    syncError: null,
  };
}

function normalizeProgress(progress = {}, options = {}) {
  const userId = resolveUserId(progress, options);
  const base = defaultProgress(userId);
  const totalXp = Math.max(0, Math.round(toNumber(progress.totalXp ?? progress.globalXp ?? progress.xpTotal, base.totalXp)));
  const levelInfo = getLevelInfo(totalXp);
  const processedRunEventTypes =
    progress.processedRunEventTypes && typeof progress.processedRunEventTypes === "object" && !Array.isArray(progress.processedRunEventTypes)
      ? progress.processedRunEventTypes
      : {};

  return {
    ...base,
    ...progress,
    userId,
    localId: progress.localId || base.localId,
    totalXp,
    xp: levelInfo.xp,
    level: levelInfo.level,
    nextLevelXp: levelInfo.nextLevelXp,
    nextLevelTotalXp: levelInfo.nextLevelTotalXp,
    progressToNextLevel: levelInfo.progressToNextLevel,
    progressToNextLevelPct: levelInfo.progressToNextLevelPct,
    totalRuns: Math.max(0, Math.round(toNumber(progress.totalRuns, 0))),
    totalDistanceMeters: Math.max(0, toNumber(progress.totalDistanceMeters ?? progress.totalDistance, 0)),
    totalDurationSeconds: Math.max(0, toNumber(progress.totalDurationSeconds ?? progress.totalTime, 0)),
    freeRuns: Math.max(0, Math.round(toNumber(progress.freeRuns, 0))),
    zoneRuns: Math.max(0, Math.round(toNumber(progress.zoneRuns, 0))),
    territoryCaptures: Math.max(0, Math.round(toNumber(progress.territoryCaptures, 0))),
    totalTerritoryAreaM2: Math.max(0, toNumber(progress.totalTerritoryAreaM2 ?? progress.totalArea, 0)),
    totalCapturedCells: Math.max(0, Math.round(toNumber(progress.totalCapturedCells, 0))),
    processedRunIds: Array.from(new Set(Array.isArray(progress.processedRunIds) ? progress.processedRunIds.map(String) : [])),
    processedRunEventTypes: Object.fromEntries(
      Object.entries(processedRunEventTypes).map(([runId, types]) => [
        String(runId),
        Array.from(new Set(Array.isArray(types) ? types.map(String) : [])),
      ])
    ),
    syncStatus: progress.syncStatus || PROGRESS_SYNC_STATUS.PENDING,
    offlineStatus:
      progress.offlineStatus ||
      (progress.syncStatus === PROGRESS_SYNC_STATUS.SYNCED ? PROGRESS_OFFLINE_STATUS.SYNCED : PROGRESS_OFFLINE_STATUS.PENDING_SYNC),
    schemaVersion: Number(progress.schemaVersion || PROGRESSION_SCHEMA_VERSION),
    createdAt: progress.createdAt || base.createdAt,
    updatedAt: progress.updatedAt || base.updatedAt,
  };
}

async function loadProgressMap() {
  const raw = await AsyncStorage.getItem(USER_PROGRESS_STORAGE_KEY);
  const parsed = safeParse(raw, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

async function saveProgressMap(map = {}) {
  await AsyncStorage.setItem(USER_PROGRESS_STORAGE_KEY, JSON.stringify(map || {}));
}

async function loadEventsRaw() {
  const raw = await AsyncStorage.getItem(XP_EVENTS_STORAGE_KEY);
  const parsed = safeParse(raw, []);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return Object.values(parsed);
  return [];
}

async function saveEventsRaw(events = []) {
  await AsyncStorage.setItem(XP_EVENTS_STORAGE_KEY, JSON.stringify(Array.isArray(events) ? events : []));
}

export async function listXpEvents(options = {}) {
  const userId = options.userId ? String(options.userId) : null;
  const sourceRunId = options.sourceRunId ? String(options.sourceRunId) : null;
  const events = (await loadEventsRaw()).map(normalizeXpEvent).filter(Boolean);
  return events.filter((event) => {
    if (userId && String(event.userId) !== userId) return false;
    if (sourceRunId && String(event.sourceRunId) !== sourceRunId) return false;
    return true;
  });
}

function normalizeXpEvent(event = {}) {
  const type = event.type ? String(event.type) : null;
  const sourceRunId = event.sourceRunId || event.localRunId || event.runId || null;
  if (!type || !sourceRunId) return null;
  const userId = String(event.userId || "offline");
  const localId = event.localId || `xp:${safeIdPart(userId)}:${safeIdPart(sourceRunId)}:${safeIdPart(type)}`;
  return {
    ...event,
    id: event.id || localId,
    localId,
    remoteId: event.remoteId || null,
    userId,
    type,
    source: event.source || "run",
    sourceRunId: String(sourceRunId),
    localRunId: event.localRunId || String(sourceRunId),
    xpAmount: Math.max(0, Math.round(toNumber(event.xpAmount, 0))),
    createdAt: event.createdAt || nowIso(),
    updatedAt: event.updatedAt || event.createdAt || nowIso(),
    syncStatus: event.syncStatus || PROGRESS_SYNC_STATUS.PENDING,
    offlineStatus: event.offlineStatus || PROGRESS_OFFLINE_STATUS.PENDING_SYNC,
    schemaVersion: Number(event.schemaVersion || PROGRESSION_SCHEMA_VERSION),
    lastSyncAttemptAt: event.lastSyncAttemptAt || null,
    syncError: event.syncError || null,
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {},
  };
}

function makeXpEvent({ userId, runId, type, xpAmount, createdAt, metadata = {} }) {
  return normalizeXpEvent({
    localId: `xp:${safeIdPart(userId)}:${safeIdPart(runId)}:${safeIdPart(type)}`,
    userId,
    type,
    source: "run",
    sourceRunId: runId,
    localRunId: runId,
    xpAmount,
    createdAt,
    updatedAt: createdAt,
    metadata,
  });
}

function getProcessedTypes(progress = {}, events = [], runId) {
  const fromProgress = Array.isArray(progress.processedRunEventTypes?.[runId])
    ? progress.processedRunEventTypes[runId]
    : [];
  const fromEvents = events
    .filter((event) => String(event.sourceRunId) === String(runId))
    .map((event) => event.type);
  return new Set([...fromProgress, ...fromEvents].map(String));
}

function buildXpEventsForRun(run = {}, progress = {}, events = [], options = {}) {
  const eligibility = isFinishedRunEligible(run);
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason, events: [] };

  const userId = resolveUserId(run, options);
  const runId = eligibility.runId;
  const mode = normalizeRunMode(run);
  const distanceMeters = eligibility.distanceMeters;
  const durationSeconds = eligibility.durationSeconds;
  const territoryAreaM2 = getTerritoryAreaM2(run);
  const capturedCells = getCapturedCells(run);
  const createdAt = run.finishedAt || run.endedAt || run.date || nowIso();
  const eventTypes = getProcessedTypes(progress, events, runId);
  const candidates = [];

  candidates.push(makeXpEvent({
    userId,
    runId,
    type: XP_EVENT_TYPE.RUN_COMPLETED,
    xpAmount: XP_RULES.runCompletedXp,
    createdAt,
    metadata: { mode, distanceMeters, durationSeconds },
  }));

  const distanceXp = Math.floor(distanceMeters * XP_RULES.xpPerDistanceMeter);
  if (distanceXp > 0) {
    candidates.push(makeXpEvent({
      userId,
      runId,
      type: XP_EVENT_TYPE.DISTANCE_RUN,
      xpAmount: distanceXp,
      createdAt,
      metadata: { distanceMeters },
    }));
  }

  const durationXp = Math.floor(durationSeconds * XP_RULES.xpPerDurationSecond);
  if (durationXp > 0) {
    candidates.push(makeXpEvent({
      userId,
      runId,
      type: XP_EVENT_TYPE.DURATION_RUN,
      xpAmount: durationXp,
      createdAt,
      metadata: { durationSeconds },
    }));
  }

  const hasFirstRun = progress.totalRuns > 0 || events.some((event) => event.userId === userId && event.type === XP_EVENT_TYPE.FIRST_RUN);
  if (!hasFirstRun) {
    candidates.push(makeXpEvent({
      userId,
      runId,
      type: XP_EVENT_TYPE.FIRST_RUN,
      xpAmount: XP_RULES.firstRunBonusXp,
      createdAt,
      metadata: { firstRun: true },
    }));
  }

  if (mode === "zones") {
    candidates.push(makeXpEvent({
      userId,
      runId,
      type: XP_EVENT_TYPE.ZONE_RUN_COMPLETED,
      xpAmount: XP_RULES.zoneRunBonusXp,
      createdAt,
      metadata: { mode },
    }));

    if (territoryAreaM2 > 0) {
      const areaXp = Math.floor(territoryAreaM2 * XP_RULES.xpPerTerritoryAreaM2);
      const cellXp = capturedCells.length * XP_RULES.xpPerCapturedCell;
      const territoryXp = clamp(areaXp + cellXp, 1, XP_RULES.maxTerritoryXpPerRun);
      candidates.push(makeXpEvent({
        userId,
        runId,
        type: XP_EVENT_TYPE.TERRITORY_CAPTURED,
        xpAmount: territoryXp,
        createdAt,
        metadata: {
          territoryAreaM2,
          capturedCells,
          territoryId: run.territoryId || run.zoneId || null,
        },
      }));
    }
  }

  return {
    ok: true,
    runId,
    userId,
    mode,
    distanceMeters,
    durationSeconds,
    territoryAreaM2,
    capturedCells,
    events: candidates.filter((event) => !eventTypes.has(event.type)),
    skippedTypes: Array.from(eventTypes),
  };
}

function applyEventsToProgress(progress = {}, run = {}, eventBundle = {}) {
  const next = normalizeProgress(progress, { userId: eventBundle.userId });
  const runId = String(eventBundle.runId);
  const eventTypes = new Set(next.processedRunEventTypes[runId] || []);
  let totalXpDelta = 0;

  for (const event of eventBundle.events || []) {
    totalXpDelta += Math.max(0, Math.round(toNumber(event.xpAmount, 0)));
    eventTypes.add(event.type);

    if (event.type === XP_EVENT_TYPE.RUN_COMPLETED) {
      next.totalRuns += 1;
      next.totalDistanceMeters += eventBundle.distanceMeters;
      next.totalDurationSeconds += eventBundle.durationSeconds;
      if (eventBundle.mode === "zones") next.zoneRuns += 1;
      else next.freeRuns += 1;
      next.firstRunAt = next.firstRunAt || event.createdAt;
      next.lastRunAt = event.createdAt;
      next.processedRunIds = Array.from(new Set([...(next.processedRunIds || []), runId]));
    }

    if (event.type === XP_EVENT_TYPE.TERRITORY_CAPTURED) {
      next.territoryCaptures += 1;
      next.totalTerritoryAreaM2 += eventBundle.territoryAreaM2;
      next.totalCapturedCells += eventBundle.capturedCells.length;
    }
  }

  next.totalXp += totalXpDelta;
  next.processedRunEventTypes = {
    ...(next.processedRunEventTypes || {}),
    [runId]: Array.from(eventTypes),
  };
  next.syncStatus = PROGRESS_SYNC_STATUS.PENDING;
  next.offlineStatus = PROGRESS_OFFLINE_STATUS.PENDING_SYNC;
  next.updatedAt = nowIso();
  return normalizeProgress(next, { userId: eventBundle.userId });
}

export async function getUserProgress(options = {}) {
  const userId = resolveUserId({}, options);
  const map = await loadProgressMap();
  return normalizeProgress(map[userId] || {}, { userId });
}

export async function saveUserProgress(progress = {}, options = {}) {
  const userId = resolveUserId(progress, options);
  const map = await loadProgressMap();
  const previous = normalizeProgress(map[userId] || {}, { userId });
  const normalized = normalizeProgress({
    ...previous,
    ...progress,
    userId,
    updatedAt: progress.updatedAt || nowIso(),
    createdAt: previous.createdAt || progress.createdAt || nowIso(),
    schemaVersion: PROGRESSION_SCHEMA_VERSION,
  }, { userId });
  map[userId] = normalized;
  await saveProgressMap(map);
  return normalized;
}

export async function addXpFromRun(run = {}, options = {}) {
  const userId = resolveUserId(run, options);
  const progress = await getUserProgress({ userId });
  const allExistingEvents = (await loadEventsRaw()).map(normalizeXpEvent).filter(Boolean);
  const userEvents = allExistingEvents.filter((event) => String(event.userId) === userId);
  const bundle = buildXpEventsForRun(run, progress, userEvents, { userId });

  if (!bundle.ok) {
    return {
      applied: false,
      reason: bundle.reason,
      progress,
      events: [],
      unlockedAchievements: [],
    };
  }

  if (bundle.events.length === 0) {
    return {
      applied: false,
      reason: "already_processed",
      progress,
      events: [],
      unlockedAchievements: [],
    };
  }

  const eventIds = new Set(userEvents.map((event) => event.localId));
  const newEvents = bundle.events.filter((event) => !eventIds.has(event.localId));
  const nextProgress = applyEventsToProgress(progress, run, { ...bundle, events: newEvents });
  const savedProgress = await saveUserProgress(nextProgress, { userId });
  const newEventIds = new Set(newEvents.map((event) => event.localId));
  const mergedEvents = [
    ...allExistingEvents.filter((event) => !newEventIds.has(event.localId)),
    ...newEvents,
  ]
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  await saveEventsRaw(mergedEvents);

  let achievements = { newlyUnlocked: [] };
  try {
    achievements = await evaluateAchievementsFromProgress(savedProgress, { userId });
  } catch {
    achievements = { newlyUnlocked: [] };
  }

  return {
    applied: true,
    reason: null,
    progress: savedProgress,
    events: newEvents,
    xpAwarded: newEvents.reduce((sum, event) => sum + toNumber(event.xpAmount, 0), 0),
    unlockedAchievements: achievements.newlyUnlocked || [],
  };
}

export async function recalculateProgressFromLocalRuns(options = {}) {
  const userId = resolveUserId({}, options);
  const result = await runRepository.list();
  const runs = Array.isArray(result.data) ? result.data : [];
  const sorted = runs
    .slice()
    .sort((a, b) => String(a.finishedAt || a.endedAt || a.date || "").localeCompare(String(b.finishedAt || b.endedAt || b.date || "")));

  const applied = [];
  const skipped = [];
  for (const run of sorted) {
    const item = await addXpFromRun(run, { userId });
    if (item.applied) applied.push({ runId: getRunIdentity(run), xpAwarded: item.xpAwarded });
    else skipped.push({ runId: getRunIdentity(run), reason: item.reason });
  }

  return {
    applied,
    skipped,
    progress: await getUserProgress({ userId }),
  };
}

async function patchProgressSync(patch = {}, options = {}) {
  const userId = resolveUserId({}, options);
  const progress = await getUserProgress({ userId });
  return saveUserProgress({
    ...progress,
    ...patch,
    updatedAt: nowIso(),
  }, { userId });
}

export function markProgressPendingSync(options = {}) {
  return patchProgressSync({
    syncStatus: PROGRESS_SYNC_STATUS.PENDING,
    offlineStatus: PROGRESS_OFFLINE_STATUS.PENDING_SYNC,
    syncError: null,
  }, options);
}

export function markProgressSynced(options = {}) {
  const syncedAt = options.syncedAt || nowIso();
  return patchProgressSync({
    remoteId: options.remoteId || null,
    syncStatus: PROGRESS_SYNC_STATUS.SYNCED,
    offlineStatus: PROGRESS_OFFLINE_STATUS.SYNCED,
    syncError: null,
    lastSyncedAt: syncedAt,
  }, options);
}

export function markProgressSyncFailed(error, options = {}) {
  const message = typeof error === "string" ? error : String(error?.message || error || "sync_error");
  return patchProgressSync({
    syncStatus: PROGRESS_SYNC_STATUS.FAILED,
    offlineStatus: PROGRESS_OFFLINE_STATUS.SYNC_FAILED,
    syncError: message,
    lastSyncAttemptAt: options.lastSyncAttemptAt || nowIso(),
  }, options);
}

export async function getProgressSummary(options = {}) {
  const userId = resolveUserId({}, options);
  const [progress, achievements] = await Promise.all([
    getUserProgress({ userId }),
    getAchievementProgressSummary({ userId }),
  ]);

  return {
    ...progress,
    achievementsUnlocked: achievements.unlockedCount,
    achievementsTotal: achievements.total,
    recentAchievements: achievements.recentAchievements,
  };
}

export function normalizeProgressRecord(progress = {}, options = {}) {
  return normalizeProgress(progress, options);
}

export function __buildXpEventsForRunForTests(run = {}, progress = {}, events = [], options = {}) {
  return buildXpEventsForRun(run, progress, events, options);
}

export default {
  USER_PROGRESS_STORAGE_KEY,
  XP_EVENTS_STORAGE_KEY,
  PROGRESS_SYNC_STATUS,
  PROGRESS_OFFLINE_STATUS,
  XP_EVENT_TYPE,
  XP_RULES,
  LEVEL_THRESHOLDS,
  getUserProgress,
  saveUserProgress,
  addXpFromRun,
  recalculateProgressFromLocalRuns,
  getLevelInfo,
  markProgressPendingSync,
  markProgressSynced,
  markProgressSyncFailed,
  getProgressSummary,
  listXpEvents,
  normalizeProgress: normalizeProgressRecord,
};
