import AsyncStorage from "@react-native-async-storage/async-storage";

export const ACTIVE_RUN_STORAGE_KEY = "wayper_active_offline_run_v1";
export const ACTIVE_RUN_SCHEMA_VERSION = 1;
export const ACTIVE_RUN_MAX_POINTS = 8000;

export const ACTIVE_RUN_STATUS = {
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  FINISHED: "FINISHED",
  PENDING_SYNC: "PENDING_SYNC",
  SYNCING: "SYNCING",
  SYNCED: "SYNCED",
  SYNC_FAILED: "SYNC_FAILED",
};

export const ACTIVE_RUN_SYNC_STATUS = {
  LOCAL_ONLY: "LOCAL_ONLY",
  PENDING: "PENDING",
  SYNCING: "SYNCING",
  SYNCED: "SYNCED",
  FAILED: "FAILED",
};

const LOG_PREFIX = "[Wayper RunOfflineStorage]";

let writeQueue = Promise.resolve();

function enqueueWrite(task) {
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

function log(event, payload = {}) {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  try {
    console.log(`${LOG_PREFIX} ${event}`, payload);
  } catch {}
}

function nowIso() {
  return new Date().toISOString();
}

function toFiniteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toTimestampMs(value, fallback = Date.now()) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toIso(value, fallback = nowIso()) {
  const timestamp = toTimestampMs(value, null);
  if (timestamp == null) return fallback;
  return new Date(timestamp).toISOString();
}

function getCheckpointTimestampMs(run = {}, fallback = null) {
  return toTimestampMs(
    run.checkpointAtMs ??
      run.checkpointAt ??
      run.lastUpdatedAtMs ??
      run.lastUpdatedAt ??
      run.updatedAtMs ??
      run.updatedAt ??
      run.endedAt ??
      run.finishedAt,
    fallback
  );
}

function isLiveStatus(status) {
  return status === ACTIVE_RUN_STATUS.RUNNING || status === ACTIVE_RUN_STATUS.PAUSED;
}

function hasCheckpointPayload(run = {}) {
  return (
    sanitizePoints(run.points).length > 0 ||
    toFiniteNumber(run.distanceMeters, 0) > 0 ||
    toFiniteNumber(run.durationMs, 0) > 0 ||
    sanitizeSegments(run.segments, sanitizePoints(run.points)).length > 1
  );
}

function normalizeCheckpointFields(run = {}, fallbackMs = Date.now()) {
  const checkpointAtMs = getCheckpointTimestampMs(run, fallbackMs) || fallbackMs;
  return {
    checkpointAtMs,
    checkpointAt: toIso(checkpointAtMs),
  };
}

export function normalizeOfflineMode(mode = "free") {
  if (mode === "territory" || mode === "zones") return "territory";
  return "free";
}

export function toAppRunMode(mode = "free") {
  return mode === "territory" ? "zones" : "free";
}

function sanitizePoint(point = {}, fallbackSegmentIndex = 0) {
  const latitude = toFiniteNumber(point.latitude ?? point.lat, null);
  const longitude = toFiniteNumber(point.longitude ?? point.lng ?? point.lon, null);
  if (latitude == null || longitude == null) return null;

  const segmentIndex = toFiniteNumber(point.segmentIndex ?? point.segmentId, fallbackSegmentIndex) ?? 0;
  const output = {
    latitude,
    longitude,
    timestamp: toIso(point.timestamp ?? point.time ?? point.t),
    segmentIndex,
  };

  ["accuracy", "altitude", "altitudeAccuracy", "speed", "heading"].forEach((key) => {
    const number = toFiniteNumber(point[key], null);
    if (number != null) output[key] = number;
  });

  return output;
}

function sanitizePoints(points = []) {
  return (Array.isArray(points) ? points : [])
    .map((point, index) => sanitizePoint(point, toFiniteNumber(point?.segmentIndex ?? point?.segmentId, index) ?? 0))
    .filter(Boolean)
    .slice(-ACTIVE_RUN_MAX_POINTS);
}

function sanitizeSegment(segment = {}, fallbackIndex = 0) {
  const index = toFiniteNumber(segment.index ?? segment.segmentIndex ?? segment.segmentId, fallbackIndex) ?? fallbackIndex;
  const reason = segment.reason === "START" || segment.reason === "PAUSE_RESUME"
    ? segment.reason
    : index === 0
      ? "START"
      : "PAUSE_RESUME";

  return {
    index,
    startedAt: toIso(segment.startedAt ?? segment.startTimestamp ?? segment.startTime),
    endedAt: segment.endedAt || segment.endTimestamp
      ? toIso(segment.endedAt ?? segment.endTimestamp)
      : undefined,
    reason,
  };
}

function sanitizeSegments(segments = [], points = []) {
  const fromSegments = (Array.isArray(segments) ? segments : [])
    .map((segment, index) => sanitizeSegment(segment, index))
    .filter((segment) => segment.startedAt);

  if (fromSegments.length > 0) return fromSegments;

  const bySegment = new Map();
  for (const point of points) {
    const index = toFiniteNumber(point.segmentIndex, 0) ?? 0;
    const existing = bySegment.get(index);
    if (!existing) {
      bySegment.set(index, {
        index,
        startedAt: point.timestamp,
        reason: index === 0 ? "START" : "PAUSE_RESUME",
      });
    }
  }

  return Array.from(bySegment.values()).sort((a, b) => a.index - b.index);
}

function buildTerritoryData(run = {}) {
  const area = toFiniteNumber(run.area ?? run.capturedArea ?? run.capturedAreaM2, 0) ?? 0;
  const cells = Array.isArray(run.captureResult?.cellIds)
    ? run.captureResult.cellIds
    : Array.isArray(run.cellIds)
      ? run.cellIds
      : [];

  if (run.mode !== "zones" && area <= 0 && cells.length === 0 && !run.territoryCaptureFailedReason) {
    return undefined;
  }

  return {
    pendingCalculation: Boolean(run.territoryData?.pendingCalculation ?? run.territoryCaptureFailedReason),
    capturedArea: area,
    cells,
  };
}

function buildBaseRun({
  localRunId,
  userId,
  mode = "free",
  status = ACTIVE_RUN_STATUS.RUNNING,
  syncStatus = ACTIVE_RUN_SYNC_STATUS.LOCAL_ONLY,
  startedAt = nowIso(),
} = {}) {
  const createdAt = nowIso();
  const checkpoint = normalizeCheckpointFields({ startedAt }, toTimestampMs(startedAt, Date.now()));
  return {
    localRunId: String(localRunId || `local_${Date.now()}`),
    remoteRunId: undefined,
    userId: userId || "offline",
    mode: normalizeOfflineMode(mode),
    status,
    syncStatus,
    startedAt: toIso(startedAt, createdAt),
    endedAt: undefined,
    durationMs: 0,
    movingDurationMs: 0,
    distanceMeters: 0,
    pace: undefined,
    averageSpeed: undefined,
    maxSpeed: undefined,
    points: [],
    segments: [{
      index: 0,
      startedAt: toIso(startedAt, createdAt),
      reason: "START",
    }],
    territoryData: normalizeOfflineMode(mode) === "territory" ? { pendingCalculation: true } : undefined,
    finalRunData: undefined,
    createdAt,
    updatedAt: createdAt,
    checkpointAt: checkpoint.checkpointAt,
    checkpointAtMs: checkpoint.checkpointAtMs,
    syncAttempts: 0,
    lastSyncError: undefined,
    schemaVersion: ACTIVE_RUN_SCHEMA_VERSION,
  };
}

export async function loadActiveRun() {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_RUN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveActiveRun(run = {}) {
  return enqueueWrite(async () => {
    const checkpoint = normalizeCheckpointFields(run);
    const normalized = {
      ...buildBaseRun(run),
      ...run,
      mode: normalizeOfflineMode(run.mode),
      points: sanitizePoints(run.points),
      segments: sanitizeSegments(run.segments, sanitizePoints(run.points)),
      updatedAt: nowIso(),
      checkpointAt: checkpoint.checkpointAt,
      checkpointAtMs: checkpoint.checkpointAtMs,
      schemaVersion: ACTIVE_RUN_SCHEMA_VERSION,
    };

    await AsyncStorage.setItem(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  });
}

export async function createActiveRun(options = {}) {
  return saveActiveRun(buildBaseRun(options));
}

export async function updateActiveRun(patch = {}) {
  return enqueueWrite(async () => {
    const existing = await loadActiveRun();
    const base = existing || buildBaseRun({
      localRunId: patch.localRunId || patch.activeRunId || patch.id,
      userId: patch.userId,
      mode: patch.mode,
      status: patch.status || ACTIVE_RUN_STATUS.RUNNING,
      syncStatus: patch.syncStatus || ACTIVE_RUN_SYNC_STATUS.LOCAL_ONLY,
      startedAt: patch.startedAt || patch.startedAtMs || patch.date,
    });

    const incomingLocalRunId = patch.localRunId || patch.activeRunId || patch.id || base.localRunId;
    const incomingCheckpointAtMs = getCheckpointTimestampMs(patch, null);
    const existingCheckpointAtMs = existing ? getCheckpointTimestampMs(existing, 0) : 0;
    const incomingStatus = patch.status || base.status;
    if (
      existing &&
      incomingCheckpointAtMs != null &&
      String(incomingLocalRunId) === String(existing.localRunId) &&
      isLiveStatus(incomingStatus) &&
      hasCheckpointPayload(existing) &&
      existingCheckpointAtMs > incomingCheckpointAtMs
    ) {
      log("stale_checkpoint_ignored", {
        localRunId: existing.localRunId,
        existingCheckpointAtMs,
        incomingCheckpointAtMs,
        status: incomingStatus,
      });
      return existing;
    }

    const points = patch.points ? sanitizePoints(patch.points) : sanitizePoints(base.points);
    const segments = patch.segments
      ? sanitizeSegments(patch.segments, points)
      : sanitizeSegments(base.segments, points);
    const checkpoint = normalizeCheckpointFields(patch);

    const next = {
      ...base,
      ...patch,
      localRunId: String(incomingLocalRunId || base.localRunId),
      mode: normalizeOfflineMode(patch.mode || base.mode),
      points,
      segments,
      territoryData: patch.territoryData === undefined ? base.territoryData : patch.territoryData,
      updatedAt: nowIso(),
      checkpointAt: checkpoint.checkpointAt,
      checkpointAtMs: checkpoint.checkpointAtMs,
      schemaVersion: ACTIVE_RUN_SCHEMA_VERSION,
    };

    await AsyncStorage.setItem(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(next));
    return next;
  });
}

export async function saveActiveRunSnapshot(snapshot = {}) {
  return updateActiveRun(snapshot);
}

export function buildOfflineRunFromRunData(runData = {}, options = {}) {
  const points = sanitizePoints(runData.trustedPath || runData.path || runData.filteredPoints || []);
  const segments = sanitizeSegments(runData.routeSegments || runData.segments || [], points);
  const durationMsFromPayload = toFiniteNumber(runData.durationMs, null);
  const durationSecondsFromPayload = toFiniteNumber(runData.durationSeconds ?? runData.duration, null);
  const durationMs = durationMsFromPayload != null
    ? durationMsFromPayload
    : durationSecondsFromPayload != null
      ? durationSecondsFromPayload * 1000
      : 0;
  const distanceMeters = toFiniteNumber(runData.distanceMeters ?? runData.distance, 0) ?? 0;
  const pace = distanceMeters > 0 && durationMs > 0
    ? durationMs / 1000 / (distanceMeters / 1000)
    : undefined;

  return {
    localRunId: String(runData.id || options.localRunId || `local_${Date.now()}`),
    remoteRunId: runData.remoteRunId,
    userId: runData.userId || options.userId || "offline",
    mode: normalizeOfflineMode(runData.mode || options.mode),
    status: options.status || ACTIVE_RUN_STATUS.FINISHED,
    syncStatus: options.syncStatus || ACTIVE_RUN_SYNC_STATUS.LOCAL_ONLY,
    startedAt: toIso(runData.startedAt || runData.date || options.startedAt),
    endedAt: toIso(runData.endedAt || runData.date || options.endedAt),
    durationMs,
    movingDurationMs: toFiniteNumber(runData.movingDurationMs, durationMs) ?? durationMs,
    distanceMeters,
    pace,
    averageSpeed: toFiniteNumber(runData.averageSpeed ?? runData.avgSpeed, undefined),
    maxSpeed: toFiniteNumber(runData.maxSpeed, undefined),
    points,
    segments,
    territoryData: buildTerritoryData(runData),
    finalRunData: runData,
    createdAt: toIso(runData.createdAt || options.createdAt || runData.date),
    updatedAt: nowIso(),
    checkpointAt: toIso(runData.endedAt || runData.date || options.endedAt),
    checkpointAtMs: toTimestampMs(runData.endedAt || runData.date || options.endedAt, Date.now()),
    syncAttempts: toFiniteNumber(runData.syncAttempts, 0) ?? 0,
    lastSyncError: runData.lastSyncError,
    schemaVersion: ACTIVE_RUN_SCHEMA_VERSION,
  };
}

export async function finishActiveRun(runData = {}, options = {}) {
  return saveActiveRun(buildOfflineRunFromRunData(runData, options));
}

export async function clearActiveRun() {
  return enqueueWrite(async () => {
    await AsyncStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
  });
}

export function shouldRestoreActiveRun(run = null) {
  if (!run?.localRunId) return false;
  return [
    ACTIVE_RUN_STATUS.RUNNING,
    ACTIVE_RUN_STATUS.PAUSED,
  ].includes(run.status);
}

export function shouldRecoverOfflineRun(run = null) {
  if (!run?.localRunId) return false;
  if (run.syncStatus === ACTIVE_RUN_SYNC_STATUS.SYNCED || run.status === ACTIVE_RUN_STATUS.SYNCED) {
    return false;
  }
  return [
    ACTIVE_RUN_STATUS.RUNNING,
    ACTIVE_RUN_STATUS.PAUSED,
    ACTIVE_RUN_STATUS.FINISHED,
    ACTIVE_RUN_STATUS.PENDING_SYNC,
    ACTIVE_RUN_STATUS.SYNC_FAILED,
  ].includes(run.status);
}

export default {
  ACTIVE_RUN_MAX_POINTS,
  ACTIVE_RUN_SCHEMA_VERSION,
  ACTIVE_RUN_STATUS,
  ACTIVE_RUN_STORAGE_KEY,
  ACTIVE_RUN_SYNC_STATUS,
  buildOfflineRunFromRunData,
  clearActiveRun,
  createActiveRun,
  finishActiveRun,
  loadActiveRun,
  normalizeOfflineMode,
  saveActiveRun,
  saveActiveRunSnapshot,
  shouldRecoverOfflineRun,
  shouldRestoreActiveRun,
  toAppRunMode,
  updateActiveRun,
};
