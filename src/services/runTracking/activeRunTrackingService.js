import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
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
} from "./activeRunState.js";
import logger, { LOG_CATEGORIES } from "../../utils/logger.js";
import {
  recordLocationPointEvent,
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

const NOTIFICATION_BODY = "Sua corrida esta sendo salva mesmo com a tela bloqueada.";
const DEFAULT_NOTIFICATION_COLOR = "#00E676";
const LIVE_TRACKING_STATUSES = new Set([
  ACTIVE_RUN_STATUS.RUNNING,
  ACTIVE_RUN_STATUS.PAUSED,
  ACTIVE_RUN_STATUS.RECOVERING,
  ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
]);

let activeSession = null;
let activeSnapshot = null;
let backgroundStarted = false;
let storage = AsyncStorage;
let debugEnabled = typeof __DEV__ !== "undefined" && __DEV__;
let writeQueue = Promise.resolve();
let pendingFlushCount = 0;
let lastPersistedAt = null;
let lastStorageError = null;
let lastRawPointReceivedAt = null;
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

function isLiveStatus(status) {
  return LIVE_TRACKING_STATUSES.has(String(status || "").toUpperCase());
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
  } catch {}
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
  return (Array.isArray(snapshot.segments) ? snapshot.segments : [])
    .map((segment, index) => ({
      id: segment?.id || `segment_${Number.isFinite(Number(segment?.index)) ? Number(segment.index) : index}`,
      index: Number.isFinite(Number(segment?.index)) ? Number(segment.index) : index,
      startedAt: segment?.startedAt ?? segment?.startTimestamp ?? null,
      endedAt: segment?.endedAt ?? segment?.endTimestamp ?? null,
      startTimestamp: segment?.startTimestamp ?? segment?.startedAt ?? null,
      endTimestamp: segment?.endTimestamp ?? segment?.endedAt ?? null,
      reason: segment?.reason || null,
      endReason: segment?.endReason || null,
    }));
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
  const trustedPath = sanitizeChunkPath(snapshot.trustedPath || snapshot.path || []);
  const rawPath = sanitizeChunkPath(snapshot.rawPath || snapshot.rawPoints || trustedPath);
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
    const trustedChunk = trustedPath.slice(start, start + chunkSize);
    const rawChunk = rawPath.slice(start, start + chunkSize);
    const key = getRouteChunkStorageKey(activeRunId, index);
    const closed = index < totalChunks - 1 || trustedChunk.length >= chunkSize || rawChunk.length >= chunkSize;
    const descriptor = {
      index,
      key,
      trustedCount: trustedChunk.length,
      rawCount: rawChunk.length,
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
  for (const descriptor of routeChunksIndex.chunks) {
    if (!descriptor?.key) continue;
    try {
      const raw = await storage.getItem(descriptor.key);
      if (!raw) continue;
      const chunk = JSON.parse(raw);
      trustedPath.push(...sanitizeChunkPath(chunk.trustedPath || []));
      rawPath.push(...sanitizeChunkPath(chunk.rawPath || []));
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
    });
    return null;
  }
}

async function persistSnapshot(snapshot, event = "snapshot_saved") {
  const incoming = normalizeActiveRunSnapshot(snapshot);
  const shouldMerge =
    activeSnapshot?.activeRunId &&
    incoming?.activeRunId &&
    activeSnapshot.activeRunId === incoming.activeRunId &&
    event !== "run_started";
  const normalized = shouldMerge
    ? mergeActiveRunSnapshots(activeSnapshot, incoming)
    : incoming;
  activeSnapshot = normalized;
  await enqueueStorageWrite(async () => {
    try {
      const routeChunksIndex = await persistRouteChunksForSnapshot(normalized, event);
      const snapshotForStorage = {
        ...normalized,
        routeChunksIndex,
      };
      activeSnapshot = snapshotForStorage;
      const lightSnapshot = buildLightSnapshot(snapshotForStorage, routeChunksIndex);
      const json = JSON.stringify(lightSnapshot);
      recordRunSnapshotEvent("RUN_STORAGE_FLUSH_STARTED", normalized, {
        event,
        pendingFlushCount,
      });
      await storage.setItem(ACTIVE_RUN_BACKUP_STORAGE_KEY, json);
      await storage.setItem(ACTIVE_RUN_STORAGE_KEY, json);
      lastPersistedAt = nowIso();
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
    } catch (error) {
      lastStorageError = error;
      setStorageHealth({
        status: "write_failed",
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
      });
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
  log(event, {
    activeRunId: normalized.activeRunId,
    status: normalized.status,
    points: normalized.trustedPath?.length || 0,
    source: normalized.source,
  });
  recordRunSnapshotEvent("ACTIVE_RUN_SAVED", normalized, {
    event,
  });
  emitSnapshot(normalized, event);
  return normalized;
}

async function loadPersistedSnapshot() {
  try {
    await waitForPendingWrites();
    const current = await readSnapshotFromStorageKey(ACTIVE_RUN_STORAGE_KEY, "canonical_storage");
    if (current) {
      setStorageHealth({
        status: "ok",
        lastReadAt: nowIso(),
        source: "canonical_storage",
      });
      return current;
    }

    const backup = await readSnapshotFromStorageKey(ACTIVE_RUN_BACKUP_STORAGE_KEY, "backup");
    if (backup) {
      activeSnapshot = mergeActiveRunSnapshots(activeSnapshot, backup);
      setStorageHealth({
        status: "backup_used",
        lastReadAt: nowIso(),
        source: "backup",
      });
      recordRunSnapshotEvent("RUN_ACTIVE_SNAPSHOT_BACKUP_USED", backup, {
        source: "backup",
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
  return activeSnapshot || (await loadPersistedSnapshot());
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
    elapsedMs: Number(activeSnapshot?.durationMs || 0) || 0,
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
    return true;
  } catch (error) {
    backgroundStarted = false;
    updateRuntimeState({
      backgroundTaskStatus: "start_failed",
    });
    emitError(error, { fn: "startBackgroundLocationUpdates" });
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
    return true;
  } catch (error) {
    emitError(error, { fn: "stopBackgroundLocationUpdates", reason: options.reason || "manual" });
    return false;
  }
}

export async function startActiveRun(options = {}) {
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
    isLiveStatus(existing.status) &&
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

export async function restoreActiveRun(options = {}) {
  recordRunEvent("RECOVERY_STARTED", {
    source: options.snapshot ? "provided_snapshot" : "canonical_storage",
  });
  if (options.snapshot) {
    return hydrateActiveRunSnapshot(options.snapshot, {
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

  return hydrateActiveRunSnapshot({
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

export async function hydrateActiveRunSnapshot(snapshot = {}, options = {}) {
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
      isLiveStatus(existing.status) &&
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

    const reconciled = existing?.activeRunId === normalized.activeRunId
      ? mergeActiveRunSnapshots(existing, normalized, options)
      : normalized;

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

export async function recordLocation(location = {}, options = {}) {
  try {
    const session = await getActiveSession();
    if (!session || !activeSnapshot) return null;
    if (activeSnapshot.status !== ACTIVE_RUN_STATUS.RUNNING) return activeSnapshot;

    const source = options.source || location.source || "foreground";
    lastRawPointReceivedAt = location.timestamp || Date.now();
    recordLocationPointEvent("LOCATION_POINT_RECEIVED", location, {
      ...summarizeRunSnapshot(activeSnapshot, {
        watcherStatus: backgroundStarted ? "background_started" : "foreground",
      }),
      source,
    });
    const result = session.processLocationPoint({
      ...location,
      source: source === "background" ? "expo-location" : location.source || source,
    });
    const shadow = evaluateGpsShadowPoint(result.rawPoint || location, {
      runId: activeSnapshot.activeRunId,
      mode: activeSnapshot.mode || "run",
      startedAt: activeSnapshot.startedAtMs || activeSnapshot.startedAt,
      nowMs: Date.now(),
    });
    const filterMetrics = {
      distanceFromPreviousMeters: result.distanceFromPreviousMeters ?? result.point?.distanceFromPreviousMeters ?? null,
      elapsedFromPreviousMs: result.timeFromPreviousMs ?? result.point?.timeFromPreviousMs ?? null,
      calculatedSpeedMps: result.calculatedSpeedMps ?? result.point?.calculatedSpeedMps ?? null,
      accelerationMps2: result.accelerationMps2 ?? result.point?.accelerationMps2 ?? null,
      qualityScore: result.qualityScore ?? result.point?.qualityScore ?? null,
      acceptedByRelaxedFilter: shadow.acceptedByRelaxedFilter,
      relaxedRejectReason: shadow.relaxedRejectReason,
      relaxedAction: shadow.relaxedAction,
      relaxedAcceptedPoints: shadow.relaxedAcceptedPoints,
      runStatus: activeSnapshot.status,
    };

    if (!result.accepted && !result.currentPositionChanged && !result.pathChanged) {
      log("point_ignored", { reason: result.reason, source });
      recordLocationPointEvent("LOCATION_POINT_REJECTED", result.rawPoint || location, {
        ...summarizeRunSnapshot(activeSnapshot),
        reason: result.reason || "ignored",
        action: result.action || "ignore",
        source,
        ...filterMetrics,
      });
      recordRunEvent("RUN_POINT_REJECTED_SUMMARY", {
        runId: activeSnapshot.activeRunId,
        reason: result.reason || "ignored",
        source,
        rejectedPointsCount: activeSession?.getState?.()?.pathQuality?.rejectedPoints || null,
      }, {
        category: LOG_CATEGORIES.LOCATION,
      });
      return activeSnapshot;
    }

    if (result.accepted) {
      recordLocationPointEvent("LOCATION_POINT_ACCEPTED", result.point || location, {
        ...summarizeRunSnapshot(activeSnapshot),
        reason: result.reason || null,
        source,
        rawPointsCount: result.rawPath?.length || result.rawPoints?.length || 0,
        trustedPointsCount: result.trustedPath?.length || 0,
        segmentsCount: result.segments?.length || 0,
        distance: result.stats?.distanceMeters || 0,
        ...filterMetrics,
      });
      recordLocationPointEvent("RUN_POINT_ACCEPTED", result.point || location, {
        ...summarizeRunSnapshot(activeSnapshot),
        source,
        acceptedPointsCount: result.trustedPath?.length || 0,
        rejectedPointsCount: result.pathQuality?.rejectedPoints || 0,
        pendingFlushCount,
      });
      logRunGeometry("append point to segment", {
        activeRunId: activeSnapshot.activeRunId,
        segmentId: result.point?.segmentId ?? null,
        points: result.trustedPath?.length || 0,
        source,
      });
    }

    const snapshot = createSnapshotFromTrackingSession(session, activeSnapshot, {
      status: ACTIVE_RUN_STATUS.RUNNING,
      source,
      nowMs: Date.now(),
    });
    return await persistSnapshot(snapshot, source === "background" ? "background_point_saved" : "foreground_point_saved");
  } catch (error) {
    emitError(error, { fn: "recordLocation" });
    return activeSnapshot;
  }
}

export async function pauseActiveRun(options = {}) {
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

export async function resumeActiveRun(options = {}) {
  try {
    const session = await getActiveSession();
    if (!session || !activeSnapshot) return null;
    if (activeSnapshot.status === ACTIVE_RUN_STATUS.RUNNING) return activeSnapshot;
    if (activeSnapshot.status !== ACTIVE_RUN_STATUS.PAUSED) return activeSnapshot;
    const startedAt = Number(options.startedAtMs || Date.now());
    session.resume?.({ startedAt });
    const snapshot = createSnapshotFromTrackingSession(session, activeSnapshot, {
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

export async function finishActiveRun(options = {}) {
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
    recordRunSnapshotEvent("FINISH_SUCCESS", saved);
    return saved;
  } catch (error) {
    recordRunEvent("FINISH_FAILED", { error });
    emitError(error, { fn: "finishActiveRun" });
    return activeSnapshot;
  }
}

export async function buildFinishedRunData(overrides = {}) {
  const snapshot = activeSnapshot || (await loadPersistedSnapshot());
  if (!snapshot) return null;
  return buildRunDataFromActiveSnapshot(snapshot, overrides);
}

export async function markActiveRunLocallySaved() {
  try {
    const activeRunId = activeSnapshot?.activeRunId || (await loadPersistedSnapshot())?.activeRunId || null;
    await enqueueStorageWrite(async () => {
      await removeRouteChunksForRun(activeRunId);
      await storage.removeItem(ACTIVE_RUN_STORAGE_KEY);
      await storage.removeItem(ACTIVE_RUN_BACKUP_STORAGE_KEY);
      await storage.removeItem(ACTIVE_RUN_META_STORAGE_KEY);
    });
    activeSession = null;
    activeSnapshot = null;
    lastPersistedAt = null;
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

export async function cancelActiveRun(options = {}) {
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
    lastPersistedAt = null;
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
  if (locations.length === 0) return;
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
    }, { source: "background" });
  }
}

try {
  const defined =
    TaskManager &&
    typeof TaskManager.isTaskDefined === "function" &&
    TaskManager.isTaskDefined(ACTIVE_RUN_LOCATION_TASK);
  if (TaskManager && typeof TaskManager.defineTask === "function" && !defined) {
    TaskManager.defineTask(ACTIVE_RUN_LOCATION_TASK, async ({ data, error }) => {
      if (error) {
        updateRuntimeState({
          backgroundTaskStatus: "error",
        });
        recordRunEvent("RUN_BACKGROUND_TASK_CANCELLED_OR_STOPPED", {
          taskName: ACTIVE_RUN_LOCATION_TASK,
          reason: "task_error",
          error,
        }, {
          category: LOG_CATEGORIES.BACKGROUND,
        });
        emitError(error, { fn: "backgroundLocationTask" });
        return;
      }
      await handleBackgroundLocations(data || {});
    });
    updateRuntimeState({
      backgroundTaskStatus: "registered",
    });
    recordRunEvent("RUN_BACKGROUND_TASK_REGISTERED", {
      taskName: ACTIVE_RUN_LOCATION_TASK,
    }, {
      category: LOG_CATEGORIES.BACKGROUND,
    });
  }
} catch (error) {
  emitError(error, { fn: "defineBackgroundLocationTask" });
}

export function __setActiveRunStorageForTests(nextStorage) {
  storage = nextStorage || AsyncStorage;
}

export function __resetActiveRunRuntimeForTests() {
  activeSession = null;
  activeSnapshot = null;
  backgroundStarted = false;
  writeQueue = Promise.resolve();
  pendingFlushCount = 0;
  lastPersistedAt = null;
  lastStorageError = null;
  lastRawPointReceivedAt = null;
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
  getBackgroundLocationTaskStatus,
  getActiveRunSnapshot,
  getActiveRunStorageDiagnostics,
  getCurrentDurationSeconds,
  getTrackingRuntimeStatus,
  hasActiveRunSnapshot,
  hydrateActiveRunSnapshot,
  markActiveRunLocallySaved,
  onActiveRunError,
  onActiveRunSnapshot,
  pauseActiveRun,
  recordLocation,
  restoreActiveRun,
  resumeActiveRun,
  setActiveRunDebug,
  setRunRuntimeSurfaceState,
  startActiveRun,
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
};
