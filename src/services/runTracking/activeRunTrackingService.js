import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";
import * as Location from "expo-location";
import { getRunBackgroundLocationOptions } from "./expoLocation.js";
import {
  ACTIVE_RUN_STATUS,
  ACTIVE_RUN_STORAGE_KEY,
  buildRunDataFromActiveSnapshot,
  calculateActiveRunDurationSeconds,
  createRunId,
  createSnapshotFromTrackingSession,
  createTrackingSessionFromSnapshot,
  mergeActiveRunSnapshots,
  normalizeActiveRunSnapshot,
  nowIso,
  reconcileRunState,
} from "./activeRunState.js";
import logger, { LOG_CATEGORIES } from "../../utils/logger.js";
import {
  recordRunEvent,
  recordRunSnapshotEvent,
  summarizeRunSnapshot,
} from "../diagnostics/runDiagnosticsService.js";
import {
  evaluateGpsShadowPoint,
  resetGpsShadowRun,
} from "../diagnostics/gpsDebugShadowService.js";

export const ACTIVE_RUN_LOCATION_TASK = "WAYPER_ACTIVE_RUN_LOCATION";
export const ACTIVE_RUN_BACKUP_STORAGE_KEY = `${ACTIVE_RUN_STORAGE_KEY}:backup`;
export const ACTIVE_RUN_META_STORAGE_KEY = `${ACTIVE_RUN_STORAGE_KEY}:meta`;
export const ACTIVE_RUN_CORRUPT_STORAGE_KEY = `${ACTIVE_RUN_STORAGE_KEY}:corrupt`;
export const ACTIVE_RUN_ROUTE_CHUNK_INDEX_STORAGE_KEY = `${ACTIVE_RUN_STORAGE_KEY}:routeChunks:index`;
export const ACTIVE_RUN_ROUTE_CHUNK_KEY_PREFIX = `${ACTIVE_RUN_STORAGE_KEY}:routeChunk`;
export const ACTIVE_RUN_ROUTE_CHUNK_SIZE = 250;
export const ACTIVE_RUN_CHECKPOINT_INTERVAL_MS = 5000;
export const ACTIVE_RUN_CHECKPOINT_ACCEPTED_POINTS = 5;
export const ACTIVE_RUN_CHECKPOINT_RAW_POINTS = 10;

const NOTIFICATION_BODY = "Sua corrida esta sendo salva mesmo com a tela bloqueada.";
const DEFAULT_NOTIFICATION_COLOR = "#00E676";
const PROTECTED_ACTIVE_RUN_STATUSES = new Set([
  ACTIVE_RUN_STATUS.STARTING,
  ACTIVE_RUN_STATUS.RUNNING,
  ACTIVE_RUN_STATUS.PAUSED,
  ACTIVE_RUN_STATUS.RECOVERING,
  ACTIVE_RUN_STATUS.STOPPING,
  ACTIVE_RUN_STATUS.FINISHING,
  ACTIVE_RUN_STATUS.FINISHED,
  ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
]);

let activeSession = null;
let activeSnapshot = null;
let backgroundStarted = false;
let storage = AsyncStorage;
let debugEnabled = typeof __DEV__ !== "undefined" && __DEV__;
let writeQueue = Promise.resolve();
let locationIngestionQueue = Promise.resolve();
let pendingFlushCount = 0;
let lastPersistedAt = null;
let lastPersistedAtMs = 0;
let lastStorageError = null;
let lastRawPointReceivedAt = null;
let checkpointTimer = null;
let checkpointDirty = false;
let acceptedPointsSinceCheckpoint = 0;
let rawPointsSinceCheckpoint = 0;
let activeSnapshotRevision = 0;
let lastPersistedRevision = 0;
let pointOutcomeAggregate = {
  accepted: 0,
  rejected: 0,
  deduped: 0,
  reasons: {},
  sources: {},
  lastFlushedAtMs: 0,
};
let routeChunkWriteState = {
  activeRunId: null,
  chunks: new Map(),
};
let runtimeState = {
  foregroundWatcherStatus: "unknown",
  backgroundTaskStatus: "unknown",
  notificationStatus: "unknown",
  appState: null,
  screenFocusState: null,
  recoveryReason: null,
};

const listeners = {
  snapshot: new Set(),
  error: new Set(),
};

function toOptionalTimestampMs(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getPausedDurationIncludingOpenPause(snapshot = {}, nowMs = Date.now()) {
  const priorPausedMs = Math.max(
    0,
    Number(
      snapshot.pausedDurationMs ??
      snapshot.totalPausedMs ??
      snapshot.totalPausedTime ??
      0
    ) || 0
  );
  if (snapshot.status !== ACTIVE_RUN_STATUS.PAUSED) return priorPausedMs;

  const segments = Array.isArray(snapshot.segments) ? snapshot.segments : [];
  const lastSegment = segments[segments.length - 1] || null;
  const pauseStartedAtMs = toOptionalTimestampMs(
    snapshot.pausedAtMs ??
    snapshot.pausedAt ??
    snapshot.pauseStartedAt ??
    lastSegment?.endedAt ??
    lastSegment?.endTimestamp
  );
  if (pauseStartedAtMs == null) return priorPausedMs;
  return priorPausedMs + Math.max(0, Number(nowMs) - pauseStartedAtMs);
}

function log(event, payload = {}) {
  if (!debugEnabled) return;
  logger.debug(LOG_CATEGORIES.RUN_TRACKING, event, payload);
}

function devLog(prefix, message, payload = {}) {
  if (!debugEnabled) return;
  const category = prefix === "RunRecovery" ? LOG_CATEGORIES.RUN_RECOVERY : LOG_CATEGORIES.RUN_TRACKING;
  logger.debug(category, message, payload);
}

function logRunRecovery(message, payload = {}) {
  devLog("RunRecovery", message, payload);
}

function logRunGeometry(message, payload = {}) {
  devLog("RunGeometry", message, payload);
}

function emit(event, payload) {
  const set = listeners[event];
  if (!set) return;
  set.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      log("listener_error", { event, error: error?.message || error });
    }
  });
}

function emitSnapshot(snapshot, event = "snapshot") {
  emit("snapshot", { event, snapshot });
}

function emitError(error, context = {}) {
  log("error", { ...context, error: error?.message || error });
  logger.error(LOG_CATEGORIES.RUN_TRACKING, "ACTIVE_RUN_TRACKING_ERROR", {
    ...context,
    error,
  });
  emit("error", { error, context });
}

function isMissingBackgroundTaskError(error) {
  const message = String(error?.message || error || "");
  return message.includes("TaskNotFoundException")
    && message.includes(ACTIVE_RUN_LOCATION_TASK);
}

function isProtectedActiveRunStatus(status) {
  return PROTECTED_ACTIVE_RUN_STATUSES.has(String(status || "").toUpperCase());
}

function isStorageFullError(error) {
  return /SQLITE_FULL|database or disk is full|quota/i.test(String(error?.message || error));
}

function getSnapshotMetrics(snapshot = {}) {
  if (!snapshot) {
    return {
      distanceMeters: 0,
      elapsedMs: 0,
      trustedPointsCount: 0,
      rawPointsCount: 0,
      routeSegmentsCount: 0,
      routeChunksCount: 0,
    };
  }
  const normalized = normalizeActiveRunSnapshot(snapshot);
  return {
    distanceMeters: Number(normalized?.distanceMeters ?? normalized?.distance ?? 0) || 0,
    elapsedMs: normalized ? calculateActiveRunDurationSeconds(normalized) * 1000 : 0,
    trustedPointsCount: normalized?.trustedPath?.length || normalized?.points?.length || 0,
    rawPointsCount: normalized?.rawPath?.length || normalized?.rawPoints?.length || 0,
    routeSegmentsCount: normalized?.segments?.length || normalized?.routeSegments?.length || 0,
    routeChunksCount: normalized?.routeChunksIndex?.chunks?.length || 0,
  };
}

function shouldRecordMetricRecalculation(event = "", snapshot = {}, logs = []) {
  const sourceEvent = String(event || "");
  if (!sourceEvent.includes("_point_saved")) return true;
  return Boolean(
    snapshot?.meta?.activeSegmentEndCleared ||
    snapshot?.meta?.dedupedPoints ||
    snapshot?.meta?.distancePreserved ||
    snapshot?.meta?.elapsedPreserved ||
    snapshot?.meta?.staleSnapshotIgnored ||
    logs.length > 0
  );
}

function recordReconciliationLogEntries(entries = [], snapshot = {}, context = {}) {
  for (const entry of entries || []) {
    const { event: entryEvent, reason, ...entryContext } = entry || {};
    if (!entryEvent) continue;
    recordRunSnapshotEvent(entryEvent, snapshot, {
      ...entryContext,
      event: context.event || context.reason || "runtime",
      reason: reason || context.reason || context.event || "runtime",
    });
  }
}

function recordBackgroundTaskStatus(status, context = {}) {
  recordRunEvent("RUN_BACKGROUND_TASK_STATUS", {
    taskName: ACTIVE_RUN_LOCATION_TASK,
    status,
    backgroundStarted,
    ...context,
  }, {
    category: LOG_CATEGORIES.BACKGROUND,
  });
}

function updateRuntimeState(patch = {}) {
  runtimeState = {
    ...runtimeState,
    ...patch,
  };
  return runtimeState;
}

function setStorageHealth(patch = {}) {
  runtimeState = {
    ...runtimeState,
    storageHealth: {
      ...(runtimeState.storageHealth || {}),
      ...patch,
    },
  };
  return runtimeState.storageHealth;
}

function enqueueLocationIngestion(task) {
  const runTask = () => task();
  locationIngestionQueue = locationIngestionQueue.then(runTask, runTask);
  return locationIngestionQueue;
}

async function waitForLocationIngestion() {
  try {
    await locationIngestionQueue;
  } catch {
    // The originating ingestion logs its own error; lifecycle work must continue.
  }
}

function clearCheckpointTimer() {
  if (!checkpointTimer) return;
  clearTimeout(checkpointTimer);
  checkpointTimer = null;
}

function scheduleCheckpointTimer() {
  if (checkpointTimer || !checkpointDirty || !activeSnapshot?.activeRunId) return;
  const elapsed = lastPersistedAtMs > 0 ? Date.now() - lastPersistedAtMs : ACTIVE_RUN_CHECKPOINT_INTERVAL_MS;
  const delay = Math.max(0, ACTIVE_RUN_CHECKPOINT_INTERVAL_MS - elapsed);
  checkpointTimer = setTimeout(() => {
    checkpointTimer = null;
    flushPendingActiveRunCheckpoint({
      reason: "checkpoint_interval",
      force: true,
    }).catch((error) => {
      emitError(error, { fn: "checkpointTimer" });
    });
  }, delay);
}

function notePointOutcome(result = {}, source = "unknown") {
  const reason = String(result.reason || (result.accepted ? "accepted" : "unknown"));
  pointOutcomeAggregate.accepted += result.accepted ? 1 : 0;
  pointOutcomeAggregate.rejected += result.accepted ? 0 : 1;
  pointOutcomeAggregate.deduped += reason === "duplicate_point" ? 1 : 0;
  pointOutcomeAggregate.reasons[reason] = (pointOutcomeAggregate.reasons[reason] || 0) + 1;
  pointOutcomeAggregate.sources[source] = (pointOutcomeAggregate.sources[source] || 0) + 1;
}

function flushPointOutcomeAggregate(snapshot = activeSnapshot, reason = "checkpoint") {
  const total = pointOutcomeAggregate.accepted + pointOutcomeAggregate.rejected;
  if (total <= 0) return;
  recordRunSnapshotEvent("RUN_POINT_BATCH_SUMMARY", snapshot || {}, {
    reason,
    accepted: pointOutcomeAggregate.accepted,
    rejected: pointOutcomeAggregate.rejected,
    deduped: pointOutcomeAggregate.deduped,
    rejectReasons: pointOutcomeAggregate.reasons,
    sources: pointOutcomeAggregate.sources,
  }, {
    category: LOG_CATEGORIES.LOCATION,
  });
  pointOutcomeAggregate = {
    accepted: 0,
    rejected: 0,
    deduped: 0,
    reasons: {},
    sources: {},
    lastFlushedAtMs: Date.now(),
  };
}

function setActiveRunError(error, source = "active_run") {
  if (!activeSnapshot?.activeRunId) return;
  const errorAtMs = Date.now();
  const errorAt = nowIso(errorAtMs);
  activeSnapshot = normalizeActiveRunSnapshot({
    ...activeSnapshot,
    lastUpdatedAtMs: errorAtMs,
    lastUpdatedAt: errorAt,
    updatedAt: errorAt,
    lastError: {
      name: error?.name || "Error",
      code: error?.code || null,
      message: error?.message || String(error),
      source,
      at: errorAt,
    },
    recoveryPending: true,
  });
  activeSnapshotRevision += 1;
  checkpointDirty = true;
  scheduleCheckpointTimer();
}

function buildBufferedPointSnapshot(result = {}, source = "foreground") {
  if (!activeSnapshot?.activeRunId) return null;
  const nowMs = Date.now();
  const trustedPath = Array.isArray(result.trustedPath)
    ? result.trustedPath
    : activeSnapshot.trustedPath || [];
  const rawPath = Array.isArray(result.rawPath)
    ? result.rawPath
    : activeSnapshot.rawPath || trustedPath;
  const segments = Array.isArray(result.segments)
    ? result.segments
    : activeSnapshot.segments || [];
  const liveRenderPath = Array.isArray(result.liveRenderPath)
    ? result.liveRenderPath
    : activeSnapshot.liveRenderPath || trustedPath;
  const currentLocation = result.currentPosition || activeSnapshot.currentLocation ||
    trustedPath[trustedPath.length - 1] || null;
  const lastRawPoint = rawPath[rawPath.length - 1] || currentLocation;
  const measuredDistanceValue = result.stats?.distanceMeters ?? result.distanceMeters;
  const measuredDistance = Number(measuredDistanceValue);
  const previousDistance = Number(
    activeSnapshot.distanceMeters ?? activeSnapshot.distance ?? 0
  ) || 0;
  const distanceMeters = measuredDistanceValue != null &&
    measuredDistanceValue !== "" &&
    Number.isFinite(measuredDistance) &&
    measuredDistance >= 0
    ? measuredDistance
    : previousDistance;
  const quality = result.pathQuality || result.gpsQualitySummary ||
    activeSnapshot.pathQuality || activeSnapshot.gpsQualitySummary || null;

  // Point ingestion keeps the session-owned arrays by reference. Full
  // normalization/deduplication happens at the batched checkpoint, avoiding
  // another complete route copy for every GPS sample.
  return {
    ...activeSnapshot,
    status: ACTIVE_RUN_STATUS.RUNNING,
    source,
    lastUpdatedAtMs: nowMs,
    lastUpdatedAt: nowIso(nowMs),
    updatedAt: nowIso(nowMs),
    points: trustedPath,
    path: trustedPath,
    trustedPath,
    filteredPoints: trustedPath,
    rawPath,
    rawPoints: rawPath,
    segments,
    routeSegments: segments,
    liveRenderPath,
    displayPoints: liveRenderPath,
    currentLocation,
    lastPoint: lastRawPoint,
    lastRawPoint,
    lastValidPoint: currentLocation,
    distance: distanceMeters,
    distanceMeters,
    pathQuality: quality,
    gpsQualitySummary: quality,
    lowConfidenceSegments: result.lowConfidenceSegments || activeSnapshot.lowConfidenceSegments || [],
    smoothingVersion: result.smoothingVersion || activeSnapshot.smoothingVersion,
    filterVersion: result.filterVersion || activeSnapshot.filterVersion,
  };
}

function commitPointSnapshot(snapshot, event, result = {}) {
  if (!snapshot?.activeRunId) return null;
  activeSnapshot = snapshot;
  activeSnapshotRevision += 1;
  checkpointDirty = true;
  rawPointsSinceCheckpoint += 1;
  if (result.accepted) acceptedPointsSinceCheckpoint += 1;
  emitSnapshot(snapshot, event);
  scheduleCheckpointTimer();
  return snapshot;
}

function enqueueStorageWrite(task) {
  pendingFlushCount += 1;
  const runTask = async () => {
    try {
      return await task();
    } finally {
      pendingFlushCount = Math.max(0, pendingFlushCount - 1);
    }
  };
  writeQueue = writeQueue.then(runTask, runTask);
  return writeQueue;
}

async function waitForPendingWrites() {
  try {
    await writeQueue;
  } catch {
    // Failed writes are logged at their origin; reads still try current and backup.
  }
}

async function preserveCorruptSnapshot(raw, error, key) {
  if (!raw) return;
  try {
    await storage.setItem(ACTIVE_RUN_CORRUPT_STORAGE_KEY, JSON.stringify({
      key,
      capturedAt: nowIso(),
      error: error?.message || String(error),
      raw,
    }));
  } catch (preserveError) {
    logger.error(LOG_CATEGORIES.STORAGE, "RUN_CORRUPT_SNAPSHOT_PRESERVE_FAILED", {
      storageKey: key,
      error: preserveError,
    });
    recordRunEvent("RUN_CORRUPT_SNAPSHOT_PRESERVE_FAILED", {
      storageKey: key,
      error: preserveError,
      level: "error",
    });
  }
}

function getRouteChunkStorageKey(activeRunId, index) {
  return `${ACTIVE_RUN_ROUTE_CHUNK_KEY_PREFIX}:${encodeURIComponent(String(activeRunId || "unknown"))}:${index}`;
}

function getRouteChunkIndexStorageKey(activeRunId) {
  return `${ACTIVE_RUN_ROUTE_CHUNK_INDEX_STORAGE_KEY}:${encodeURIComponent(String(activeRunId || "unknown"))}`;
}

function sanitizeChunkPoint(point = {}) {
  if (!point) return null;
  const latitude = Number(point.latitude ?? point.lat);
  const longitude = Number(point.longitude ?? point.lng ?? point.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    timestamp: point.timestamp ?? null,
    accuracy: point.accuracy ?? null,
    speed: point.speed ?? null,
    heading: point.heading ?? null,
    altitude: point.altitude ?? null,
    altitudeAccuracy: point.altitudeAccuracy ?? null,
    segmentId: Number.isFinite(Number(point.segmentId)) ? Number(point.segmentId) : 0,
    index: Number.isFinite(Number(point.index)) ? Number(point.index) : undefined,
    source: point.source || undefined,
  };
}

function sanitizeChunkPath(path = []) {
  return (Array.isArray(path) ? path : []).map(sanitizeChunkPoint).filter(Boolean);
}

function buildSegmentMeta(snapshot = {}) {
  const status = String(snapshot.status || "").toUpperCase();
  const segments = Array.isArray(snapshot.segments) ? snapshot.segments : [];
  return segments
    .map((segment, index) => ({
      id: segment?.id || `segment_${Number.isFinite(Number(segment?.index)) ? Number(segment.index) : index}`,
      index: Number.isFinite(Number(segment?.index)) ? Number(segment.index) : index,
      startedAt: segment?.startedAt ?? segment?.startTimestamp ?? null,
      endedAt: segment?.endedAt ?? segment?.endTimestamp ?? null,
      startTimestamp: segment?.startTimestamp ?? segment?.startedAt ?? null,
      endTimestamp: segment?.endTimestamp ?? segment?.endedAt ?? null,
      reason: segment?.reason || null,
      endReason: segment?.endReason || null,
    }))
    .map((meta, index, all) => {
      const reason = String(meta.reason || "").toLowerCase();
      const isOpenRunningSegment =
        status === ACTIVE_RUN_STATUS.RUNNING &&
        index === all.length - 1 &&
        meta.endReason == null &&
        (!reason || reason === "active" || reason === "resume" || reason === "gps_gap");
      if (!isOpenRunningSegment || (meta.endedAt == null && meta.endTimestamp == null)) {
        return meta;
      }
      recordRunSnapshotEvent("ACTIVE_SEGMENT_INVALID_END_BLOCKED", snapshot, {
        segmentIndex: meta.index,
        endedAt: meta.endedAt,
        endTimestamp: meta.endTimestamp,
      });
      return {
        ...meta,
        endedAt: null,
        endTimestamp: null,
      };
    });
}

function buildRouteSegmentsFromChunks(index = {}, trustedPath = [], rawPath = []) {
  const metas = Array.isArray(index.segmentMeta) ? index.segmentMeta : [];
  if (metas.length === 0) return [];
  return metas
    .map((meta, fallbackIndex) => {
      const segmentIndex = Number.isFinite(Number(meta.index)) ? Number(meta.index) : fallbackIndex;
      const trusted = trustedPath.filter((point) => Number(point.segmentId || 0) === segmentIndex);
      const raw = rawPath.filter((point) => Number(point.segmentId || 0) === segmentIndex);
      if (trusted.length === 0 && raw.length === 0) return null;
      return {
        ...meta,
        index: segmentIndex,
        trustedPath: trusted,
        filteredPoints: trusted,
        rawPath: raw.length > 0 ? raw : trusted,
        rawPoints: raw.length > 0 ? raw : trusted,
        liveRenderPath: trusted,
        displayPoints: trusted,
        summaryRenderPath: trusted,
      };
    })
    .filter(Boolean);
}

async function persistRouteChunksForSnapshot(snapshot = {}, event = "snapshot_saved") {
  const activeRunId = snapshot.activeRunId;
  if (!activeRunId) return null;
  const trustedPath = Array.isArray(snapshot.trustedPath || snapshot.path)
    ? (snapshot.trustedPath || snapshot.path)
    : [];
  const rawPath = Array.isArray(snapshot.rawPath || snapshot.rawPoints)
    ? (snapshot.rawPath || snapshot.rawPoints)
    : trustedPath;
  const chunkSize = ACTIVE_RUN_ROUTE_CHUNK_SIZE;
  const totalChunks = Math.max(
    Math.ceil(trustedPath.length / chunkSize),
    Math.ceil(rawPath.length / chunkSize),
    0
  );
  const chunks = [];

  if (routeChunkWriteState.activeRunId !== activeRunId) {
    routeChunkWriteState = {
      activeRunId,
      chunks: new Map(),
    };
  }

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const key = getRouteChunkStorageKey(activeRunId, index);
    const trustedCount = Math.min(chunkSize, Math.max(0, trustedPath.length - start));
    const rawCount = Math.min(chunkSize, Math.max(0, rawPath.length - start));
    const closed = index < totalChunks - 1 || trustedCount >= chunkSize || rawCount >= chunkSize;
    const descriptor = {
      index,
      key,
      trustedCount,
      rawCount,
      closed,
    };
    chunks.push(descriptor);
    const previous = routeChunkWriteState.chunks.get(key);
    if (
      previous &&
      previous.trustedCount === descriptor.trustedCount &&
      previous.rawCount === descriptor.rawCount &&
      (previous.closed || previous.closed === descriptor.closed)
    ) {
      continue;
    }
    const trustedChunk = sanitizeChunkPath(trustedPath.slice(start, start + chunkSize));
    const rawChunk = sanitizeChunkPath(rawPath.slice(start, start + chunkSize));
    try {
      await storage.setItem(key, JSON.stringify({
        version: 1,
        activeRunId,
        index,
        chunkSize,
        trustedPath: trustedChunk,
        rawPath: rawChunk,
        updatedAt: nowIso(),
      }));
      routeChunkWriteState.chunks.set(key, descriptor);
      recordRunSnapshotEvent("RUN_ROUTE_CHUNK_WRITE", snapshot, {
        event,
        chunkIndex: index,
        trustedCount: trustedChunk.length,
        rawCount: rawChunk.length,
      });
      if (closed && !previous?.closed) {
        recordRunSnapshotEvent("RUN_ROUTE_CHUNK_ROTATED", snapshot, {
          event,
          chunkIndex: index,
        });
      }
    } catch (error) {
      lastStorageError = error;
      setStorageHealth({
        status: "chunk_write_failed",
        lastWriteFailedAt: nowIso(),
        lastError: error?.message || String(error),
        failedChunkIndex: index,
      });
      recordRunSnapshotEvent("RUN_ROUTE_CHUNK_WRITE_FAILED", snapshot, {
        event,
        chunkIndex: index,
        error,
      });
    }
  }

  const routeChunksIndex = {
    version: 1,
    activeRunId,
    chunkSize,
    chunks,
    totalTrustedPoints: trustedPath.length,
    totalRawPoints: rawPath.length,
    segmentMeta: buildSegmentMeta(snapshot),
    updatedAt: nowIso(),
  };

  try {
    await storage.setItem(getRouteChunkIndexStorageKey(activeRunId), JSON.stringify(routeChunksIndex));
  } catch (error) {
    lastStorageError = error;
    setStorageHealth({
      status: "chunk_index_write_failed",
      lastWriteFailedAt: nowIso(),
      lastError: error?.message || String(error),
    });
    recordRunSnapshotEvent("RUN_ROUTE_CHUNK_WRITE_FAILED", snapshot, {
      event,
      chunkIndex: "index",
      error,
    });
  }

  return routeChunksIndex;
}

function buildLightSnapshot(snapshot = {}, routeChunksIndex = null) {
  const {
    points,
    path,
    trustedPath,
    filteredPoints,
    rawPath,
    rawPoints,
    segments,
    routeSegments,
    liveRenderPath,
    displayPoints,
    summaryRenderPath,
    renderPath,
    displayPath,
    ...rest
  } = snapshot;
  const acceptedPointsCount = Array.isArray(trustedPath) ? trustedPath.length : 0;
  const rawPointsCount = Array.isArray(rawPath) ? rawPath.length : 0;
  const lastValidPoint = sanitizeChunkPoint(snapshot.currentLocation || trustedPath?.[trustedPath.length - 1] || null);
  const segmentMeta = routeChunksIndex?.segmentMeta || buildSegmentMeta(snapshot);
  return {
    ...rest,
    snapshotStorage: "light",
    routeChunksIndex,
    segmentMeta,
    pointsCount: acceptedPointsCount,
    acceptedPointsCount,
    rawPointsCount,
    rejectedPointsCount: Number(snapshot.pathQuality?.rejectedPoints || snapshot.gpsQualitySummary?.rejectedPoints || 0) || 0,
    currentSegmentId: segmentMeta[segmentMeta.length - 1]?.index ?? 0,
    lastValidPoint,
    currentLocation: lastValidPoint,
    meta: {
      ...(snapshot.meta || {}),
      snapshotStorage: "light",
      routeChunksStorageKey: snapshot.activeRunId ? getRouteChunkIndexStorageKey(snapshot.activeRunId) : null,
    },
  };
}

async function restoreSnapshotRouteChunks(snapshot = {}) {
  const indexFromSnapshot = snapshot.routeChunksIndex || null;
  let routeChunksIndex = indexFromSnapshot;
  if (!routeChunksIndex?.chunks?.length && snapshot.activeRunId) {
    try {
      const rawIndex = await storage.getItem(getRouteChunkIndexStorageKey(snapshot.activeRunId));
      routeChunksIndex = rawIndex ? JSON.parse(rawIndex) : routeChunksIndex;
    } catch (error) {
      lastStorageError = error;
      recordRunSnapshotEvent("RUN_ROUTE_CHUNK_WRITE_FAILED", snapshot, {
        event: "route_chunk_index_read",
        error,
      });
    }
  }
  if (!routeChunksIndex?.chunks?.length) return normalizeActiveRunSnapshot(snapshot);

  const trustedPath = [];
  const rawPath = [];
  let trustedPointsBeforeDedupe = 0;
  let rawPointsBeforeDedupe = 0;
  for (const descriptor of routeChunksIndex.chunks) {
    if (!descriptor?.key) continue;
    try {
      const raw = await storage.getItem(descriptor.key);
      if (!raw) continue;
      const chunk = JSON.parse(raw);
      const trustedChunk = sanitizeChunkPath(chunk.trustedPath || []);
      const rawChunk = sanitizeChunkPath(chunk.rawPath || []);
      trustedPointsBeforeDedupe += trustedChunk.length;
      rawPointsBeforeDedupe += rawChunk.length;
      trustedPath.push(...trustedChunk);
      rawPath.push(...rawChunk);
    } catch (error) {
      lastStorageError = error;
      recordRunSnapshotEvent("RUN_ROUTE_CHUNK_WRITE_FAILED", snapshot, {
        event: "route_chunk_read",
        chunkIndex: descriptor.index,
        error,
      });
    }
  }
  const segments = buildRouteSegmentsFromChunks(routeChunksIndex, trustedPath, rawPath);
  const restored = normalizeActiveRunSnapshot({
    ...snapshot,
    trustedPath,
    filteredPoints: trustedPath,
    path: trustedPath,
    points: trustedPath,
    rawPath: rawPath.length > 0 ? rawPath : trustedPath,
    rawPoints: rawPath.length > 0 ? rawPath : trustedPath,
    segments,
    routeSegments: segments,
    liveRenderPath: trustedPath,
    displayPoints: trustedPath,
    routeChunksIndex,
  });
  if (
    restored.trustedPath.length < trustedPointsBeforeDedupe ||
    restored.rawPath.length < rawPointsBeforeDedupe
  ) {
    recordRunSnapshotEvent("ROUTE_CHUNKS_DUPLICATE_POINTS_REMOVED", restored, {
      trustedPointsBeforeDedupe,
      trustedPointsAfterDedupe: restored.trustedPath.length,
      rawPointsBeforeDedupe,
      rawPointsAfterDedupe: restored.rawPath.length,
    });
    recordRunSnapshotEvent("RECOVERY_DISTANCE_RECALCULATED_FROM_DEDUPED_POINTS", restored, {
      distanceMeters: restored.distanceMeters,
      trustedPointsCount: restored.trustedPath.length,
    });
    recordRunSnapshotEvent("RUN_DISTANCE_RECALCULATED", restored, {
      event: "route_chunks_restore",
      distanceMeters: restored.distanceMeters,
      acceptedPointsCount: restored.trustedPath.length,
      dedupedTrustedPointsCount: trustedPointsBeforeDedupe - restored.trustedPath.length,
      dedupedRawPointsCount: rawPointsBeforeDedupe - restored.rawPath.length,
    });
  }
  if (restored.meta?.activeSegmentEndCleared) {
    recordRunSnapshotEvent("ACTIVE_SEGMENT_STALE_END_CLEARED", restored, {
      source: "route_chunks_restore",
    });
    recordRunSnapshotEvent("ACTIVE_SEGMENT_NORMALIZED", restored, {
      source: "route_chunks_restore",
    });
  }
  recordRunSnapshotEvent("RUN_ROUTE_CHUNKS_RESTORED", restored, {
    chunksCount: routeChunksIndex.chunks.length,
    trustedPointsCount: trustedPath.length,
    rawPointsCount: rawPath.length,
  });
  return restored;
}

async function removeRouteChunksForRun(activeRunId) {
  if (!activeRunId) return;
  const indexKey = getRouteChunkIndexStorageKey(activeRunId);
  try {
    const rawIndex = await storage.getItem(indexKey);
    const routeChunksIndex = rawIndex ? JSON.parse(rawIndex) : activeSnapshot?.routeChunksIndex || null;
    const keys = (Array.isArray(routeChunksIndex?.chunks) ? routeChunksIndex.chunks : [])
      .map((chunk) => chunk?.key)
      .filter(Boolean);
    for (const key of keys) {
      await storage.removeItem(key);
    }
    await storage.removeItem(indexKey);
    routeChunkWriteState = {
      activeRunId: null,
      chunks: new Map(),
    };
  } catch (error) {
    lastStorageError = error;
    recordRunEvent("RUN_STORAGE_FLUSH_FAILED", {
      runId: activeRunId,
      reason: "route_chunk_cleanup_failed",
      error,
    });
  }
}

async function parseSnapshot(raw, source) {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  const snapshot = await restoreSnapshotRouteChunks(parsed);
  if (snapshot?.activeRunId) {
    recordRunSnapshotEvent("RUN_ACTIVE_SNAPSHOT_READ", snapshot, {
      source,
      storageKey: source === "backup" ? ACTIVE_RUN_BACKUP_STORAGE_KEY : ACTIVE_RUN_STORAGE_KEY,
    });
    recordRunSnapshotEvent("RECOVERY_LOADED_ACTIVE_RUN", snapshot, {
      source,
    });
  }
  return snapshot;
}

async function readSnapshotFromStorageKey(key, source) {
  const raw = await storage.getItem(key);
  if (!raw) return null;
  try {
    return await parseSnapshot(raw, source);
  } catch (error) {
    lastStorageError = error;
    setStorageHealth({
      status: "read_failed",
      lastReadFailedAt: nowIso(),
      lastError: error?.message || String(error),
      failedKey: key,
    });
    await preserveCorruptSnapshot(raw, error, key);
    recordRunEvent("RUN_REHYDRATE_FAILED", {
      source,
      storageKey: key,
      error,
      level: "error",
    });
    return null;
  }
}

async function persistSnapshot(snapshot, event = "snapshot_saved", options = {}) {
  const stateObservedAtMs = Number(
    options.nowMs ??
    snapshot?.lastUpdatedAtMs ??
    snapshot?.lastUpdatedAt ??
    snapshot?.updatedAt ??
    Date.now()
  ) || Date.now();
  const incoming = normalizeActiveRunSnapshot(snapshot, { nowMs: stateObservedAtMs });
  const previousMetrics = getSnapshotMetrics(activeSnapshot);
  const incomingMetrics = getSnapshotMetrics(incoming);
  const shouldMerge =
    activeSnapshot?.activeRunId &&
    incoming?.activeRunId &&
    activeSnapshot.activeRunId === incoming.activeRunId &&
    event !== "run_started";
  const reconciliation = options.alreadyCommitted
    ? { state: incoming, logs: [] }
    : shouldMerge
    ? reconcileRunState({
        currentState: activeSnapshot,
        incomingState: incoming,
        now: stateObservedAtMs,
        reason: event,
      })
    : {
        state: incoming,
        logs: incoming?.meta?.activeSegmentEndCleared
          ? [
              { event: "ACTIVE_SEGMENT_STALE_END_CLEARED", reason: event },
              { event: "ACTIVE_SEGMENT_NORMALIZED", reason: event },
            ]
          : [],
      };
  const normalized = reconciliation.state;
  if (!normalized) return null;
  if (!options.alreadyCommitted) {
    activeSnapshot = normalized;
    activeSnapshotRevision += 1;
  }
  const writeRevision = Number(options.revision || activeSnapshotRevision);
  recordReconciliationLogEntries(reconciliation.logs, normalized, { event, reason: event });
  const normalizedMetrics = getSnapshotMetrics(normalized);
  recordRunSnapshotEvent("RUN_STATE_SOURCE_SELECTED", normalized, {
    event,
    selectedSource: shouldMerge ? "reconciled_current_plus_incoming" : "incoming_snapshot",
    currentSource: activeSnapshot?.source || null,
    incomingSource: incoming?.source || null,
    hadCurrentState: Boolean(activeSnapshot?.activeRunId),
  });
  recordRunSnapshotEvent("RUN_STATE_RECONCILED", normalized, {
    event,
    source: normalized.source || incoming?.source || null,
    previousDistanceMeters: previousMetrics.distanceMeters,
    incomingDistanceMeters: incomingMetrics.distanceMeters,
    distanceMeters: normalizedMetrics.distanceMeters,
    previousElapsedMs: previousMetrics.elapsedMs,
    incomingElapsedMs: incomingMetrics.elapsedMs,
    elapsedMs: normalizedMetrics.elapsedMs,
    acceptedPointsCount: normalizedMetrics.trustedPointsCount,
    rawPointsCount: normalizedMetrics.rawPointsCount,
    routeSegmentsCount: normalizedMetrics.routeSegmentsCount,
    routeChunksCount: normalizedMetrics.routeChunksCount,
    dedupedTrustedPointsCount: Number(normalized.meta?.dedupedTrustedPointsCount || 0),
    dedupedRawPointsCount: Number(normalized.meta?.dedupedRawPointsCount || 0),
    staleSnapshotBlocked: Boolean(normalized.meta?.staleSnapshotIgnored),
    distanceRegressionBlocked: Boolean(normalized.meta?.distancePreserved),
    elapsedRegressionBlocked: Boolean(normalized.meta?.elapsedPreserved),
  });
  if (shouldRecordMetricRecalculation(event, normalized, reconciliation.logs || [])) {
    recordRunSnapshotEvent("RUN_DISTANCE_RECALCULATED", normalized, {
      event,
      previousDistanceMeters: previousMetrics.distanceMeters,
      incomingDistanceMeters: incomingMetrics.distanceMeters,
      distanceMeters: normalizedMetrics.distanceMeters,
      acceptedPointsCount: normalizedMetrics.trustedPointsCount,
      dedupedTrustedPointsCount: Number(normalized.meta?.dedupedTrustedPointsCount || 0),
    });
    recordRunSnapshotEvent("RUN_ELAPSED_RECALCULATED", normalized, {
      event,
      previousElapsedMs: previousMetrics.elapsedMs,
      incomingElapsedMs: incomingMetrics.elapsedMs,
      elapsedMs: normalizedMetrics.elapsedMs,
      status: normalized.status,
      startedAt: normalized.startedAt || null,
      pausedAt: normalized.pausedAt || null,
      finishedAt: normalized.finishedAt || null,
      totalPausedMs: Number(normalized.totalPausedMs || normalized.pausedDurationMs || 0) || 0,
    });
  }
  await enqueueStorageWrite(async () => {
    try {
      const routeChunksIndex = await persistRouteChunksForSnapshot(normalized, event);
      const snapshotForStorage = {
        ...normalized,
        routeChunksIndex,
      };
      if (writeRevision >= activeSnapshotRevision) {
        activeSnapshot = snapshotForStorage;
      }
      const lightSnapshot = buildLightSnapshot(snapshotForStorage, routeChunksIndex);
      const json = JSON.stringify(lightSnapshot);
      recordRunSnapshotEvent("RUN_STORAGE_FLUSH_STARTED", normalized, {
        event,
        pendingFlushCount,
      });
      await storage.setItem(ACTIVE_RUN_BACKUP_STORAGE_KEY, json);
      await storage.setItem(ACTIVE_RUN_STORAGE_KEY, json);
      lastPersistedAt = nowIso();
      lastPersistedAtMs = Date.now();
      lastPersistedRevision = Math.max(lastPersistedRevision, writeRevision);
      lastStorageError = null;
      await storage.setItem(ACTIVE_RUN_META_STORAGE_KEY, JSON.stringify({
        activeRunId: normalized.activeRunId,
        status: normalized.status,
        lastPersistedAt,
        lastUpdatedAt: normalized.lastUpdatedAt || null,
        acceptedPointsCount: normalized.trustedPath?.length || 0,
        rawPointsCount: normalized.rawPath?.length || 0,
        routeSegmentsCount: normalized.segments?.length || 0,
        routeChunksCount: routeChunksIndex?.chunks?.length || 0,
        routeChunksIndexKey: normalized.activeRunId ? getRouteChunkIndexStorageKey(normalized.activeRunId) : null,
      }));
      setStorageHealth({
        status: "ok",
        lastPersistedAt,
        lastError: null,
        currentKey: ACTIVE_RUN_STORAGE_KEY,
        backupKey: ACTIVE_RUN_BACKUP_STORAGE_KEY,
      });
      recordRunSnapshotEvent("RUN_ACTIVE_SNAPSHOT_WRITE", normalized, {
        event,
        storageKey: ACTIVE_RUN_STORAGE_KEY,
        backupKey: ACTIVE_RUN_BACKUP_STORAGE_KEY,
      });
      recordRunSnapshotEvent("RUN_SNAPSHOT_LIGHT_WRITE", normalized, {
        event,
        storageKey: ACTIVE_RUN_STORAGE_KEY,
        bytes: json.length,
        routeChunksCount: routeChunksIndex?.chunks?.length || 0,
      });
      recordRunSnapshotEvent("RUN_STORAGE_FLUSH_SUCCESS", normalized, {
        event,
        lastPersistedAt,
      });
      if (writeRevision >= activeSnapshotRevision) {
        checkpointDirty = false;
        acceptedPointsSinceCheckpoint = 0;
        rawPointsSinceCheckpoint = 0;
        clearCheckpointTimer();
      } else {
        checkpointDirty = true;
        scheduleCheckpointTimer();
      }
    } catch (error) {
      lastStorageError = error;
      setActiveRunError(error, event);
      const storageFull = isStorageFullError(error);
      setStorageHealth({
        status: storageFull ? "full" : "write_failed",
        lastWriteFailedAt: nowIso(),
        lastError: error?.message || String(error),
      });
      recordRunSnapshotEvent("RUN_ACTIVE_SNAPSHOT_WRITE_FAILED", normalized, {
        event,
        error,
      });
      recordRunSnapshotEvent("RUN_STORAGE_FLUSH_FAILED", normalized, {
        event,
        error,
      });
      recordRunSnapshotEvent("ACTIVE_RUN_SAVE_FAILED", normalized, {
        event,
        error,
        storageFull,
      });
      scheduleCheckpointTimer();
      throw error;
    }
  });
  if (normalized?.meta?.ignoredEmptyGeometryOverwrite) {
    recordRunSnapshotEvent("ACTIVE_RUN_EMPTY_OVERWRITE_BLOCKED", normalized, {
      event,
    });
    logRunGeometry("ignored empty segment overwrite", {
      activeRunId: normalized.activeRunId,
      event,
      segments: normalized.segments?.length || 0,
      points: normalized.trustedPath?.length || 0,
    });
  }
  if (normalized?.meta?.distancePreserved) {
    recordRunSnapshotEvent("ACTIVE_RUN_DISTANCE_REGRESSION_BLOCKED", normalized, {
      event,
    });
    logRunGeometry("distance preserved", {
      activeRunId: normalized.activeRunId,
      event,
      distanceMeters: normalized.distanceMeters,
    });
  }
  if (normalized?.meta?.elapsedPreserved) {
    recordRunSnapshotEvent("ACTIVE_RUN_ELAPSED_REGRESSION_BLOCKED", normalized, {
      event,
    });
  }
  if (normalized?.meta?.staleSnapshotIgnored) {
    recordRunSnapshotEvent("ACTIVE_RUN_STALE_SNAPSHOT_BLOCKED", normalized, {
      event,
    });
    recordRunSnapshotEvent("RECOVERY_STALE_STATE_IGNORED", normalized, {
      event,
    });
  }
  if (normalized?.meta?.activeSegmentEndCleared) {
    recordRunSnapshotEvent("ACTIVE_SEGMENT_STALE_END_CLEARED", normalized, {
      event,
    });
    recordRunSnapshotEvent("ACTIVE_SEGMENT_NORMALIZED", normalized, {
      event,
    });
  }
  if (normalized?.meta?.dedupedPoints) {
    recordRunSnapshotEvent("RUN_POINTS_DEDUPED", normalized, {
      event,
      dedupedTrustedPointsCount: Number(normalized.meta?.dedupedTrustedPointsCount || 0),
      dedupedRawPointsCount: Number(normalized.meta?.dedupedRawPointsCount || 0),
    });
    recordRunSnapshotEvent("LOCATION_POINT_DEDUPED", normalized, {
      event,
      source: normalized.source || null,
      dedupedTrustedPointsCount: Number(normalized.meta?.dedupedTrustedPointsCount || 0),
      dedupedRawPointsCount: Number(normalized.meta?.dedupedRawPointsCount || 0),
    });
  }
  log(event, {
    activeRunId: normalized.activeRunId,
    status: normalized.status,
    points: normalized.trustedPath?.length || 0,
    source: normalized.source,
  });
  recordRunSnapshotEvent("ACTIVE_RUN_SAVED", normalized, {
    event,
  });
  if (options.emit !== false) emitSnapshot(normalized, event);
  return writeRevision >= activeSnapshotRevision ? (activeSnapshot || normalized) : normalized;
}

async function loadPersistedSnapshot() {
  try {
    await waitForPendingWrites();
    let current = null;
    try {
      current = await readSnapshotFromStorageKey(ACTIVE_RUN_STORAGE_KEY, "canonical_storage");
    } catch (error) {
      lastStorageError = error;
      setStorageHealth({
        status: "read_failed",
        lastReadFailedAt: nowIso(),
        lastError: error?.message || String(error),
        source: "canonical_storage",
      });
    }
    if (current) {
      lastPersistedAt = current.lastUpdatedAt || current.updatedAt || lastPersistedAt;
      lastPersistedAtMs = Number(current.lastUpdatedAtMs || Date.parse(lastPersistedAt || "")) || Date.now();
      setStorageHealth({
        status: "ok",
        lastReadAt: nowIso(),
        source: "canonical_storage",
      });
      recordRunSnapshotEvent("RUN_STATE_SOURCE_SELECTED", current, {
        reason: "load_persisted_snapshot",
        selectedSource: "canonical_storage",
      });
      return current;
    }

    let backup = null;
    try {
      backup = await readSnapshotFromStorageKey(ACTIVE_RUN_BACKUP_STORAGE_KEY, "backup");
    } catch (error) {
      lastStorageError = error;
      setStorageHealth({
        status: "backup_read_failed",
        lastReadFailedAt: nowIso(),
        lastError: error?.message || String(error),
        source: "backup",
      });
    }
    if (backup) {
      activeSnapshot = mergeActiveRunSnapshots(activeSnapshot, backup);
      lastPersistedAt = activeSnapshot?.lastUpdatedAt || activeSnapshot?.updatedAt || lastPersistedAt;
      lastPersistedAtMs = Number(activeSnapshot?.lastUpdatedAtMs || Date.parse(lastPersistedAt || "")) || Date.now();
      setStorageHealth({
        status: "backup_used",
        lastReadAt: nowIso(),
        source: "backup",
      });
      recordRunSnapshotEvent("RUN_ACTIVE_SNAPSHOT_BACKUP_USED", backup, {
        source: "backup",
      });
      recordRunSnapshotEvent("RUN_STATE_SOURCE_SELECTED", activeSnapshot || backup, {
        reason: "load_persisted_snapshot",
        selectedSource: "backup",
      });
      return activeSnapshot || backup;
    }

    setStorageHealth({
      status: "empty",
      lastReadAt: nowIso(),
    });
    return null;
  } catch (error) {
    lastStorageError = error;
    setStorageHealth({
      status: "read_failed",
      lastReadFailedAt: nowIso(),
      lastError: error?.message || String(error),
    });
    emitError(error, { fn: "loadPersistedSnapshot" });
    return null;
  }
}

function ensureSession(snapshot) {
  const normalized = normalizeActiveRunSnapshot(snapshot || activeSnapshot);
  if (!normalized) return null;
  if (!activeSession || activeSnapshot?.activeRunId !== normalized.activeRunId) {
    activeSession = createTrackingSessionFromSnapshot(normalized);
  }
  activeSnapshot = normalized;
  return activeSession;
}

async function getActiveSession() {
  if (activeSession && activeSnapshot) return activeSession;
  const snapshot = await loadPersistedSnapshot();
  if (!snapshot) return null;
  return ensureSession(snapshot);
}

async function performPendingCheckpoint(options = {}) {
  clearCheckpointTimer();
  const snapshot = activeSnapshot || (await loadPersistedSnapshot());
  if (!snapshot?.activeRunId) {
    recordRunEvent("RUN_CHECKPOINT_SKIPPED_NO_ACTIVE_SESSION", {
      reason: options.reason || "checkpoint",
    }, {
      category: LOG_CATEGORIES.STORAGE,
    });
    return null;
  }
  if (!checkpointDirty && options.force !== true) return snapshot;

  const revision = activeSnapshotRevision;
  const acceptedCount = acceptedPointsSinceCheckpoint;
  const rawCount = rawPointsSinceCheckpoint;
  try {
    const saved = await persistSnapshot(snapshot, "run_checkpoint_saved", {
      alreadyCommitted: true,
      emit: false,
      revision,
    });
    flushPointOutcomeAggregate(saved || snapshot, options.reason || "checkpoint");
    recordRunSnapshotEvent("RUN_CHECKPOINT_SAVED", saved || snapshot, {
      reason: options.reason || "checkpoint",
      acceptedPointsSinceCheckpoint: acceptedCount,
      rawPointsSinceCheckpoint: rawCount,
      revision,
    }, {
      category: LOG_CATEGORIES.STORAGE,
    });
    return saved || snapshot;
  } catch (error) {
    emitError(error, {
      fn: "flushPendingActiveRunCheckpoint",
      reason: options.reason || "checkpoint",
    });
    return activeSnapshot || snapshot;
  }
}

export function flushPendingActiveRunCheckpoint(options = {}) {
  if (options.insideIngestionQueue === true) {
    return performPendingCheckpoint(options);
  }
  return enqueueLocationIngestion(() => performPendingCheckpoint(options));
}

export function recordActiveRunFailure(error, context = {}) {
  return enqueueLocationIngestion(async () => {
    const failure = error instanceof Error ? error : new Error(String(error || "active run failure"));
    if (context.code && !failure.code) failure.code = context.code;
    setActiveRunError(failure, context.source || "active_run");
    recordRunEvent("ACTIVE_RUN_FAILURE_RECORDED", {
      runId: activeSnapshot?.activeRunId || null,
      source: context.source || "active_run",
      reason: context.reason || null,
      error: failure,
    });
    return performPendingCheckpoint({
      reason: context.reason || "active_run_failure",
      force: true,
      insideIngestionQueue: true,
    });
  });
}

function getBackgroundOptions(body = NOTIFICATION_BODY) {
  const useExpoForegroundService =
    Platform.OS !== "android" || !NativeModules?.WayperRunNotificationAndroid;

  return getRunBackgroundLocationOptions(Location, body, {
    notificationColor: DEFAULT_NOTIFICATION_COLOR,
    useForegroundService: useExpoForegroundService,
  });
}

export async function hasActiveRunSnapshot() {
  const snapshot = activeSnapshot || (await loadPersistedSnapshot());
  return Boolean(snapshot && [
    ACTIVE_RUN_STATUS.STARTING,
    ACTIVE_RUN_STATUS.RUNNING,
    ACTIVE_RUN_STATUS.PAUSED,
    ACTIVE_RUN_STATUS.RECOVERING,
    ACTIVE_RUN_STATUS.STOPPING,
    ACTIVE_RUN_STATUS.FINISHING,
    ACTIVE_RUN_STATUS.FINISHED,
    ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
  ].includes(snapshot.status));
}

export async function getActiveRunSnapshot() {
  const snapshot = activeSnapshot || (await loadPersistedSnapshot());
  return snapshot ? normalizeActiveRunSnapshot(snapshot) : null;
}

export function getCurrentDurationSeconds(nowMs = Date.now()) {
  const snapshot = activeSnapshot;
  if (!snapshot) return 0;
  return calculateActiveRunDurationSeconds(snapshot, { nowMs });
}

export function getTrackingRuntimeStatus() {
  const points = Array.isArray(activeSnapshot?.trustedPath) ? activeSnapshot.trustedPath : [];
  const rawPoints = Array.isArray(activeSnapshot?.rawPath) ? activeSnapshot.rawPath : [];
  const segments = Array.isArray(activeSnapshot?.segments) ? activeSnapshot.segments : [];
  const lastValidPoint = activeSnapshot?.currentLocation || points[points.length - 1] || null;
  const pathQuality = activeSnapshot?.pathQuality || activeSnapshot?.gpsQualitySummary || {};
  return {
    ...summarizeRunSnapshot(activeSnapshot || {}),
    activeRunId: activeSnapshot?.activeRunId || null,
    sessionId: activeSnapshot?.activeRunId || null,
    runId: activeSnapshot?.activeRunId || null,
    status: activeSnapshot?.status || null,
    startedAt: activeSnapshot?.startedAt || null,
    updatedAt: activeSnapshot?.lastUpdatedAt || null,
    lastPersistedAt,
    elapsedMs: activeSnapshot ? calculateActiveRunDurationSeconds(activeSnapshot) * 1000 : 0,
    totalPausedMs: Number(activeSnapshot?.pausedDurationMs || activeSnapshot?.totalPausedMs || 0) || 0,
    distanceMeters: Number(activeSnapshot?.distanceMeters || activeSnapshot?.distance || 0) || 0,
    acceptedPointsCount: points.length,
    rejectedPointsCount: Number(pathQuality.rejectedPoints || 0) || 0,
    currentSegment: segments[segments.length - 1] || null,
    routeSegments: segments,
    routeChunksCount: activeSnapshot?.routeChunksIndex?.chunks?.length || Math.ceil(points.length / ACTIVE_RUN_ROUTE_CHUNK_SIZE) || 0,
    routeChunksIndex: activeSnapshot?.routeChunksIndex || null,
    lastValidPoint,
    lastRawPointReceivedAt,
    foregroundWatcherStatus: runtimeState.foregroundWatcherStatus,
    watcherStatus: runtimeState.foregroundWatcherStatus && runtimeState.foregroundWatcherStatus !== "unknown"
      ? runtimeState.foregroundWatcherStatus
      : backgroundStarted
        ? "background_started"
        : "unknown",
    backgroundTaskStatus: runtimeState.backgroundTaskStatus || (backgroundStarted ? "started" : "unknown"),
    notificationStatus: runtimeState.notificationStatus,
    appState: runtimeState.appState,
    screenFocusState: runtimeState.screenFocusState,
    recoveryReason: runtimeState.recoveryReason,
    storageHealth: runtimeState.storageHealth || {
      status: lastStorageError ? "error" : lastPersistedAt ? "ok" : "unknown",
      lastError: lastStorageError?.message || null,
    },
    pendingFlushCount,
    checkpointDirty,
    acceptedPointsSinceCheckpoint,
    rawPointsSinceCheckpoint,
    activeSnapshotRevision,
    lastPersistedRevision,
    backgroundStarted,
    taskName: ACTIVE_RUN_LOCATION_TASK,
  };
}

export function setRunRuntimeSurfaceState(patch = {}) {
  return updateRuntimeState(patch);
}

export async function getBackgroundLocationTaskStatus() {
  if (Platform.OS === "web") {
    return {
      taskName: ACTIVE_RUN_LOCATION_TASK,
      started: false,
      status: "unsupported",
      checkedAt: nowIso(),
    };
  }
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(ACTIVE_RUN_LOCATION_TASK);
    backgroundStarted = Boolean(started);
    updateRuntimeState({
      backgroundTaskStatus: started ? "started" : "stopped",
    });
    return {
      taskName: ACTIVE_RUN_LOCATION_TASK,
      started: Boolean(started),
      status: started ? "started" : "stopped",
      checkedAt: nowIso(),
    };
  } catch (error) {
    return {
      taskName: ACTIVE_RUN_LOCATION_TASK,
      started: backgroundStarted,
      status: "probe_failed",
      checkedAt: nowIso(),
      error: error?.message || String(error),
    };
  }
}

function summarizeStoredSnapshot(raw, source) {
  if (!raw) {
    return {
      source,
      exists: false,
      bytes: 0,
      parseOk: false,
    };
  }
  try {
    const parsed = JSON.parse(raw);
    const snapshot = normalizeActiveRunSnapshot(parsed);
    const routeChunksIndex = parsed.routeChunksIndex || null;
    return {
      source,
      exists: true,
      bytes: String(raw).length,
      parseOk: Boolean(snapshot?.activeRunId),
      runId: snapshot?.activeRunId || null,
      status: snapshot?.status || null,
      startedAt: snapshot?.startedAt || null,
      updatedAt: snapshot?.lastUpdatedAt || null,
      acceptedPointsCount: Number(parsed.acceptedPointsCount ?? (Array.isArray(snapshot?.trustedPath) ? snapshot.trustedPath.length : 0)) || 0,
      rawPointsCount: Number(parsed.rawPointsCount ?? (Array.isArray(snapshot?.rawPath) ? snapshot.rawPath.length : 0)) || 0,
      routeSegmentsCount: Array.isArray(snapshot?.segments) ? snapshot.segments.length : 0,
      routeChunksCount: routeChunksIndex?.chunks?.length || 0,
      snapshotStorage: parsed.snapshotStorage || "full",
      distanceMeters: Number(snapshot?.distanceMeters || 0) || 0,
      lastValidPoint: snapshot?.currentLocation
        ? {
            latitude: snapshot.currentLocation.latitude,
            longitude: snapshot.currentLocation.longitude,
            timestamp: snapshot.currentLocation.timestamp || null,
          }
        : null,
    };
  } catch (error) {
    return {
      source,
      exists: true,
      bytes: String(raw).length,
      parseOk: false,
      error: error?.message || String(error),
    };
  }
}

function summarizeRouteChunks(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const index = parsed.routeChunksIndex || null;
    if (!index) return null;
    return {
      activeRunId: index.activeRunId || parsed.activeRunId || null,
      chunkSize: index.chunkSize || ACTIVE_RUN_ROUTE_CHUNK_SIZE,
      chunksCount: Array.isArray(index.chunks) ? index.chunks.length : 0,
      totalTrustedPoints: Number(index.totalTrustedPoints || 0) || 0,
      totalRawPoints: Number(index.totalRawPoints || 0) || 0,
      updatedAt: index.updatedAt || null,
    };
  } catch {
    return null;
  }
}

export async function getActiveRunStorageDiagnostics() {
  await waitForPendingWrites();
  const [currentRaw, backupRaw, metaRaw, corruptRaw] = await Promise.all([
    storage.getItem(ACTIVE_RUN_STORAGE_KEY).catch(() => null),
    storage.getItem(ACTIVE_RUN_BACKUP_STORAGE_KEY).catch(() => null),
    storage.getItem(ACTIVE_RUN_META_STORAGE_KEY).catch(() => null),
    storage.getItem(ACTIVE_RUN_CORRUPT_STORAGE_KEY).catch(() => null),
  ]);
  let meta = null;
  try {
    meta = metaRaw ? JSON.parse(metaRaw) : null;
  } catch (error) {
    meta = { parseOk: false, error: error?.message || String(error) };
  }
  return {
    current: summarizeStoredSnapshot(currentRaw, "current"),
    backup: summarizeStoredSnapshot(backupRaw, "backup"),
    routeChunks: summarizeRouteChunks(currentRaw) || summarizeRouteChunks(backupRaw),
    meta,
    corrupt: corruptRaw
      ? {
          exists: true,
          bytes: String(corruptRaw).length,
        }
      : {
          exists: false,
          bytes: 0,
        },
    storageHealth: runtimeState.storageHealth || null,
    pendingFlushCount,
    lastStorageError: lastStorageError?.message || null,
  };
}

export function onActiveRunSnapshot(listener) {
  listeners.snapshot.add(listener);
  return () => listeners.snapshot.delete(listener);
}

export function onActiveRunError(listener) {
  listeners.error.add(listener);
  return () => listeners.error.delete(listener);
}

export function setActiveRunDebug(enabled = true) {
  debugEnabled = !!enabled;
}

export async function startBackgroundLocationUpdates(options = {}) {
  try {
    if (Platform.OS === "web") return false;
    const snapshot = activeSnapshot || (await loadPersistedSnapshot());
    if (!snapshot || snapshot.status !== ACTIVE_RUN_STATUS.RUNNING) return false;

    const started = await Location.hasStartedLocationUpdatesAsync(ACTIVE_RUN_LOCATION_TASK).catch(() => false);
    if (started && options.forceRestart !== true) {
      backgroundStarted = true;
      updateRuntimeState({
        backgroundTaskStatus: "started",
      });
      recordRunSnapshotEvent("LOCATION_WATCHER_STARTED", snapshot, {
        watcherStatus: "already_started",
        backgroundTaskStatus: ACTIVE_RUN_LOCATION_TASK,
      });
      recordRunSnapshotEvent("RUN_BACKGROUND_TASK_STARTED", snapshot, {
        backgroundTaskStatus: "already_started",
        taskName: ACTIVE_RUN_LOCATION_TASK,
      });
      recordBackgroundTaskStatus("already_started", {
        runId: snapshot.activeRunId,
        reason: options.reason || "start",
      });
      logRunRecovery("watcher alive", {
        activeRunId: snapshot.activeRunId,
        task: ACTIVE_RUN_LOCATION_TASK,
      });
      return true;
    }

    if (!started) {
      recordRunSnapshotEvent("LOCATION_WATCHER_RESTARTED", snapshot, {
        watcherStatus: "restarting",
        backgroundTaskStatus: ACTIVE_RUN_LOCATION_TASK,
      });
      recordRunSnapshotEvent("RUN_BACKGROUND_TASK_CANCELLED_OR_STOPPED", snapshot, {
        reason: "not_started_while_running",
        taskName: ACTIVE_RUN_LOCATION_TASK,
      });
      recordBackgroundTaskStatus("not_started_while_running", {
        runId: snapshot.activeRunId,
        reason: options.reason || "start",
      });
      logRunRecovery("restarting watcher without clearing path", {
        activeRunId: snapshot.activeRunId,
        task: ACTIVE_RUN_LOCATION_TASK,
      });
    }
    await Location.startLocationUpdatesAsync(
      ACTIVE_RUN_LOCATION_TASK,
      getBackgroundOptions(snapshot.notificationBody || NOTIFICATION_BODY)
    );
    backgroundStarted = true;
    updateRuntimeState({
      backgroundTaskStatus: "started",
    });
    log("background_tracking_started", { activeRunId: snapshot.activeRunId });
    recordRunSnapshotEvent("LOCATION_WATCHER_STARTED", snapshot, {
      watcherStatus: "started",
      backgroundTaskStatus: ACTIVE_RUN_LOCATION_TASK,
    });
    recordRunSnapshotEvent("RUN_BACKGROUND_TASK_STARTED", snapshot, {
      backgroundTaskStatus: "started",
      taskName: ACTIVE_RUN_LOCATION_TASK,
      force: Boolean(options.force),
    });
    recordBackgroundTaskStatus("started", {
      runId: snapshot.activeRunId,
      force: Boolean(options.force),
      reason: options.reason || "start",
    });
    return true;
  } catch (error) {
    backgroundStarted = false;
    setActiveRunError(error, "startBackgroundLocationUpdates");
    updateRuntimeState({
      backgroundTaskStatus: "start_failed",
    });
    recordBackgroundTaskStatus("start_failed", {
      reason: options.reason || "start",
      error,
    });
    emitError(error, { fn: "startBackgroundLocationUpdates" });
    await performPendingCheckpoint({
      reason: "background_service_start_failed",
      force: true,
      insideIngestionQueue: true,
    });
    return false;
  }
}

export async function stopBackgroundLocationUpdates(options = {}) {
  try {
    if (Platform.OS === "web") return false;
    const runId = activeSnapshot?.activeRunId || null;
    const started = await Location.hasStartedLocationUpdatesAsync(ACTIVE_RUN_LOCATION_TASK).catch(() => backgroundStarted);
    if (started) {
      try {
        await Location.stopLocationUpdatesAsync(ACTIVE_RUN_LOCATION_TASK);
      } catch (error) {
        if (!isMissingBackgroundTaskError(error)) throw error;
      }
    }
    backgroundStarted = false;
    updateRuntimeState({
      backgroundTaskStatus: "stopped",
    });
    log("background_tracking_stopped", { reason: options.reason || "manual" });
    recordRunEvent("LOCATION_WATCHER_STOPPED", {
      runId,
      reason: options.reason || "manual",
      watcherStatus: "stopped",
      backgroundTaskStatus: ACTIVE_RUN_LOCATION_TASK,
    });
    recordRunEvent("RUN_BACKGROUND_TASK_CANCELLED_OR_STOPPED", {
      runId,
      reason: options.reason || "manual",
      backgroundTaskStatus: "stopped",
      taskName: ACTIVE_RUN_LOCATION_TASK,
    });
    recordBackgroundTaskStatus("stopped", {
      runId,
      reason: options.reason || "manual",
    });
    return true;
  } catch (error) {
    recordBackgroundTaskStatus("stop_failed", {
      reason: options.reason || "manual",
      error,
    });
    emitError(error, { fn: "stopBackgroundLocationUpdates", reason: options.reason || "manual" });
    return false;
  }
}

async function startActiveRunInternal(options = {}) {
  const nowMs = Number(options.startedAtMs || Date.now());
  const runId = options.activeRunId || options.id || createRunId(nowMs);
  updateRuntimeState({
    recoveryReason: null,
  });
  recordRunEvent("RUN_START_REQUESTED", {
    runId,
    userId: options.userId || "offline",
    mode: options.mode || "free",
    startedAtMs: nowMs,
  });
  recordRunEvent("RUN_START_ATTEMPT", {
    runId,
    userId: options.userId || "offline",
    mode: options.mode || "free",
    startedAtMs: nowMs,
  });
  const existing = activeSnapshot || (await loadPersistedSnapshot());
  if (
    existing?.activeRunId &&
    isProtectedActiveRunStatus(existing.status) &&
    existing.activeRunId !== runId &&
    options.replaceExisting !== true
  ) {
    const restored = ensureSession({
      ...existing,
      meta: {
        ...(existing.meta || {}),
        protectedFromReplace: true,
      },
    });
    const protectedSnapshot = normalizeActiveRunSnapshot({
      ...existing,
      meta: {
        ...(existing.meta || {}),
        protectedFromReplace: true,
      },
    });
    activeSession = restored;
    activeSnapshot = protectedSnapshot;
    emitSnapshot(protectedSnapshot, "run_start_ignored_existing_active");
    recordRunSnapshotEvent("RUN_START_FAILED", protectedSnapshot, {
      reason: "existing_active_run",
      incomingRunId: runId,
      level: "warn",
    });
    if (protectedSnapshot.status === ACTIVE_RUN_STATUS.RUNNING) {
      await startBackgroundLocationUpdates({ force: false });
    }
    return protectedSnapshot;
  }

  const base = {
    activeRunId: runId,
    id: runId,
    userId: options.userId || "offline",
    mode: options.mode || "free",
    status: ACTIVE_RUN_STATUS.RUNNING,
    startedAtMs: nowMs,
    startedAt: options.startedAt || nowIso(nowMs),
    lastUpdatedAtMs: nowMs,
    lastUpdatedAt: nowIso(nowMs),
    notificationBody: NOTIFICATION_BODY,
    source: "foreground",
    meta: options.meta || {},
  };

  clearCheckpointTimer();
  checkpointDirty = false;
  acceptedPointsSinceCheckpoint = 0;
  rawPointsSinceCheckpoint = 0;
  activeSnapshotRevision = 0;
  lastPersistedRevision = 0;
  pointOutcomeAggregate = {
    accepted: 0,
    rejected: 0,
    deduped: 0,
    reasons: {},
    sources: {},
    lastFlushedAtMs: Date.now(),
  };
  activeSession = createTrackingSessionFromSnapshot({
    ...base,
    points: [],
    rawPoints: [],
    segments: [],
  });
  activeSession.start?.({ startedAt: nowMs });
  const snapshot = createSnapshotFromTrackingSession(activeSession, base, {
    status: ACTIVE_RUN_STATUS.RUNNING,
    nowMs,
    source: "foreground",
  });
  const saved = await persistSnapshot(snapshot, "run_started");
  await startBackgroundLocationUpdates({ force: true });
  recordRunSnapshotEvent("RUN_STARTED", saved);
  recordRunSnapshotEvent("RUN_START_SUCCESS", saved);
  return saved;
}

export function startActiveRun(options = {}) {
  return enqueueLocationIngestion(() => startActiveRunInternal(options));
}

async function restoreActiveRunInternal(options = {}) {
  recordRunEvent("RECOVERY_STARTED", {
    source: options.snapshot ? "provided_snapshot" : "canonical_storage",
  });
  if (options.snapshot) {
    return hydrateActiveRunSnapshotInternal(options.snapshot, {
      ...options,
      event: options.event || "run_restored",
    });
  }

  const snapshot = await loadPersistedSnapshot();
  if (!snapshot) return null;
  logRunRecovery("loaded active run", {
    activeRunId: snapshot.activeRunId,
    status: snapshot.status,
    segments: snapshot.segments?.length || 0,
    points: snapshot.trustedPath?.length || 0,
  });

  return hydrateActiveRunSnapshotInternal({
    ...snapshot,
    meta: {
      ...(snapshot.meta || {}),
      recovered: true,
    },
  }, {
    ...options,
    event: "run_restored",
  });
}

export function restoreActiveRun(options = {}) {
  return enqueueLocationIngestion(() => restoreActiveRunInternal(options));
}

async function hydrateActiveRunSnapshotInternal(snapshot = {}, options = {}) {
  try {
    const normalized = normalizeActiveRunSnapshot({
      ...snapshot,
      meta: {
        ...(snapshot.meta || {}),
        recovered: Boolean(snapshot.meta?.recovered || options.recovered),
      },
    });
    if (!normalized?.activeRunId) return null;

    const existing = activeSnapshot || (await loadPersistedSnapshot());
    if (
      existing?.activeRunId &&
      existing.activeRunId !== normalized.activeRunId &&
      isProtectedActiveRunStatus(existing.status) &&
      options.replaceExisting !== true
    ) {
      const protectedSnapshot = normalizeActiveRunSnapshot({
        ...existing,
        meta: {
          ...(existing.meta || {}),
          protectedFromReplace: true,
        },
      });
      activeSession = createTrackingSessionFromSnapshot(protectedSnapshot);
      activeSnapshot = protectedSnapshot;
      log("run_hydrate_ignored_existing_active", {
        activeRunId: protectedSnapshot.activeRunId,
        incomingRunId: normalized.activeRunId,
      });
      emitSnapshot(protectedSnapshot, "run_hydrate_ignored_existing_active");
      return protectedSnapshot;
    }

    logRunRecovery("segments before merge", {
      activeRunId: normalized.activeRunId,
      existingSegments: existing?.segments?.length || 0,
      incomingSegments: normalized.segments?.length || 0,
      existingPoints: existing?.trustedPath?.length || existing?.path?.length || 0,
      incomingPoints: normalized.trustedPath?.length || normalized.path?.length || 0,
    });

    const reconciliation = existing?.activeRunId === normalized.activeRunId
      ? reconcileRunState({
          currentState: existing,
          incomingState: normalized,
          now: Date.now(),
          reason: options.event || "run_hydrated",
        })
      : {
          state: normalized,
          logs: normalized.meta?.activeSegmentEndCleared
            ? [
                { event: "ACTIVE_SEGMENT_STALE_END_CLEARED", reason: options.event || "run_hydrated" },
                { event: "ACTIVE_SEGMENT_NORMALIZED", reason: options.event || "run_hydrated" },
              ]
            : [],
        };
    const reconciled = reconciliation.state;
    recordReconciliationLogEntries(reconciliation.logs, reconciled, {
      event: options.event || "run_hydrated",
      reason: options.event || "run_hydrated",
    });

    recordRunSnapshotEvent("RECOVERY_MERGED_STATE", reconciled, {
      existingSegments: existing?.segments?.length || 0,
      incomingSegments: normalized.segments?.length || 0,
    });

    logRunRecovery("segments after merge", {
      activeRunId: reconciled.activeRunId,
      segments: reconciled.segments?.length || 0,
      points: reconciled.trustedPath?.length || 0,
      distanceMeters: reconciled.distanceMeters,
    });

    activeSession = createTrackingSessionFromSnapshot(reconciled);
    const saved = await persistSnapshot(reconciled, options.event || "run_hydrated");

    log("run_hydrated", {
      activeRunId: saved.activeRunId,
      status: saved.status,
      points: saved.trustedPath?.length || 0,
      source: saved.source,
    });

    if (options.restartTracking !== false && saved.status === ACTIVE_RUN_STATUS.RUNNING) {
      await startBackgroundLocationUpdates({ force: false });
    }

    recordRunSnapshotEvent("RECOVERY_COMPLETED", saved, {
      event: options.event || "run_hydrated",
    });
    return saved;
  } catch (error) {
    recordRunEvent("RECOVERY_FAILED", {
      fn: "hydrateActiveRunSnapshot",
      error,
    });
    emitError(error, { fn: "hydrateActiveRunSnapshot" });
    return null;
  }
}

export function hydrateActiveRunSnapshot(snapshot = {}, options = {}) {
  return enqueueLocationIngestion(() => hydrateActiveRunSnapshotInternal(snapshot, options));
}

async function recordLocationInternal(location = {}, options = {}) {
  try {
    const session = await getActiveSession();
    if (!session || !activeSnapshot) {
      recordRunEvent("RUN_LOCATION_IGNORED_NO_ACTIVE_SESSION", {
        source: options.source || location.source || "unknown",
      }, {
        category: LOG_CATEGORIES.BACKGROUND,
      });
      return null;
    }
    if (activeSnapshot.status !== ACTIVE_RUN_STATUS.RUNNING) return activeSnapshot;

    const source = options.source || location.source || "foreground";
    lastRawPointReceivedAt = location.timestamp || Date.now();
    const result = session.processLocationPoint({
      ...location,
      source: source === "background" ? "expo-location" : location.source || source,
    });
    evaluateGpsShadowPoint(result.rawPoint || location, {
      runId: activeSnapshot.activeRunId,
      mode: activeSnapshot.mode || "run",
      startedAt: activeSnapshot.startedAtMs || activeSnapshot.startedAt,
      nowMs: Date.now(),
    });
    notePointOutcome(result, source);

    if (!result.accepted && !result.currentPositionChanged && !result.pathChanged) {
      log("point_ignored", { reason: result.reason, source });
    }

    if (result.accepted) {
      logRunGeometry("append point to segment", {
        activeRunId: activeSnapshot.activeRunId,
        segmentId: result.point?.segmentId ?? null,
        points: result.trustedPath?.length || 0,
        source,
      });
    }

    const snapshot = buildBufferedPointSnapshot(result, source);
    const buffered = commitPointSnapshot(
      snapshot,
      source === "background" ? "background_point_buffered" : "foreground_point_buffered",
      result
    );
    const checkpointDue =
      acceptedPointsSinceCheckpoint >= ACTIVE_RUN_CHECKPOINT_ACCEPTED_POINTS ||
      rawPointsSinceCheckpoint >= ACTIVE_RUN_CHECKPOINT_RAW_POINTS ||
      (lastPersistedAtMs > 0 && Date.now() - lastPersistedAtMs >= ACTIVE_RUN_CHECKPOINT_INTERVAL_MS);
    if (checkpointDue && options.deferCheckpoint !== true) {
      await performPendingCheckpoint({
        reason: "point_threshold",
        insideIngestionQueue: true,
        force: true,
      });
    }
    return activeSnapshot || buffered;
  } catch (error) {
    setActiveRunError(error, "recordLocation");
    emitError(error, { fn: "recordLocation" });
    return activeSnapshot;
  }
}

export function recordLocation(location = {}, options = {}) {
  return enqueueLocationIngestion(() => recordLocationInternal(location, options));
}

async function pauseActiveRunInternal(options = {}) {
  try {
    const session = await getActiveSession();
    if (!session || !activeSnapshot) return null;
    if (activeSnapshot.status === ACTIVE_RUN_STATUS.PAUSED) return activeSnapshot;
    if (activeSnapshot.status !== ACTIVE_RUN_STATUS.RUNNING) return activeSnapshot;
    const endedAt = Number(options.endedAtMs || Date.now());
    session.pause?.({ endedAt });
    const snapshot = createSnapshotFromTrackingSession(session, activeSnapshot, {
      status: ACTIVE_RUN_STATUS.PAUSED,
      nowMs: endedAt,
      source: options.source || "foreground",
    });
    const saved = await persistSnapshot(snapshot, "run_paused");
    await stopBackgroundLocationUpdates({ reason: "pause" });
    recordRunSnapshotEvent("PAUSE_SUCCESS", saved);
    return saved;
  } catch (error) {
    recordRunEvent("PAUSE_FAILED", { error });
    emitError(error, { fn: "pauseActiveRun" });
    return activeSnapshot;
  }
}

export function pauseActiveRun(options = {}) {
  return enqueueLocationIngestion(() => pauseActiveRunInternal(options));
}

async function resumeActiveRunInternal(options = {}) {
  try {
    const session = await getActiveSession();
    if (!session || !activeSnapshot) return null;
    if (activeSnapshot.status === ACTIVE_RUN_STATUS.RUNNING) return activeSnapshot;
    if (activeSnapshot.status !== ACTIVE_RUN_STATUS.PAUSED) return activeSnapshot;
    const startedAt = Number(options.startedAtMs || Date.now());
    const pausedDurationMs = getPausedDurationIncludingOpenPause(activeSnapshot, startedAt);
    session.resume?.({ startedAt });
    const snapshot = createSnapshotFromTrackingSession(session, {
      ...activeSnapshot,
      pausedDurationMs,
      totalPausedMs: pausedDurationMs,
      totalPausedTime: pausedDurationMs,
    }, {
      status: ACTIVE_RUN_STATUS.RUNNING,
      nowMs: startedAt,
      source: options.source || "foreground",
    });
    const saved = await persistSnapshot(snapshot, "run_resumed");
    await startBackgroundLocationUpdates({ force: true });
    recordRunSnapshotEvent("RESUME_SUCCESS", saved);
    return saved;
  } catch (error) {
    recordRunEvent("RESUME_FAILED", { error });
    emitError(error, { fn: "resumeActiveRun" });
    return activeSnapshot;
  }
}

export function resumeActiveRun(options = {}) {
  return enqueueLocationIngestion(() => resumeActiveRunInternal(options));
}

async function markActiveRunFinishingInternal(options = {}) {
  try {
    const session = await getActiveSession();
    if (!session || !activeSnapshot) return null;
    if ([ACTIVE_RUN_STATUS.FINISHING, ACTIVE_RUN_STATUS.FINISHED].includes(activeSnapshot.status)) {
      return activeSnapshot;
    }
    if (![ACTIVE_RUN_STATUS.RUNNING, ACTIVE_RUN_STATUS.PAUSED].includes(activeSnapshot.status)) {
      return activeSnapshot;
    }
    const nowMs = Number(options.nowMs || Date.now());
    const finishingPausedMs = getPausedDurationIncludingOpenPause(activeSnapshot, nowMs);
    const snapshot = createSnapshotFromTrackingSession(session, {
      ...activeSnapshot,
      pausedDurationMs: finishingPausedMs,
      totalPausedMs: finishingPausedMs,
      totalPausedTime: finishingPausedMs,
      recoveryPending: true,
    }, {
      status: ACTIVE_RUN_STATUS.FINISHING,
      nowMs,
      source: options.source || "foreground",
    });
    const saved = await persistSnapshot(snapshot, "run_finishing");
    await stopBackgroundLocationUpdates({ reason: "finishing" });
    recordRunSnapshotEvent("RUN_FINISHING", saved, {
      reason: options.reason || "user_confirmed_finish",
    });
    return saved;
  } catch (error) {
    recordRunEvent("RUN_FINISHING_FAILED", { error });
    emitError(error, { fn: "markActiveRunFinishing" });
    return activeSnapshot;
  }
}

export function markActiveRunFinishing(options = {}) {
  return enqueueLocationIngestion(() => markActiveRunFinishingInternal(options));
}

async function finishActiveRunInternal(options = {}) {
  try {
    const session = await getActiveSession();
    if (!session || !activeSnapshot) return null;
    if (activeSnapshot.status === ACTIVE_RUN_STATUS.FINISHED) return activeSnapshot;
    const finishedAtMs = Number(options.finishedAtMs || Date.now());
    const durationMs = calculateActiveRunDurationSeconds(activeSnapshot, { nowMs: finishedAtMs }) * 1000;
    const finish = session.finishTrackingSession?.({
      durationMs,
      finishedAt: finishedAtMs,
    });
    const snapshot = createSnapshotFromTrackingSession(session, {
      ...activeSnapshot,
      ...(finish || {}),
      finishedAtMs,
      finishedAt: options.finishedAt || nowIso(finishedAtMs),
    }, {
      status: ACTIVE_RUN_STATUS.FINISHED,
      nowMs: finishedAtMs,
      finishedAtMs,
      finishedAt: options.finishedAt || nowIso(finishedAtMs),
      source: options.source || "foreground",
    });
    const saved = await persistSnapshot(snapshot, "run_finished_snapshot_saved");
    await stopBackgroundLocationUpdates({ reason: "finish" });
    resetGpsShadowRun(saved?.activeRunId || snapshot?.activeRunId);
    recordRunSnapshotEvent("RUN_FINISH_FINAL_VALUES", saved, {
      finishedAtMs,
      elapsedMs: calculateActiveRunDurationSeconds(saved, { nowMs: finishedAtMs }) * 1000,
      distanceMeters: Number(saved?.distanceMeters || saved?.distance || 0) || 0,
      acceptedPointsCount: saved?.trustedPath?.length || 0,
      rawPointsCount: saved?.rawPath?.length || 0,
      routeSegmentsCount: saved?.segments?.length || 0,
    });
    recordRunSnapshotEvent("FINISH_SUCCESS", saved);
    return saved;
  } catch (error) {
    recordRunEvent("FINISH_FAILED", { error });
    emitError(error, { fn: "finishActiveRun" });
    return activeSnapshot;
  }
}

export function finishActiveRun(options = {}) {
  return enqueueLocationIngestion(() => finishActiveRunInternal(options));
}

export async function buildFinishedRunData(overrides = {}) {
  await waitForLocationIngestion();
  const snapshot = activeSnapshot || (await loadPersistedSnapshot());
  if (!snapshot) return null;
  return buildRunDataFromActiveSnapshot(snapshot, overrides);
}

async function markActiveRunLocallySavedInternal(options = {}) {
  try {
    const persistedSnapshot = activeSnapshot || (await loadPersistedSnapshot());
    const activeRunId = persistedSnapshot?.activeRunId || persistedSnapshot?.localRunId || persistedSnapshot?.id || null;
    const expectedRunId = String(
      options.expectedRunId || options.runId || options.localRunId || ""
    ).trim() || null;
    if (expectedRunId && activeRunId && String(activeRunId) !== expectedRunId) {
      recordRunEvent("RUN_ACTIVE_CLEANUP_ID_MISMATCH_BLOCKED", {
        expectedRunId,
        activeRunId,
        reason: options.reason || "local_run_saved",
        level: "warn",
      });
      return false;
    }
    await enqueueStorageWrite(async () => {
      await removeRouteChunksForRun(activeRunId);
      await storage.removeItem(ACTIVE_RUN_STORAGE_KEY);
      await storage.removeItem(ACTIVE_RUN_BACKUP_STORAGE_KEY);
      await storage.removeItem(ACTIVE_RUN_META_STORAGE_KEY);
    });
    activeSession = null;
    activeSnapshot = null;
    clearCheckpointTimer();
    checkpointDirty = false;
    acceptedPointsSinceCheckpoint = 0;
    rawPointsSinceCheckpoint = 0;
    activeSnapshotRevision = 0;
    lastPersistedRevision = 0;
    lastPersistedAt = null;
    lastPersistedAtMs = 0;
    flushPointOutcomeAggregate(null, "local_run_saved");
    setStorageHealth({
      status: "cleared",
      clearedAt: nowIso(),
    });
    log("active_snapshot_cleared", { reason: "local_run_saved" });
    recordRunEvent("RUN_SAVED_LOCAL", {
      reason: "local_run_saved",
    });
    recordRunEvent("RUN_ACTIVE_CLEARED", {
      reason: "local_run_saved",
    });
    emitSnapshot(null, "active_snapshot_cleared");
    return true;
  } catch (error) {
    emitError(error, { fn: "markActiveRunLocallySaved" });
    return false;
  }
}

export function markActiveRunLocallySaved(options = {}) {
  return enqueueLocationIngestion(() => markActiveRunLocallySavedInternal(options));
}

async function cancelActiveRunInternal(options = {}) {
  try {
    const activeRunId = activeSnapshot?.activeRunId || (await loadPersistedSnapshot())?.activeRunId || null;
    await stopBackgroundLocationUpdates({ reason: options.reason || "cancel" });
    await enqueueStorageWrite(async () => {
      await removeRouteChunksForRun(activeRunId);
      await storage.removeItem(ACTIVE_RUN_STORAGE_KEY);
      await storage.removeItem(ACTIVE_RUN_BACKUP_STORAGE_KEY);
      await storage.removeItem(ACTIVE_RUN_META_STORAGE_KEY);
    });
    activeSession = null;
    activeSnapshot = null;
    clearCheckpointTimer();
    checkpointDirty = false;
    acceptedPointsSinceCheckpoint = 0;
    rawPointsSinceCheckpoint = 0;
    activeSnapshotRevision = 0;
    lastPersistedRevision = 0;
    lastPersistedAt = null;
    lastPersistedAtMs = 0;
    flushPointOutcomeAggregate(null, "run_cancelled");
    setStorageHealth({
      status: "cleared",
      clearedAt: nowIso(),
      reason: options.reason || "cancel",
    });
    log("run_cancelled", { reason: options.reason || "cancel" });
    recordRunEvent("RUN_CANCELLED", {
      reason: options.reason || "cancel",
    });
    recordRunEvent("RUN_ACTIVE_CLEARED", {
      reason: options.reason || "cancel",
    });
    resetGpsShadowRun(activeRunId);
    emitSnapshot(null, "run_cancelled");
    return true;
  } catch (error) {
    emitError(error, { fn: "cancelActiveRun" });
    return false;
  }
}

export function cancelActiveRun(options = {}) {
  return enqueueLocationIngestion(() => cancelActiveRunInternal(options));
}

async function handleBackgroundLocations(data = {}) {
  const locations = (Array.isArray(data.locations) ? data.locations : [])
    .filter((loc) => loc?.coords)
    .slice()
    .sort((a, b) => {
      const left = Number(a?.timestamp);
      const right = Number(b?.timestamp);
      if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
      if (!Number.isFinite(left)) return 1;
      if (!Number.isFinite(right)) return -1;
      return left - right;
    });
  updateRuntimeState({
    backgroundTaskStatus: "handled",
  });
  recordRunEvent("RUN_BACKGROUND_TASK_HANDLED", {
    taskName: ACTIVE_RUN_LOCATION_TASK,
    locationsCount: locations.length,
    runId: activeSnapshot?.activeRunId || null,
  }, {
    category: LOG_CATEGORIES.BACKGROUND,
  });
  recordBackgroundTaskStatus("handled", {
    runId: activeSnapshot?.activeRunId || null,
    locationsCount: locations.length,
  });
  if (locations.length === 0) return activeSnapshot;
  const snapshot = activeSnapshot || (await loadPersistedSnapshot());
  if (!snapshot?.activeRunId) {
    recordRunEvent("RUN_BACKGROUND_TASK_NO_ACTIVE_SESSION", {
      taskName: ACTIVE_RUN_LOCATION_TASK,
      locationsCount: locations.length,
    }, {
      category: LOG_CATEGORIES.BACKGROUND,
    });
    return null;
  }
  for (const loc of locations) {
    lastRawPointReceivedAt = loc.timestamp || Date.now();
    await recordLocation({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: loc.coords.accuracy,
      speed: loc.coords.speed,
      heading: loc.coords.heading,
      altitude: loc.coords.altitude,
      altitudeAccuracy: loc.coords.altitudeAccuracy,
      timestamp: loc.timestamp,
      source: "background",
    }, { source: "background", deferCheckpoint: true });
  }
  return flushPendingActiveRunCheckpoint({
    reason: "background_batch",
    force: true,
  });
}

export async function handleActiveRunLocationTask({ data, error } = {}) {
  if (error) {
    updateRuntimeState({
      backgroundTaskStatus: "error",
    });
    setActiveRunError(error, "backgroundLocationTask");
    recordRunEvent("RUN_BACKGROUND_TASK_CANCELLED_OR_STOPPED", {
      taskName: ACTIVE_RUN_LOCATION_TASK,
      reason: "task_error",
      error,
    }, {
      category: LOG_CATEGORIES.BACKGROUND,
    });
    recordBackgroundTaskStatus("error", {
      reason: "task_error",
      error,
    });
    emitError(error, { fn: "backgroundLocationTask" });
    await flushPendingActiveRunCheckpoint({
      reason: "background_task_error",
      force: true,
    });
    return null;
  }
  return handleBackgroundLocations(data || {});
}

export function __setActiveRunStorageForTests(nextStorage) {
  storage = nextStorage || AsyncStorage;
}

export function __resetActiveRunRuntimeForTests() {
  clearCheckpointTimer();
  activeSession = null;
  activeSnapshot = null;
  backgroundStarted = false;
  writeQueue = Promise.resolve();
  locationIngestionQueue = Promise.resolve();
  pendingFlushCount = 0;
  lastPersistedAt = null;
  lastPersistedAtMs = 0;
  lastStorageError = null;
  lastRawPointReceivedAt = null;
  checkpointDirty = false;
  acceptedPointsSinceCheckpoint = 0;
  rawPointsSinceCheckpoint = 0;
  activeSnapshotRevision = 0;
  lastPersistedRevision = 0;
  pointOutcomeAggregate = {
    accepted: 0,
    rejected: 0,
    deduped: 0,
    reasons: {},
    sources: {},
    lastFlushedAtMs: 0,
  };
  routeChunkWriteState = {
    activeRunId: null,
    chunks: new Map(),
  };
  runtimeState = {
    foregroundWatcherStatus: "unknown",
    backgroundTaskStatus: "unknown",
    notificationStatus: "unknown",
    appState: null,
    screenFocusState: null,
    recoveryReason: null,
  };
  listeners.snapshot.clear();
  listeners.error.clear();
}

export default {
  ACTIVE_RUN_BACKUP_STORAGE_KEY,
  ACTIVE_RUN_CORRUPT_STORAGE_KEY,
  ACTIVE_RUN_LOCATION_TASK,
  ACTIVE_RUN_META_STORAGE_KEY,
  ACTIVE_RUN_ROUTE_CHUNK_INDEX_STORAGE_KEY,
  ACTIVE_RUN_ROUTE_CHUNK_KEY_PREFIX,
  ACTIVE_RUN_ROUTE_CHUNK_SIZE,
  ACTIVE_RUN_STATUS,
  buildFinishedRunData,
  cancelActiveRun,
  finishActiveRun,
  flushPendingActiveRunCheckpoint,
  getBackgroundLocationTaskStatus,
  getActiveRunSnapshot,
  getActiveRunStorageDiagnostics,
  getCurrentDurationSeconds,
  getTrackingRuntimeStatus,
  hasActiveRunSnapshot,
  hydrateActiveRunSnapshot,
  handleActiveRunLocationTask,
  markActiveRunFinishing,
  markActiveRunLocallySaved,
  onActiveRunError,
  onActiveRunSnapshot,
  pauseActiveRun,
  recordActiveRunFailure,
  recordLocation,
  restoreActiveRun,
  resumeActiveRun,
  setActiveRunDebug,
  setRunRuntimeSurfaceState,
  startActiveRun,
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
};
