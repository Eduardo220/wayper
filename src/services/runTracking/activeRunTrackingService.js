import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";
import * as Location from "expo-location";
import { getRunBackgroundLocationOptions } from "./expoLocation.js";
import {
  ACTIVE_RUN_SCHEMA_VERSION,
  ACTIVE_RUN_STATUS,
  ACTIVE_RUN_STORAGE_KEY,
  buildRunDataFromActiveSnapshot,
  calculateActiveRunDurationSeconds,
  createRunId,
  createSnapshotFromTrackingSession,
  createTrackingSessionFromSnapshot,
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
export const ACTIVE_RUN_BACKGROUND_CALLER_TIMEOUT_MS = 5000;

const BACKGROUND_LIFECYCLE_STATE = Object.freeze({
  IDLE: "IDLE",
  STARTING: "STARTING",
  ACTIVE: "ACTIVE",
  STOPPING: "STOPPING",
  FAILED_RECOVERABLE: "FAILED_RECOVERABLE",
});

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
let backgroundOperationGeneration = 0;
let backgroundLifecycleOperationId = 0;
let backgroundLifecycleQueue = Promise.resolve();
let backgroundLifecycleActiveOperation = null;
let backgroundLifecyclePendingNativeOperation = null;
let backgroundLifecycleLastOperation = null;
let backgroundLifecycleLastLateOutcome = null;
let backgroundLifecycleState = BACKGROUND_LIFECYCLE_STATE.IDLE;
let backgroundLifecycleReconciliationRequired = false;
let backgroundLifecycleQueueReleased = true;
let backgroundNativeOwnerRunId = null;
let backgroundNativeOwnerAliases = [];
let backgroundNativeGeneration = 0;
let backgroundNativeActivatedAtMs = 0;
let backgroundStatusProbeOperationId = 0;
let backgroundStatusProbeInFlight = null;
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
let persistedCheckpointState = {
  activeRunId: null,
  trustedPointsCount: 0,
  rawPointsCount: 0,
  distanceMeters: 0,
};
let checkpointWorkCounters = {
  committedCheckpointWrites: 0,
  committedCheckpointFallbacks: 0,
  normalizedPersistCalls: 0,
  routeChunkWrites: 0,
  routeChunkPointsSanitized: 0,
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
  const trustedPath = Array.isArray(snapshot.trustedPath)
    ? snapshot.trustedPath
    : Array.isArray(snapshot.points)
      ? snapshot.points
      : [];
  const rawPath = Array.isArray(snapshot.rawPath)
    ? snapshot.rawPath
    : Array.isArray(snapshot.rawPoints)
      ? snapshot.rawPoints
      : trustedPath;
  const segments = Array.isArray(snapshot.segments)
    ? snapshot.segments
    : Array.isArray(snapshot.routeSegments)
      ? snapshot.routeSegments
      : [];
  return {
    distanceMeters: Number(snapshot.distanceMeters ?? snapshot.distance ?? 0) || 0,
    elapsedMs: calculateActiveRunDurationSeconds(snapshot) * 1000,
    trustedPointsCount: trustedPath.length,
    rawPointsCount: rawPath.length,
    routeSegmentsCount: segments.length,
    routeChunksCount: snapshot.routeChunksIndex?.chunks?.length || 0,
  };
}

function rememberPersistedCheckpoint(snapshot = {}) {
  const metrics = getSnapshotMetrics(snapshot);
  persistedCheckpointState = {
    activeRunId: snapshot.activeRunId || null,
    trustedPointsCount: metrics.trustedPointsCount,
    rawPointsCount: metrics.rawPointsCount,
    distanceMeters: metrics.distanceMeters,
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

function getBackgroundLifecycleDeadlineMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : ACTIVE_RUN_BACKGROUND_CALLER_TIMEOUT_MS;
}

function summarizeBackgroundLifecycleOperation(request, patch = {}) {
  if (!request) return null;
  return {
    operationId: request.operationId,
    type: request.type,
    ownerRunId: request.expectedRunId || null,
    generation: request.generation || null,
    reason: request.reason || null,
    outcome: request.outcome || null,
    timedOut: request.timedOut === true,
    ...patch,
  };
}

function setBackgroundLifecycleOutcome(request, outcome) {
  if (request) request.outcome = String(outcome || "unknown");
  return request?.outcome || "unknown";
}

function recordBackgroundLifecycleQueueReleased(request, result) {
  backgroundLifecycleQueueReleased = true;
  recordRunEvent("RUN_BACKGROUND_LIFECYCLE_QUEUE_RELEASED", {
    runId: request.expectedRunId,
    operation: request.type,
    operationId: request.operationId,
    reason: request.reason,
    generation: request.generation,
    outcome: request.outcome,
    result: Boolean(result),
  });
}

function finishBackgroundLifecycleOperation(request, result) {
  if (backgroundLifecycleActiveOperation?.operationId === request.operationId) {
    backgroundLifecycleActiveOperation = null;
  }
  if (result === true) {
    backgroundLifecycleReconciliationRequired = false;
    backgroundLifecycleState = request.type === "start"
      ? BACKGROUND_LIFECYCLE_STATE.ACTIVE
      : BACKGROUND_LIFECYCLE_STATE.IDLE;
  } else if (
    backgroundLifecycleReconciliationRequired ||
    [
      "operation_failed",
      "start_failed",
      "stop_failed",
      "status_probe_failed",
      "stale_start_cleanup_failed",
    ].includes(request.outcome)
  ) {
    backgroundLifecycleState = BACKGROUND_LIFECYCLE_STATE.FAILED_RECOVERABLE;
  } else if (backgroundStarted) {
    backgroundLifecycleState = BACKGROUND_LIFECYCLE_STATE.ACTIVE;
  } else if (request.outcome?.includes("mismatch")) {
    backgroundLifecycleState = BACKGROUND_LIFECYCLE_STATE.IDLE;
  } else {
    backgroundLifecycleState = BACKGROUND_LIFECYCLE_STATE.FAILED_RECOVERABLE;
  }
  backgroundLifecycleLastOperation = summarizeBackgroundLifecycleOperation(
    request,
    {
      result: Boolean(result),
      finishedAtMs: Date.now(),
    }
  );
  recordRunEvent("RUN_BACKGROUND_LIFECYCLE_OPERATION_COMPLETED", {
    runId: request.expectedRunId,
    operation: request.type,
    operationId: request.operationId,
    reason: request.reason,
    generation: request.generation,
    outcome: request.outcome,
    result: Boolean(result),
    state: backgroundLifecycleState,
  });
  recordBackgroundLifecycleQueueReleased(request, result);
  return Boolean(result);
}

function markBackgroundLifecycleTimeout(request, deadlineMs) {
  request.authoritative = false;
  request.timedOut = true;
  setBackgroundLifecycleOutcome(request, "timeout");
  if (backgroundLifecycleActiveOperation?.operationId === request.operationId) {
    backgroundLifecycleActiveOperation = null;
  }
  backgroundLifecyclePendingNativeOperation = request;
  backgroundLifecycleReconciliationRequired = true;
  backgroundLifecycleState = BACKGROUND_LIFECYCLE_STATE.FAILED_RECOVERABLE;
  backgroundLifecycleLastOperation = summarizeBackgroundLifecycleOperation(
    request,
    {
      result: false,
      timedOut: true,
      finishedAtMs: Date.now(),
    }
  );
  updateRuntimeState({
    backgroundTaskStatus: `${request.type}_pending_timeout`,
  });
  recordRunEvent("RUN_BACKGROUND_LIFECYCLE_OPERATION_TIMEOUT", {
    runId: request.expectedRunId,
    operation: request.type,
    operationId: request.operationId,
    reason: request.reason,
    generation: request.generation,
    timeoutMs: deadlineMs,
    reconciliationRequired: true,
    level: "warn",
  });
  recordBackgroundLifecycleQueueReleased(request, false);
}

function observeLateBackgroundLifecycleResult(request, status, value) {
  if (
    backgroundLifecyclePendingNativeOperation?.operationId ===
    request.operationId
  ) {
    backgroundLifecyclePendingNativeOperation = null;
  }
  backgroundLifecycleLastLateOutcome = summarizeBackgroundLifecycleOperation(
    request,
    {
      status,
      settledAtMs: Date.now(),
    }
  );
  recordRunEvent("RUN_BACKGROUND_LIFECYCLE_LATE_RESULT_DISCARDED", {
    runId: request.expectedRunId,
    operation: request.type,
    operationId: request.operationId,
    reason: request.reason,
    generation: request.generation,
    status,
    result: status === "resolved" ? Boolean(value) : false,
    error: status === "rejected"
      ? value?.message || String(value || "native_operation_failed")
      : null,
    reconciliationRequired: true,
    level: "warn",
  });
}

function executeBackgroundLifecycleOperation(request, task, timeoutMs) {
  request.generation = ++backgroundOperationGeneration;
  request.authoritative = true;
  request.startedAtMs = Date.now();
  backgroundLifecycleActiveOperation = request;
  backgroundLifecycleQueueReleased = false;
  backgroundLifecycleState = request.type === "start"
    ? BACKGROUND_LIFECYCLE_STATE.STARTING
    : BACKGROUND_LIFECYCLE_STATE.STOPPING;

  recordRunEvent("RUN_BACKGROUND_LIFECYCLE_OPERATION_STARTED", {
    runId: request.expectedRunId,
    operation: request.type,
    operationId: request.operationId,
    reason: request.reason,
    generation: request.generation,
    previousState: request.previousState,
    state: backgroundLifecycleState,
  });

  if (
    backgroundLifecyclePendingNativeOperation &&
    backgroundLifecyclePendingNativeOperation.operationId !==
      request.operationId
  ) {
    request.authoritative = false;
    setBackgroundLifecycleOutcome(request, "reconciliation_required");
    backgroundLifecycleReconciliationRequired = true;
    recordRunEvent("RUN_BACKGROUND_LIFECYCLE_RECONCILIATION_REQUIRED", {
      runId: request.expectedRunId,
      operation: request.type,
      operationId: request.operationId,
      generation: request.generation,
      pendingOperationId:
        backgroundLifecyclePendingNativeOperation.operationId,
      pendingGeneration:
        backgroundLifecyclePendingNativeOperation.generation,
      reason: "native_operation_unresolved",
      level: "warn",
    });
    return Promise.resolve(
      finishBackgroundLifecycleOperation(request, false)
    );
  }

  const deadlineMs = getBackgroundLifecycleDeadlineMs(timeoutMs);
  const taskPromise = Promise.resolve().then(() => task(request));

  return new Promise((resolve) => {
    let logicalSettled = false;
    const settle = (status, value) => {
      if (logicalSettled) {
        observeLateBackgroundLifecycleResult(request, status, value);
        return;
      }
      logicalSettled = true;
      clearTimeout(timeoutId);
      if (status === "rejected") {
        setBackgroundLifecycleOutcome(request, "operation_failed");
        recordRunEvent("RUN_BACKGROUND_LIFECYCLE_OPERATION_FAILED", {
          runId: request.expectedRunId,
          operation: request.type,
          operationId: request.operationId,
          reason: request.reason,
          generation: request.generation,
          error: value?.message || String(value || "native_operation_failed"),
          level: "warn",
        });
        resolve(finishBackgroundLifecycleOperation(request, false));
        return;
      }
      if (!request.outcome) {
        setBackgroundLifecycleOutcome(
          request,
          value === true ? `${request.type}_confirmed` : `${request.type}_failed`
        );
      }
      resolve(finishBackgroundLifecycleOperation(request, value === true));
    };
    const timeoutId = setTimeout(() => {
      if (logicalSettled) return;
      logicalSettled = true;
      markBackgroundLifecycleTimeout(request, deadlineMs);
      resolve(false);
    }, deadlineMs);

    taskPromise.then(
      (result) => settle("resolved", result),
      (error) => settle("rejected", error)
    );
  });
}

function enqueueBackgroundLifecycle(request, task, timeoutMs) {
  request.operationId = ++backgroundLifecycleOperationId;
  request.previousState = backgroundLifecycleState;
  recordRunEvent("RUN_BACKGROUND_LIFECYCLE_OPERATION_REQUESTED", {
    runId: request.expectedRunId,
    operation: request.type,
    operationId: request.operationId,
    reason: request.reason,
    previousState: request.previousState,
  });
  const runTask = () => executeBackgroundLifecycleOperation(
    request,
    task,
    timeoutMs
  );
  const operation = backgroundLifecycleQueue.then(runTask, runTask);
  backgroundLifecycleQueue = operation.then(
    () => true,
    () => true
  );
  return operation;
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

function setActiveRunBackgroundCapability(started, status = "unknown") {
  if (!activeSnapshot?.activeRunId) return null;
  activeSnapshot = {
    ...activeSnapshot,
    meta: {
      ...(activeSnapshot.meta || {}),
      backgroundTrackingStarted: Boolean(started),
      backgroundTrackingStatus: String(status || "unknown"),
    },
  };
  activeSnapshotRevision += 1;
  checkpointDirty = true;
  scheduleCheckpointTimer();
  if (
    activeSnapshot.status === ACTIVE_RUN_STATUS.RUNNING &&
    status !== "stopped"
  ) {
    emitSnapshot(activeSnapshot, "background_capability_changed");
  }
  return activeSnapshot;
}

function setActiveRunBackgroundPermission(granted, status = "unknown") {
  if (!activeSnapshot?.activeRunId || typeof granted !== "boolean") {
    return activeSnapshot;
  }
  activeSnapshot = {
    ...activeSnapshot,
    meta: {
      ...(activeSnapshot.meta || {}),
      permissions: {
        ...(activeSnapshot.meta?.permissions || {}),
        backgroundLocationGranted: granted,
        backgroundLocationStatus: String(status || "unknown"),
      },
    },
  };
  activeSnapshotRevision += 1;
  checkpointDirty = true;
  scheduleCheckpointTimer();
  return activeSnapshot;
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

  // Point ingestion keeps the already-filtered session arrays by reference.
  // Canonical lifecycle/recovery writes still normalize, while committed
  // checkpoints can persist these guarded arrays without copying the route.
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
    const trustedChunkSource = trustedPath.slice(start, start + chunkSize);
    const rawChunkSource = rawPath.slice(start, start + chunkSize);
    checkpointWorkCounters.routeChunkPointsSanitized +=
      trustedChunkSource.length + rawChunkSource.length;
    const trustedChunk = sanitizeChunkPath(trustedChunkSource);
    const rawChunk = sanitizeChunkPath(rawChunkSource);
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
      checkpointWorkCounters.routeChunkWrites += 1;
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
      throw error;
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
    throw error;
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
  const restoredDescriptors = [];
  const activeRunId = String(snapshot.activeRunId || "");
  const indexedActiveRunId = String(routeChunksIndex.activeRunId || "");
  const indexedChunkSize = Number(routeChunksIndex.chunkSize);
  let routeChunksComplete = Boolean(
    activeRunId &&
    indexedActiveRunId === activeRunId &&
    Number(routeChunksIndex.version) === 1 &&
    Number.isInteger(indexedChunkSize) &&
    indexedChunkSize === ACTIVE_RUN_ROUTE_CHUNK_SIZE
  );
  let trustedPointsBeforeDedupe = 0;
  let rawPointsBeforeDedupe = 0;
  for (const [position, descriptor] of routeChunksIndex.chunks.entries()) {
    const descriptorIndex = Number(descriptor?.index);
    const trustedCount = Number(descriptor?.trustedCount);
    const rawCount = Number(descriptor?.rawCount);
    const declaredKey = String(descriptor?.key || "");
    const key = getRouteChunkStorageKey(activeRunId, position);
    const expectedClosed = Boolean(
      position < routeChunksIndex.chunks.length - 1 ||
      trustedCount >= indexedChunkSize ||
      rawCount >= indexedChunkSize
    );
    const descriptorIsValid = Boolean(
      activeRunId &&
      Number.isInteger(descriptorIndex) &&
      descriptorIndex === position &&
      declaredKey === key &&
      Number.isInteger(trustedCount) &&
      trustedCount >= 0 &&
      trustedCount <= indexedChunkSize &&
      Number.isInteger(rawCount) &&
      rawCount >= 0 &&
      rawCount <= indexedChunkSize &&
      Boolean(descriptor.closed) === expectedClosed
    );
    if (!descriptorIsValid) {
      routeChunksComplete = false;
    }
    try {
      const raw = await storage.getItem(key);
      if (!raw) {
        routeChunksComplete = false;
        continue;
      }
      const chunk = JSON.parse(raw);
      const storedTrustedChunk = sanitizeChunkPath(chunk.trustedPath || []);
      const storedRawChunk = sanitizeChunkPath(chunk.rawPath || []);
      const chunkIdentityMatches = Boolean(
        String(chunk.activeRunId || "") === activeRunId &&
        Number(chunk.index) === position
      );
      if (!chunkIdentityMatches) {
        routeChunksComplete = false;
        continue;
      }
      const trustedChunk = Number.isInteger(trustedCount) && trustedCount >= 0
        ? storedTrustedChunk.slice(0, trustedCount)
        : storedTrustedChunk;
      const rawChunk = Number.isInteger(rawCount) && rawCount >= 0
        ? storedRawChunk.slice(0, rawCount)
        : storedRawChunk;
      if (
        Number(chunk.version) !== 1 ||
        Number(chunk.chunkSize) !== indexedChunkSize ||
        !Array.isArray(chunk.trustedPath) ||
        !Array.isArray(chunk.rawPath) ||
        storedTrustedChunk.length !== trustedCount ||
        storedRawChunk.length !== rawCount
      ) {
        routeChunksComplete = false;
      }
      trustedPointsBeforeDedupe += trustedChunk.length;
      rawPointsBeforeDedupe += rawChunk.length;
      trustedPath.push(...trustedChunk);
      rawPath.push(...rawChunk);
      restoredDescriptors.push({
        index: position,
        key,
        trustedCount,
        rawCount,
        closed: Boolean(descriptor.closed),
      });
    } catch (error) {
      routeChunksComplete = false;
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
  const indexedTrustedPoints = Number(routeChunksIndex.totalTrustedPoints);
  const indexedRawPoints = Number(routeChunksIndex.totalRawPoints);
  const envelopeTrustedPoints = Number(
    snapshot.acceptedPointsCount ?? snapshot.pointsCount
  );
  const envelopeRawPoints = Number(
    snapshot.rawPointsCount ?? snapshot.pointsCount
  );
  routeChunksComplete = Boolean(
    routeChunksComplete &&
    restoredDescriptors.length === routeChunksIndex.chunks.length &&
    Number.isInteger(indexedTrustedPoints) &&
    indexedTrustedPoints === trustedPointsBeforeDedupe &&
    Number.isInteger(indexedRawPoints) &&
    indexedRawPoints === rawPointsBeforeDedupe &&
    Number.isInteger(envelopeTrustedPoints) &&
    envelopeTrustedPoints === indexedTrustedPoints &&
    Number.isInteger(envelopeRawPoints) &&
    envelopeRawPoints === indexedRawPoints &&
    restored.trustedPath.length === trustedPointsBeforeDedupe &&
    restored.rawPath.length === rawPointsBeforeDedupe
  );
  routeChunkWriteState = routeChunksComplete
    ? {
        activeRunId,
        chunks: new Map(
          restoredDescriptors.map((descriptor) => [descriptor.key, descriptor])
        ),
      }
    : {
        activeRunId,
        chunks: new Map(),
      };
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
    writeStateRestored: routeChunksComplete,
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

async function hydrateParsedSnapshot(parsed, source) {
  if (!parsed) return null;
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

async function readSnapshotEnvelopeFromStorageKey(key, source) {
  let raw = null;
  try {
    raw = await storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid active run snapshot envelope");
    }
    const identifiers = [parsed.activeRunId, parsed.runId, parsed.id]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (
      identifiers.length === 0 ||
      identifiers.some((value) => value !== identifiers[0])
    ) {
      throw new Error("active run snapshot envelope has invalid identity");
    }
    return parsed;
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

function getStoredSnapshotObservedAtMs(snapshot = {}) {
  return Math.max(
    toOptionalTimestampMs(
      snapshot.lastUpdatedAtMs ?? snapshot.lastUpdatedAt ?? snapshot.updatedAt
    ) || 0,
    toOptionalTimestampMs(snapshot.routeChunksIndex?.updatedAt) || 0,
    toOptionalTimestampMs(
      snapshot.finishedAtMs ?? snapshot.finishedAt ?? snapshot.endedAt
    ) || 0,
    toOptionalTimestampMs(snapshot.pausedAtMs ?? snapshot.pausedAt) || 0,
    toOptionalTimestampMs(snapshot.currentLocation?.timestamp) || 0,
    toOptionalTimestampMs(snapshot.lastValidPoint?.timestamp) || 0
  );
}

function getStoredSnapshotRunId(snapshot = {}) {
  return String(
    snapshot.activeRunId || snapshot.runId || snapshot.id || ""
  );
}

function shouldPreferBackupSnapshot(current = {}, backup = {}) {
  const currentRunId = getStoredSnapshotRunId(current);
  const backupRunId = getStoredSnapshotRunId(backup);
  if (!currentRunId || currentRunId !== backupRunId) return false;

  const currentIsTerminal = [
    ACTIVE_RUN_STATUS.FINISHING,
    ACTIVE_RUN_STATUS.FINISHED,
  ].includes(current.status);
  const backupIsTerminal = [
    ACTIVE_RUN_STATUS.FINISHING,
    ACTIVE_RUN_STATUS.FINISHED,
  ].includes(backup.status);
  if (backupIsTerminal !== currentIsTerminal) return backupIsTerminal;

  const currentObservedAtMs = getStoredSnapshotObservedAtMs(current);
  const backupObservedAtMs = getStoredSnapshotObservedAtMs(backup);
  if (backupObservedAtMs !== currentObservedAtMs) {
    return backupObservedAtMs > currentObservedAtMs;
  }

  return JSON.stringify(backup) !== JSON.stringify(current);
}

async function writeSnapshotToStorage(snapshot, event, writeRevision) {
  let snapshotForStorage = snapshot;
  await enqueueStorageWrite(async () => {
    try {
      const routeChunksIndex = await persistRouteChunksForSnapshot(snapshot, event);
      snapshotForStorage = {
        ...snapshot,
        routeChunksIndex,
      };
      if (writeRevision >= activeSnapshotRevision) {
        activeSnapshot = snapshotForStorage;
      }
      const lightSnapshot = buildLightSnapshot(snapshotForStorage, routeChunksIndex);
      const json = JSON.stringify(lightSnapshot);
      recordRunSnapshotEvent("RUN_STORAGE_FLUSH_STARTED", snapshot, {
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
        activeRunId: snapshot.activeRunId,
        status: snapshot.status,
        lastPersistedAt,
        lastUpdatedAt: snapshot.lastUpdatedAt || null,
        acceptedPointsCount: snapshot.trustedPath?.length || 0,
        rawPointsCount: snapshot.rawPath?.length || 0,
        routeSegmentsCount: snapshot.segments?.length || 0,
        routeChunksCount: routeChunksIndex?.chunks?.length || 0,
        routeChunksIndexKey: snapshot.activeRunId
          ? getRouteChunkIndexStorageKey(snapshot.activeRunId)
          : null,
      }));
      rememberPersistedCheckpoint(snapshotForStorage);
      setStorageHealth({
        status: "ok",
        lastPersistedAt,
        lastError: null,
        currentKey: ACTIVE_RUN_STORAGE_KEY,
        backupKey: ACTIVE_RUN_BACKUP_STORAGE_KEY,
      });
      recordRunSnapshotEvent("RUN_ACTIVE_SNAPSHOT_WRITE", snapshot, {
        event,
        storageKey: ACTIVE_RUN_STORAGE_KEY,
        backupKey: ACTIVE_RUN_BACKUP_STORAGE_KEY,
      });
      recordRunSnapshotEvent("RUN_SNAPSHOT_LIGHT_WRITE", snapshot, {
        event,
        storageKey: ACTIVE_RUN_STORAGE_KEY,
        bytes: json.length,
        routeChunksCount: routeChunksIndex?.chunks?.length || 0,
      });
      recordRunSnapshotEvent("RUN_STORAGE_FLUSH_SUCCESS", snapshot, {
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
      recordRunSnapshotEvent("RUN_ACTIVE_SNAPSHOT_WRITE_FAILED", snapshot, {
        event,
        error,
      });
      recordRunSnapshotEvent("RUN_STORAGE_FLUSH_FAILED", snapshot, {
        event,
        error,
      });
      recordRunSnapshotEvent("ACTIVE_RUN_SAVE_FAILED", snapshot, {
        event,
        error,
        storageFull,
      });
      scheduleCheckpointTimer();
      throw error;
    }
  });
  return snapshotForStorage;
}

async function persistSnapshot(snapshot, event = "snapshot_saved", options = {}) {
  checkpointWorkCounters.normalizedPersistCalls += 1;
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
  await writeSnapshotToStorage(normalized, event, writeRevision);
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

function isCommittedCheckpointEligible(snapshot, revision) {
  if (!snapshot || snapshot !== activeSnapshot || !activeSession) return false;
  if (Number(revision) !== activeSnapshotRevision) return false;
  if (snapshot.status !== ACTIVE_RUN_STATUS.RUNNING) return false;
  const activeRunId = String(snapshot.activeRunId || "").trim();
  if (!activeRunId) return false;
  if (
    String(snapshot.runId || "") !== activeRunId ||
    String(snapshot.id || "") !== activeRunId
  ) {
    return false;
  }
  const version = Math.max(
    Number(snapshot.version || 0),
    Number(snapshot.schemaVersion || 0),
    Number(snapshot.formatVersion || 0)
  );
  if (version < ACTIVE_RUN_SCHEMA_VERSION) return false;
  if (
    !Array.isArray(snapshot.trustedPath) ||
    !Array.isArray(snapshot.rawPath) ||
    !Array.isArray(snapshot.segments) ||
    snapshot.points !== snapshot.trustedPath ||
    snapshot.path !== snapshot.trustedPath ||
    snapshot.filteredPoints !== snapshot.trustedPath ||
    snapshot.rawPoints !== snapshot.rawPath ||
    snapshot.routeSegments !== snapshot.segments
  ) {
    return false;
  }
  if (
    persistedCheckpointState.activeRunId &&
    persistedCheckpointState.activeRunId !== activeRunId
  ) {
    return false;
  }
  const distanceMeters = Number(
    snapshot.distanceMeters ?? snapshot.distance ?? 0
  ) || 0;
  return Boolean(
    snapshot.trustedPath.length >= persistedCheckpointState.trustedPointsCount &&
    snapshot.rawPath.length >= persistedCheckpointState.rawPointsCount &&
    distanceMeters >= persistedCheckpointState.distanceMeters
  );
}

function buildCommittedCheckpointSnapshot(snapshot, nowMs = Date.now()) {
  const durationSeconds = calculateActiveRunDurationSeconds(snapshot, {
    nowMs,
  });
  const distanceMeters = Number(
    snapshot.distanceMeters ?? snapshot.distance ?? 0
  ) || 0;
  const paceSecondsPerKm = distanceMeters > 0
    ? durationSeconds / (distanceMeters / 1000)
    : 0;
  return {
    ...snapshot,
    duration: durationSeconds,
    durationSeconds,
    durationMs: durationSeconds * 1000,
    pace: paceSecondsPerKm,
    paceSecondsPerKm,
  };
}

async function persistCommittedCheckpoint(snapshot, event, options = {}) {
  const writeRevision = Number(options.revision || activeSnapshotRevision);
  const stateObservedAtMs = Number(
    options.nowMs ??
    snapshot.lastUpdatedAtMs ??
    Date.now()
  ) || Date.now();
  const checkpointSnapshot = buildCommittedCheckpointSnapshot(
    snapshot,
    stateObservedAtMs
  );
  const stored = await writeSnapshotToStorage(
    checkpointSnapshot,
    event,
    writeRevision
  );
  checkpointWorkCounters.committedCheckpointWrites += 1;
  recordRunSnapshotEvent("RUN_CHECKPOINT_COMMITTED_FAST_PATH", stored, {
    event,
    revision: writeRevision,
    acceptedPointsCount: checkpointSnapshot.trustedPath.length,
    rawPointsCount: checkpointSnapshot.rawPath.length,
  }, {
    category: LOG_CATEGORIES.STORAGE,
  });
  return writeRevision >= activeSnapshotRevision
    ? (activeSnapshot || stored)
    : stored;
}

async function loadPersistedSnapshot() {
  try {
    await waitForPendingWrites();
    const currentEnvelope = await readSnapshotEnvelopeFromStorageKey(
      ACTIVE_RUN_STORAGE_KEY,
      "canonical_storage"
    );
    const backupEnvelope = await readSnapshotEnvelopeFromStorageKey(
      ACTIVE_RUN_BACKUP_STORAGE_KEY,
      "backup"
    );
    const backupSelected = Boolean(
      backupEnvelope &&
      (!currentEnvelope ||
        shouldPreferBackupSnapshot(currentEnvelope, backupEnvelope))
    );
    const preferredCandidate = backupSelected
      ? { envelope: backupEnvelope, source: "backup" }
      : { envelope: currentEnvelope, source: "canonical_storage" };
    const alternateCandidate = backupSelected
      ? { envelope: currentEnvelope, source: "canonical_storage" }
      : { envelope: backupEnvelope, source: "backup" };
    const candidates = [preferredCandidate];
    if (
      alternateCandidate.envelope &&
      getStoredSnapshotRunId(alternateCandidate.envelope) ===
        getStoredSnapshotRunId(preferredCandidate.envelope)
    ) {
      candidates.push(alternateCandidate);
    }

    let selected = null;
    let selectedEnvelope = null;
    let selectedSource = null;
    for (const candidate of candidates) {
      if (!candidate.envelope) continue;
      try {
        const hydrated = await hydrateParsedSnapshot(
          candidate.envelope,
          candidate.source
        );
        if (hydrated?.activeRunId) {
          selected = hydrated;
          selectedEnvelope = candidate.envelope;
          selectedSource = candidate.source;
          break;
        }
      } catch (error) {
        lastStorageError = error;
        recordRunEvent("RUN_REHYDRATE_FAILED", {
          source: candidate.source,
          error,
          level: "error",
        });
      }
    }

    if (selected && selectedEnvelope && selectedSource) {
      const selectedBackup = selectedSource === "backup";
      rememberPersistedCheckpoint(selected);
      lastPersistedAt =
        selected?.lastUpdatedAt || selected?.updatedAt || lastPersistedAt;
      lastPersistedAtMs = getStoredSnapshotObservedAtMs(selectedEnvelope);
      setStorageHealth({
        status: selectedBackup ? "backup_used" : "ok",
        lastReadAt: nowIso(),
        source: selectedSource,
      });
      if (selectedBackup) {
        recordRunSnapshotEvent("RUN_ACTIVE_SNAPSHOT_BACKUP_USED", selected, {
          source: "backup",
          reason: !currentEnvelope
            ? "current_unavailable"
            : backupSelected
              ? "newer_than_current"
              : "preferred_current_hydration_failed",
        });
      }
      recordRunSnapshotEvent("RUN_STATE_SOURCE_SELECTED", selected, {
        reason: "load_persisted_snapshot",
        selectedSource,
      });
      return selected;
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
    const useCommittedFastPath =
      options.committedFastPath !== false &&
      isCommittedCheckpointEligible(snapshot, revision);
    if (!useCommittedFastPath) {
      checkpointWorkCounters.committedCheckpointFallbacks += 1;
    }
    const saved = useCommittedFastPath
      ? await persistCommittedCheckpoint(snapshot, "run_checkpoint_saved", {
          revision,
        })
      : await persistSnapshot(snapshot, "run_checkpoint_saved", {
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
    backgroundLifecycle: {
      state: backgroundLifecycleState,
      generation: backgroundOperationGeneration,
      nativeGeneration: backgroundNativeGeneration,
      ownerRunId: backgroundNativeOwnerRunId,
      ownerAliases: [...backgroundNativeOwnerAliases],
      activeOperation: summarizeBackgroundLifecycleOperation(
        backgroundLifecycleActiveOperation
      ),
      pendingNativeOperation: summarizeBackgroundLifecycleOperation(
        backgroundLifecyclePendingNativeOperation
      ),
      lastOperation: backgroundLifecycleLastOperation
        ? { ...backgroundLifecycleLastOperation }
        : null,
      lastLateOutcome: backgroundLifecycleLastLateOutcome
        ? { ...backgroundLifecycleLastLateOutcome }
        : null,
      reconciliationRequired:
        backgroundLifecycleReconciliationRequired,
      logicalQueueReleased: backgroundLifecycleQueueReleased,
      activatedAtMs: backgroundNativeActivatedAtMs || null,
      statusProbe: backgroundStatusProbeInFlight
        ? {
            operationId: backgroundStatusProbeInFlight.operationId,
            generation: backgroundStatusProbeInFlight.generation,
            lifecycleOperationId:
              backgroundStatusProbeInFlight.lifecycleOperationId,
            timedOut: backgroundStatusProbeInFlight.timedOut === true,
          }
        : null,
    },
    taskName: ACTIVE_RUN_LOCATION_TASK,
  };
}

export function setRunRuntimeSurfaceState(patch = {}) {
  return updateRuntimeState(patch);
}

function releaseBackgroundStatusProbe(probe) {
  if (
    backgroundStatusProbeInFlight?.operationId === probe.operationId
  ) {
    backgroundStatusProbeInFlight = null;
  }
}

async function runBackgroundLocationTaskStatusProbe(probe, deadlineMs) {
  try {
    const nativeProbe = Promise.resolve().then(() =>
      Location.hasStartedLocationUpdatesAsync(ACTIVE_RUN_LOCATION_TASK)
    );
    probe.nativePromise = nativeProbe;
    const started = await new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        probe.timedOut = true;
        resolve(null);
      }, deadlineMs);
      nativeProbe.then(
        (value) => {
          releaseBackgroundStatusProbe(probe);
          if (settled) {
            recordRunEvent("RUN_BACKGROUND_STATUS_PROBE_LATE_RESULT_DISCARDED", {
              operationId: probe.operationId,
              generation: probe.generation,
              currentGeneration: backgroundOperationGeneration,
              result: Boolean(value),
              level: "warn",
            });
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          resolve(Boolean(value));
        },
        (error) => {
          releaseBackgroundStatusProbe(probe);
          if (settled) {
            recordRunEvent("RUN_BACKGROUND_STATUS_PROBE_LATE_RESULT_DISCARDED", {
              operationId: probe.operationId,
              generation: probe.generation,
              currentGeneration: backgroundOperationGeneration,
              error: error?.message || String(error || "probe_failed"),
              level: "warn",
            });
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      );
    });
    if (
      probe.authoritative === false ||
      probe.generation !== backgroundOperationGeneration ||
      probe.lifecycleOperationId != null ||
      backgroundLifecycleActiveOperation != null
    ) {
      recordRunEvent("RUN_BACKGROUND_STATUS_PROBE_STALE_RESULT_DISCARDED", {
        operationId: probe.operationId,
        generation: probe.generation,
        currentGeneration: backgroundOperationGeneration,
        lifecycleOperationId: probe.lifecycleOperationId,
        currentLifecycleOperationId:
          backgroundLifecycleActiveOperation?.operationId || null,
        result: started == null ? null : Boolean(started),
        timedOut: started == null,
        level: "warn",
      });
      return {
        taskName: ACTIVE_RUN_LOCATION_TASK,
        started: backgroundStarted,
        status: "probe_stale",
        checkedAt: nowIso(),
      };
    }
    if (started == null) {
      backgroundLifecycleReconciliationRequired = true;
      backgroundLifecycleState = BACKGROUND_LIFECYCLE_STATE.FAILED_RECOVERABLE;
      recordRunEvent("RUN_BACKGROUND_STATUS_PROBE_TIMEOUT", {
        operationId: probe.operationId,
        generation: probe.generation,
        timeoutMs: deadlineMs,
        level: "warn",
      });
      return {
        taskName: ACTIVE_RUN_LOCATION_TASK,
        started: backgroundStarted,
        status: "probe_timeout",
        checkedAt: nowIso(),
      };
    }
    backgroundStarted = Boolean(started);
    const nativeOwnerMatchesActiveTarget =
      backgroundNativeOwnerMatchesTarget(activeSnapshot);
    const nativeIdentityIsConsistent = started
      ? Boolean(backgroundNativeOwnerRunId) &&
        nativeOwnerMatchesActiveTarget &&
        backgroundLifecycleState === BACKGROUND_LIFECYCLE_STATE.ACTIVE
      : !backgroundNativeOwnerRunId &&
        backgroundLifecycleState === BACKGROUND_LIFECYCLE_STATE.IDLE;
    if (!nativeIdentityIsConsistent) {
      const previousState = backgroundLifecycleState;
      backgroundLifecycleReconciliationRequired = true;
      backgroundLifecycleState = BACKGROUND_LIFECYCLE_STATE.FAILED_RECOVERABLE;
      const mismatchStatus = started
        ? "started_reconciliation_required"
        : "stopped_reconciliation_required";
      updateRuntimeState({
        backgroundTaskStatus: mismatchStatus,
      });
      recordRunEvent("RUN_BACKGROUND_STATUS_PROBE_IDENTITY_MISMATCH", {
        operationId: probe.operationId,
        generation: probe.generation,
        started: Boolean(started),
        ownerRunId: backgroundNativeOwnerRunId,
        previousState,
        state: backgroundLifecycleState,
        status: mismatchStatus,
        level: "warn",
      });
      return {
        taskName: ACTIVE_RUN_LOCATION_TASK,
        started: Boolean(started),
        status: mismatchStatus,
        checkedAt: nowIso(),
      };
    }
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

export function getBackgroundLocationTaskStatus(options = {}) {
  if (Platform.OS === "web") {
    return Promise.resolve({
      taskName: ACTIVE_RUN_LOCATION_TASK,
      started: false,
      status: "unsupported",
      checkedAt: nowIso(),
    });
  }
  if (backgroundStatusProbeInFlight) {
    recordRunEvent("RUN_BACKGROUND_STATUS_PROBE_COALESCED", {
      operationId: backgroundStatusProbeInFlight.operationId,
      generation: backgroundStatusProbeInFlight.generation,
      timedOut: backgroundStatusProbeInFlight.timedOut === true,
    });
    return backgroundStatusProbeInFlight.resultPromise;
  }
  const probe = {
    operationId: ++backgroundStatusProbeOperationId,
    generation: backgroundOperationGeneration,
    lifecycleOperationId:
      backgroundLifecycleActiveOperation?.operationId || null,
    startedAtMs: Date.now(),
    timedOut: false,
    authoritative: true,
    nativePromise: null,
    resultPromise: null,
  };
  const deadlineMs = getBackgroundLifecycleDeadlineMs(options.timeoutMs);
  probe.resultPromise = runBackgroundLocationTaskStatusProbe(
    probe,
    deadlineMs
  );
  backgroundStatusProbeInFlight = probe;
  return probe.resultPromise;
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

function normalizeBackgroundRunId(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

const BACKGROUND_OWNER_ID_KEYS = [
  "activeRunId",
  "localRunId",
  "runId",
  "id",
  "legacyId",
];

function collectBackgroundOwnerAliases(source = {}) {
  const aliases = new Set();
  for (const key of BACKGROUND_OWNER_ID_KEYS) {
    const value = normalizeBackgroundRunId(source?.[key]);
    if (value) aliases.add(value);
  }
  const expectedRunId = normalizeBackgroundRunId(source?.expectedRunId);
  if (expectedRunId) aliases.add(expectedRunId);
  for (const value of source?.ownerAliases || []) {
    const alias = normalizeBackgroundRunId(value);
    if (alias) aliases.add(alias);
  }
  return [...aliases];
}

function backgroundOwnerAliasesIntersect(left = [], right = []) {
  if (!left.length || !right.length) return false;
  const rightAliases = new Set(right);
  return left.some((alias) => rightAliases.has(alias));
}

function createBackgroundOwnerIdentity(options = {}, snapshot = activeSnapshot) {
  const requestedAliases = collectBackgroundOwnerAliases(options);
  const snapshotAliases = collectBackgroundOwnerAliases(snapshot || {});
  const matchesSnapshot = requestedAliases.length === 0 ||
    backgroundOwnerAliasesIntersect(requestedAliases, snapshotAliases);
  const aliases = new Set(requestedAliases);
  if (matchesSnapshot) {
    for (const alias of snapshotAliases) aliases.add(alias);
  }
  const primaryRunId = matchesSnapshot
    ? normalizeBackgroundRunId(
        snapshot?.activeRunId ||
        snapshot?.localRunId ||
        snapshot?.runId ||
        snapshot?.id
      ) || requestedAliases[0] || null
    : requestedAliases[0] || null;
  if (primaryRunId) aliases.add(primaryRunId);
  return {
    primaryRunId,
    aliases: [...aliases],
  };
}

function requestMatchesBackgroundNativeOwner(request) {
  if (!backgroundNativeOwnerRunId) return false;
  return backgroundOwnerAliasesIntersect(
    request.ownerAliases || [request.expectedRunId].filter(Boolean),
    backgroundNativeOwnerAliases.length > 0
      ? backgroundNativeOwnerAliases
      : [backgroundNativeOwnerRunId]
  );
}

function backgroundNativeOwnerMatchesTarget(snapshot = activeSnapshot) {
  if (!backgroundNativeOwnerRunId) return false;
  const targetAliases = collectBackgroundOwnerAliases(snapshot || {});
  const nativeOwnerAliases = backgroundNativeOwnerAliases.length > 0
    ? backgroundNativeOwnerAliases
    : [backgroundNativeOwnerRunId];
  return Boolean(
    targetAliases.length > 0 &&
    backgroundOwnerAliasesIntersect(nativeOwnerAliases, targetAliases)
  );
}

function requestMatchesCurrentBackgroundTarget(
  request,
  snapshot = activeSnapshot
) {
  const requestAliases = request?.ownerAliases || [
    request?.expectedRunId,
  ].filter(Boolean);
  const currentAliases = collectBackgroundOwnerAliases(snapshot || {});
  if (requestAliases.length === 0 || currentAliases.length === 0) return true;
  return backgroundOwnerAliasesIntersect(requestAliases, currentAliases);
}

function requestCanReleaseConfirmedNativeOwner(request) {
  const ownsPendingTimedOutBoundary = Boolean(
    request?.timedOut === true &&
    backgroundLifecyclePendingNativeOperation?.operationId ===
      request.operationId
  );
  return Boolean(
    requestMatchesBackgroundNativeOwner(request) &&
    backgroundNativeGeneration <= request.generation &&
    (isBackgroundRequestCurrent(request) || ownsPendingTimedOutBoundary)
  );
}

function requireBackgroundLifecycleReconciliation(
  request,
  outcome,
  reason
) {
  setBackgroundLifecycleOutcome(request, outcome);
  backgroundLifecycleReconciliationRequired = true;
  backgroundLifecycleState = BACKGROUND_LIFECYCLE_STATE.FAILED_RECOVERABLE;
  recordRunEvent("RUN_BACKGROUND_LIFECYCLE_RECONCILIATION_REQUIRED", {
    runId: request.expectedRunId,
    operation: request.type,
    operationId: request.operationId,
    generation: request.generation,
    ownerRunId: backgroundNativeOwnerRunId,
    reason,
    outcome,
    level: "warn",
  });
}

function recordBackgroundOwnerMismatch(request, reason = "owner_mismatch") {
  if (!backgroundNativeOwnerMatchesTarget(activeSnapshot)) {
    requireBackgroundLifecycleReconciliation(
      request,
      "owner_target_mismatch",
      "native_owner_does_not_match_active_target"
    );
  } else {
    setBackgroundLifecycleOutcome(request, "owner_mismatch");
  }
  recordRunEvent("RUN_BACKGROUND_LIFECYCLE_OWNER_MISMATCH", {
    runId: request.expectedRunId,
    operation: request.type,
    operationId: request.operationId,
    generation: request.generation,
    ownerRunId: backgroundNativeOwnerRunId,
    reason,
    level: "warn",
  });
  if (request.handoffRequested) {
    recordRunEvent("RUN_BACKGROUND_LIFECYCLE_HANDOFF_REJECTED", {
      runId: request.expectedRunId,
      operation: request.type,
      operationId: request.operationId,
      generation: request.generation,
      ownerRunId: backgroundNativeOwnerRunId,
      reason: "active_handoff_prohibited",
      level: "warn",
    });
  }
}

function claimBackgroundNativeOwner(request, reason, options = {}) {
  const previousOwnerRunId = backgroundNativeOwnerRunId;
  backgroundNativeOwnerRunId = request.expectedRunId;
  backgroundNativeOwnerAliases = [
    ...new Set(
      (request.ownerAliases || [request.expectedRunId])
        .map(normalizeBackgroundRunId)
        .filter(Boolean)
    ),
  ];
  backgroundNativeGeneration = request.generation;
  backgroundNativeActivatedAtMs = Number.isFinite(
    Number(options.activatedAtMs)
  )
    ? Math.max(0, Number(options.activatedAtMs))
    : Date.now();
  recordRunEvent("RUN_BACKGROUND_LIFECYCLE_OWNER_CLAIMED", {
    runId: request.expectedRunId,
    operationId: request.operationId,
    generation: request.generation,
    previousOwnerRunId,
    ownerRunId: backgroundNativeOwnerRunId,
    reason,
  });
}

function canExplicitlyClaimExistingBackgroundOwner(
  request,
  options,
  snapshot
) {
  const claim = options?.ownerClaim;
  const reason = String(claim?.reason || "").trim();
  return Boolean(
    claim?.mode === "process_recovery" &&
    reason &&
    isBackgroundRequestCurrent(request) &&
    request.expectedRunId &&
    normalizeBackgroundRunId(snapshot?.activeRunId) === request.expectedRunId &&
    String(snapshot?.status || "").toUpperCase() === ACTIVE_RUN_STATUS.RUNNING
  );
}

function releaseBackgroundNativeOwner(request, reason) {
  const previousOwnerRunId = backgroundNativeOwnerRunId;
  backgroundNativeOwnerRunId = null;
  backgroundNativeOwnerAliases = [];
  backgroundNativeGeneration = request.generation;
  backgroundNativeActivatedAtMs = 0;
  recordRunEvent("RUN_BACKGROUND_LIFECYCLE_OWNER_RELEASED", {
    runId: request.expectedRunId,
    operationId: request.operationId,
    generation: request.generation,
    previousOwnerRunId,
    reason,
  });
}

function matchesExpectedActiveRunId(options = {}, snapshot = activeSnapshot) {
  const expectedAliases = collectBackgroundOwnerAliases(options);
  const currentAliases = collectBackgroundOwnerAliases(snapshot || {});
  if (
    expectedAliases.length === 0 ||
    currentAliases.length === 0 ||
    backgroundOwnerAliasesIntersect(expectedAliases, currentAliases)
  ) {
    return true;
  }
  recordRunEvent("RUN_ACTIVE_TRANSITION_ID_MISMATCH_BLOCKED", {
    expectedRunId: expectedAliases[0] || null,
    activeRunId: currentAliases[0] || null,
    transition: options.transition || "unknown",
    reason: options.reason || null,
    level: "warn",
  });
  return false;
}

function isBackgroundRequestCurrent(request) {
  return Boolean(
    request?.authoritative !== false &&
    request?.generation === backgroundOperationGeneration
  );
}

function getCurrentBackgroundTarget() {
  return {
    runId: normalizeBackgroundRunId(activeSnapshot?.activeRunId),
    status: String(activeSnapshot?.status || "").toUpperCase(),
  };
}

function isStartBackgroundRequestSafe(request) {
  const current = getCurrentBackgroundTarget();
  return Boolean(
    isBackgroundRequestCurrent(request) &&
    request.expectedRunId &&
    current.runId === request.expectedRunId &&
    current.status === ACTIVE_RUN_STATUS.RUNNING
  );
}

function isStopBackgroundRequestSafe(request, snapshot = activeSnapshot) {
  if (!isBackgroundRequestCurrent(request)) return false;
  const currentStatus = String(snapshot?.status || "").toUpperCase();
  if (
    request.requireNoRunningActiveRun &&
    currentStatus === ACTIVE_RUN_STATUS.RUNNING
  ) {
    return false;
  }
  if (!requestMatchesCurrentBackgroundTarget(request, snapshot)) {
    return requestMatchesBackgroundNativeOwner(request);
  }
  return true;
}

function recordBackgroundRequestSkipped(request, stage, snapshot = activeSnapshot) {
  recordRunSnapshotEvent(
    request.type === "start"
      ? "RUN_BACKGROUND_START_ABORTED_STALE"
      : "RUN_BACKGROUND_STOP_ABORTED_STALE",
    snapshot || {},
    {
      reason: request.reason,
      expectedRunId: request.expectedRunId,
      generation: request.generation,
      currentGeneration: backgroundOperationGeneration,
      stage,
    }
  );
}

function captureBackgroundCallbackFence(data = {}) {
  const explicitGeneration = Number(
    data.lifecycleGeneration ??
    data.generation ??
    data.meta?.lifecycleGeneration
  );
  const ownerIdentity = createBackgroundOwnerIdentity(
    {
      expectedRunId:
        data.expectedRunId ??
        data.ownerRunId ??
        data.meta?.ownerRunId ??
        backgroundNativeOwnerRunId,
      ownerAliases:
        data.ownerAliases ??
        data.meta?.ownerAliases ??
        backgroundNativeOwnerAliases,
    },
    activeSnapshot
  );
  return {
    generation: Number.isInteger(explicitGeneration) && explicitGeneration >= 0
      ? explicitGeneration
      : backgroundNativeGeneration,
    generationWasExplicit:
      Number.isInteger(explicitGeneration) && explicitGeneration >= 0,
    ownerRunId:
      ownerIdentity.primaryRunId || backgroundNativeOwnerRunId || null,
    ownerAliases: ownerIdentity.aliases,
    nativeOwnerWasKnown: Boolean(backgroundNativeOwnerRunId),
    activatedAtMs: backgroundNativeActivatedAtMs,
    capturedAtMs: Date.now(),
  };
}

function isBackgroundCallbackFenceCurrent(
  fence,
  snapshot = activeSnapshot
) {
  if (!fence) return true;
  if (
    fence.nativeOwnerWasKnown !== true ||
    !backgroundNativeOwnerRunId
  ) {
    return false;
  }
  if (
    fence.generation !== backgroundNativeGeneration &&
    !(
      fence.generationWasExplicit !== true &&
      fence.nativeOwnerWasKnown !== true &&
      backgroundNativeOwnerRunId
    )
  ) {
    return false;
  }
  const snapshotAliases = collectBackgroundOwnerAliases(snapshot || {});
  if (
    fence.ownerAliases?.length > 0 &&
    snapshotAliases.length > 0 &&
    !backgroundOwnerAliasesIntersect(fence.ownerAliases, snapshotAliases)
  ) {
    return false;
  }
  if (
    backgroundNativeOwnerAliases.length > 0 &&
    fence.ownerAliases?.length > 0 &&
    !backgroundOwnerAliasesIntersect(
      fence.ownerAliases,
      backgroundNativeOwnerAliases
    )
  ) {
    return false;
  }
  return true;
}

function isBackgroundLocationInsideFence(location, fence) {
  if (!fence?.activatedAtMs) return true;
  const timestampMs = Number(location?.timestamp);
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return true;
  const nowMs = Date.now();
  const timestampLooksRealtime = Math.abs(nowMs - timestampMs) <= 86_400_000;
  if (!timestampLooksRealtime) return true;
  return timestampMs + 5000 >= fence.activatedAtMs;
}

function recordBackgroundCallbackFenceMismatch(fence, reason, snapshot) {
  recordRunEvent("RUN_BACKGROUND_CALLBACK_FENCE_MISMATCH", {
    runId: snapshot?.activeRunId || null,
    ownerRunId: fence?.ownerRunId || null,
    generation: fence?.generation ?? null,
    currentGeneration: backgroundNativeGeneration,
    reason,
    level: "warn",
  }, {
    category: LOG_CATEGORIES.BACKGROUND,
  });
}

function setBackgroundCapabilityForRequest(request, started, status) {
  if (
    request.expectedRunId &&
    normalizeBackgroundRunId(activeSnapshot?.activeRunId) === request.expectedRunId
  ) {
    setActiveRunBackgroundCapability(started, status);
  }
}

async function startBackgroundLocationUpdatesInternal(request, options = {}) {
  let snapshot = activeSnapshot;
  try {
    if (Platform.OS === "web") {
      backgroundStarted = false;
      setBackgroundLifecycleOutcome(request, "unsupported");
      setBackgroundCapabilityForRequest(request, false, "unsupported");
      updateRuntimeState({ backgroundTaskStatus: "unsupported" });
      return false;
    }
    if (
      backgroundNativeOwnerRunId &&
      !requestMatchesBackgroundNativeOwner(request)
    ) {
      recordBackgroundOwnerMismatch(request, "start_requested_by_different_owner");
      return false;
    }
    if (!snapshot) {
      if (!isBackgroundRequestCurrent(request)) {
        recordBackgroundRequestSkipped(request, "before_snapshot_load");
        return false;
      }
      snapshot = await loadPersistedSnapshot();
      if (!isBackgroundRequestCurrent(request)) {
        recordBackgroundRequestSkipped(request, "after_snapshot_load", snapshot);
        return false;
      }
      if (
        snapshot?.activeRunId === request.expectedRunId &&
        snapshot.status === ACTIVE_RUN_STATUS.RUNNING
      ) {
        activeSnapshot = normalizeActiveRunSnapshot(snapshot);
        snapshot = activeSnapshot;
      }
    }
    if (!isStartBackgroundRequestSafe(request)) {
      setBackgroundLifecycleOutcome(request, "stale_request");
      recordBackgroundRequestSkipped(request, "before_permission_check", snapshot);
      return false;
    }
    snapshot = activeSnapshot;
    if (typeof options.backgroundPermissionGranted === "boolean") {
      setActiveRunBackgroundPermission(
        options.backgroundPermissionGranted,
        options.backgroundPermissionStatus || "checked"
      );
      snapshot = activeSnapshot || snapshot;
    }
    if (
      Platform.OS === "android" &&
      options.backgroundPermissionGranted !== true &&
      snapshot.meta?.permissions?.backgroundLocationGranted === false
    ) {
      backgroundStarted = false;
      setBackgroundLifecycleOutcome(request, "permission_denied");
      setBackgroundCapabilityForRequest(request, false, "permission_denied");
      updateRuntimeState({ backgroundTaskStatus: "permission_denied" });
      recordBackgroundTaskStatus("permission_denied", {
        runId: request.expectedRunId,
        reason: request.reason,
      });
      return false;
    }

    if (!isStartBackgroundRequestSafe(request)) {
      recordBackgroundRequestSkipped(request, "before_status_probe", snapshot);
      return false;
    }
    let started;
    try {
      started = await Location.hasStartedLocationUpdatesAsync(
        ACTIVE_RUN_LOCATION_TASK
      );
    } catch (probeError) {
      requireBackgroundLifecycleReconciliation(
        request,
        "status_probe_failed",
        "native_status_unknown_before_start"
      );
      recordRunEvent("RUN_BACKGROUND_START_STATUS_PROBE_FAILED", {
        runId: request.expectedRunId,
        operationId: request.operationId,
        generation: request.generation,
        reason: request.reason,
        error: probeError?.message || String(probeError || "probe_failed"),
        level: "warn",
      });
      return false;
    }
    if (!isStartBackgroundRequestSafe(request)) {
      backgroundStarted = Boolean(started);
      if (started && requestMatchesBackgroundNativeOwner(request)) {
        requireBackgroundLifecycleReconciliation(
          request,
          "owner_target_mismatch",
          "native_owner_retained_after_active_run_changed"
        );
      } else if (started && !backgroundNativeOwnerRunId) {
        requireBackgroundLifecycleReconciliation(
          request,
          "owner_unknown",
          "native_task_active_after_target_changed_without_owner"
        );
      } else if (
        !started &&
        requestCanReleaseConfirmedNativeOwner(request)
      ) {
        releaseBackgroundNativeOwner(
          request,
          "status_probe_confirmed_stopped_after_target_changed"
        );
        requireBackgroundLifecycleReconciliation(
          request,
          "stopped_after_target_changed",
          "native_stop_observed_after_active_run_changed"
        );
      } else {
        requireBackgroundLifecycleReconciliation(
          request,
          "stale_start_target_changed",
          "start_target_changed_after_status_probe"
        );
      }
      recordBackgroundRequestSkipped(request, "after_status_probe", snapshot);
      return false;
    }
    if (started && !backgroundNativeOwnerRunId) {
      backgroundStarted = true;
      if (
        canExplicitlyClaimExistingBackgroundOwner(
          request,
          options,
          snapshot
        )
      ) {
        claimBackgroundNativeOwner(
          request,
          `explicit_process_recovery:${options.ownerClaim.reason}`,
          { activatedAtMs: 0 }
        );
        setBackgroundLifecycleOutcome(request, "owner_claimed_explicitly");
        recordRunEvent("RUN_BACKGROUND_LIFECYCLE_HANDOFF", {
          runId: request.expectedRunId,
          operationId: request.operationId,
          generation: request.generation,
          fromOwnerRunId: null,
          toOwnerRunId: request.expectedRunId,
          reason: options.ownerClaim.reason,
          mode: options.ownerClaim.mode,
        });
      } else {
        requireBackgroundLifecycleReconciliation(
          request,
          "owner_unknown",
          "native_task_active_without_process_owner"
        );
        return false;
      }
    }
    if (started && !requestMatchesBackgroundNativeOwner(request)) {
      backgroundStarted = true;
      recordBackgroundOwnerMismatch(request, "native_task_owned_by_another_run");
      return false;
    }
    if (started && options.forceRestart !== true) {
      backgroundStarted = true;
      if (!request.outcome) {
        setBackgroundLifecycleOutcome(request, "already_active");
      }
      setBackgroundCapabilityForRequest(request, true, "already_started");
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
        runId: request.expectedRunId,
        reason: request.reason,
      });
      logRunRecovery("watcher alive", {
        activeRunId: request.expectedRunId,
        task: ACTIVE_RUN_LOCATION_TASK,
      });
      return true;
    }

    if (started && options.forceRestart === true) {
      if (!isStartBackgroundRequestSafe(request)) {
        recordBackgroundRequestSkipped(request, "before_forced_native_stop", snapshot);
        return false;
      }
      try {
        await Location.stopLocationUpdatesAsync(ACTIVE_RUN_LOCATION_TASK);
      } catch (error) {
        if (!isMissingBackgroundTaskError(error)) throw error;
      }
      const forcedStopOwnedNativeBoundary =
        requestCanReleaseConfirmedNativeOwner(request);
      if (forcedStopOwnedNativeBoundary) {
        backgroundStarted = false;
        releaseBackgroundNativeOwner(
          request,
          "force_restart_stop_confirmed"
        );
      }
      if (!isStartBackgroundRequestSafe(request)) {
        if (isBackgroundRequestCurrent(request)) {
          requireBackgroundLifecycleReconciliation(
            request,
            "forced_stop_after_target_changed",
            "forced_native_stop_confirmed_after_active_run_changed"
          );
        }
        recordBackgroundRequestSkipped(request, "after_forced_native_stop", snapshot);
        return false;
      }
      if (!forcedStopOwnedNativeBoundary) {
        requireBackgroundLifecycleReconciliation(
          request,
          "forced_stop_owner_mismatch",
          "forced_native_stop_could_not_release_expected_owner"
        );
        return false;
      }
    }

    if (!started) {
      backgroundStarted = false;
      if (backgroundNativeOwnerRunId) {
        releaseBackgroundNativeOwner(request, "status_probe_confirmed_stopped");
      }
      recordRunSnapshotEvent("LOCATION_WATCHER_RESTARTED", snapshot, {
        watcherStatus: "restarting",
        backgroundTaskStatus: ACTIVE_RUN_LOCATION_TASK,
      });
      recordRunSnapshotEvent("RUN_BACKGROUND_TASK_CANCELLED_OR_STOPPED", snapshot, {
        reason: "not_started_while_running",
        taskName: ACTIVE_RUN_LOCATION_TASK,
      });
      recordBackgroundTaskStatus("not_started_while_running", {
        runId: request.expectedRunId,
        reason: request.reason,
      });
      logRunRecovery("restarting watcher without clearing path", {
        activeRunId: request.expectedRunId,
        task: ACTIVE_RUN_LOCATION_TASK,
      });
    }
    if (!isStartBackgroundRequestSafe(request)) {
      recordBackgroundRequestSkipped(request, "before_native_start", snapshot);
      return false;
    }
    await Location.startLocationUpdatesAsync(
      ACTIVE_RUN_LOCATION_TASK,
      getBackgroundOptions(snapshot.notificationBody || NOTIFICATION_BODY)
    );
    if (!isStartBackgroundRequestSafe(request)) {
      recordBackgroundRequestSkipped(request, "after_native_start", snapshot);
      const pendingTimedOutStartStillOwnsNativeBoundary = Boolean(
        request.timedOut === true &&
        backgroundLifecyclePendingNativeOperation?.operationId ===
          request.operationId &&
        !backgroundNativeOwnerRunId
      );
      if (
        isBackgroundRequestCurrent(request) ||
        pendingTimedOutStartStillOwnsNativeBoundary
      ) {
        try {
          await Location.stopLocationUpdatesAsync(ACTIVE_RUN_LOCATION_TASK);
          if (
            isBackgroundRequestCurrent(request) ||
            backgroundLifecyclePendingNativeOperation?.operationId ===
              request.operationId
          ) {
            backgroundStarted = false;
            setBackgroundLifecycleOutcome(request, "stale_start_cleaned");
            recordRunEvent("RUN_BACKGROUND_STALE_START_CLEANED", {
              runId: request.expectedRunId,
              operationId: request.operationId,
              generation: request.generation,
              reason: request.reason,
              timedOut: request.timedOut === true,
            });
          }
        } catch (cleanupError) {
          if (!isMissingBackgroundTaskError(cleanupError)) {
            requireBackgroundLifecycleReconciliation(
              request,
              "stale_start_cleanup_failed",
              "native_start_completed_after_target_changed"
            );
          }
        }
      }
      return false;
    }
    backgroundStarted = true;
    claimBackgroundNativeOwner(request, "native_start_confirmed");
    setBackgroundLifecycleOutcome(request, "started");
    setBackgroundCapabilityForRequest(request, true, "started");
    updateRuntimeState({
      backgroundTaskStatus: "started",
    });
    log("background_tracking_started", {
      activeRunId: request.expectedRunId,
    });
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
      runId: request.expectedRunId,
      force: Boolean(options.force),
      reason: request.reason,
    });
    return true;
  } catch (error) {
    if (!isStartBackgroundRequestSafe(request)) {
      if (isBackgroundRequestCurrent(request)) {
        requireBackgroundLifecycleReconciliation(
          request,
          "start_failed_after_target_changed",
          "native_start_or_forced_stop_failed_after_active_run_changed"
        );
      }
      recordRunEvent("RUN_BACKGROUND_START_STALE_FAILURE_IGNORED", {
        runId: request.expectedRunId,
        reason: request.reason,
        generation: request.generation,
        error,
        level: "warn",
      });
      return false;
    }
    setBackgroundLifecycleOutcome(request, "start_failed");
    void enqueueLocationIngestion(async () => {
      if (!isStartBackgroundRequestSafe(request)) {
        recordRunEvent("RUN_BACKGROUND_START_STALE_FAILURE_IGNORED", {
          runId: request.expectedRunId,
          reason: request.reason,
          generation: request.generation,
          error,
          stage: "serialized_failure_handler",
          level: "warn",
        });
        return false;
      }
      backgroundStarted = false;
      if (requestMatchesBackgroundNativeOwner(request)) {
        releaseBackgroundNativeOwner(request, "native_start_failed");
      }
      setBackgroundCapabilityForRequest(request, false, "start_failed");
      setActiveRunError(error, "startBackgroundLocationUpdates");
      updateRuntimeState({
        backgroundTaskStatus: "start_failed",
      });
      recordBackgroundTaskStatus("start_failed", {
        runId: request.expectedRunId,
        reason: request.reason,
        error,
      });
      emitError(error, { fn: "startBackgroundLocationUpdates" });
      await performPendingCheckpoint({
        reason: "background_service_start_failed",
        force: true,
        insideIngestionQueue: true,
      });
      return true;
    }).catch((failureHandlerError) => {
      recordRunEvent("RUN_BACKGROUND_START_FAILURE_HANDLER_FAILED", {
        runId: request.expectedRunId,
        operationId: request.operationId,
        generation: request.generation,
        error:
          failureHandlerError?.message ||
          String(failureHandlerError || "failure_handler_failed"),
        level: "warn",
      });
    });
    return false;
  }
}

export function startBackgroundLocationUpdates(options = {}) {
  const expectedRunId = normalizeBackgroundRunId(
    options.expectedRunId || activeSnapshot?.activeRunId
  );
  if (!expectedRunId) return Promise.resolve(false);
  const ownerIdentity = createBackgroundOwnerIdentity(options, activeSnapshot);
  const request = {
    type: "start",
    expectedRunId: ownerIdentity.primaryRunId || expectedRunId,
    ownerAliases: ownerIdentity.aliases,
    reason: options.reason || "start",
    handoffRequested: Boolean(options.handoff),
  };
  return enqueueBackgroundLifecycle(
    request,
    (authorizedRequest) =>
      startBackgroundLocationUpdatesInternal(authorizedRequest, options),
    options.callerTimeoutMs
  );
}

async function stopBackgroundLocationUpdatesInternal(request) {
  try {
    if (Platform.OS === "web") {
      setBackgroundLifecycleOutcome(request, "unsupported");
      return false;
    }
    if (
      backgroundNativeOwnerRunId &&
      request.expectedRunId &&
      !requestMatchesBackgroundNativeOwner(request)
    ) {
      recordBackgroundOwnerMismatch(request, "stop_requested_by_different_owner");
      return false;
    }
    let validationSnapshot = activeSnapshot;
    if (request.requireNoRunningActiveRun && !validationSnapshot) {
      if (!isBackgroundRequestCurrent(request)) {
        recordBackgroundRequestSkipped(request, "before_snapshot_load");
        return false;
      }
      validationSnapshot = await loadPersistedSnapshot();
      if (!isBackgroundRequestCurrent(request)) {
        recordBackgroundRequestSkipped(
          request,
          "after_snapshot_load",
          validationSnapshot
        );
        return false;
      }
    }
    if (!isStopBackgroundRequestSafe(request, validationSnapshot)) {
      setBackgroundLifecycleOutcome(request, "stale_request");
      recordBackgroundRequestSkipped(
        request,
        "before_status_probe",
        validationSnapshot
      );
      return false;
    }
    let started = true;
    try {
      started = await Location.hasStartedLocationUpdatesAsync(
        ACTIVE_RUN_LOCATION_TASK
      );
    } catch (probeError) {
      if (
        !backgroundNativeOwnerRunId ||
        !requestMatchesBackgroundNativeOwner(request)
      ) {
        requireBackgroundLifecycleReconciliation(
          request,
          "status_probe_failed",
          "owner_not_confirmed_after_status_probe_failure"
        );
        return false;
      }
      recordRunEvent("RUN_BACKGROUND_STOP_STATUS_PROBE_FAILED", {
        runId: request.expectedRunId,
        reason: request.reason,
        action: "attempt_native_stop",
        error: probeError,
        level: "warn",
      });
    }
    if (!isStopBackgroundRequestSafe(request, activeSnapshot || validationSnapshot)) {
      recordBackgroundRequestSkipped(
        request,
        "after_status_probe",
        activeSnapshot || validationSnapshot
      );
      return false;
    }
    if (started) {
      if (!backgroundNativeOwnerRunId) {
        backgroundStarted = true;
        requireBackgroundLifecycleReconciliation(
          request,
          "owner_unknown",
          "native_task_active_without_process_owner"
        );
        return false;
      }
      if (!requestMatchesBackgroundNativeOwner(request)) {
        backgroundStarted = true;
        recordBackgroundOwnerMismatch(
          request,
          "native_task_owned_by_another_run"
        );
        return false;
      }
      if (!isStopBackgroundRequestSafe(request, activeSnapshot || validationSnapshot)) {
        recordBackgroundRequestSkipped(
          request,
          "before_native_stop",
          activeSnapshot || validationSnapshot
        );
        return false;
      }
      try {
        await Location.stopLocationUpdatesAsync(ACTIVE_RUN_LOCATION_TASK);
      } catch (error) {
        if (!isMissingBackgroundTaskError(error)) throw error;
      }
      const confirmedStopOwnedNativeBoundary =
        requestCanReleaseConfirmedNativeOwner(request);
      const targetChanged = !requestMatchesCurrentBackgroundTarget(
        request,
        activeSnapshot || validationSnapshot
      );
      if (
        !isBackgroundRequestCurrent(request) ||
        targetChanged
      ) {
        recordBackgroundRequestSkipped(
          request,
          "after_native_stop",
          activeSnapshot || validationSnapshot
        );
        if (confirmedStopOwnedNativeBoundary) {
          backgroundStarted = false;
          releaseBackgroundNativeOwner(
            request,
            "native_stop_confirmed_after_target_changed"
          );
          if (isBackgroundRequestCurrent(request)) {
            setBackgroundLifecycleOutcome(
              request,
              "stopped_after_target_changed"
            );
          }
          recordRunEvent("RUN_BACKGROUND_STOP_TARGET_CHANGED_CONFIRMED", {
            runId: request.expectedRunId,
            activeRunId: activeSnapshot?.activeRunId || null,
            operationId: request.operationId,
            generation: request.generation,
            reason: request.reason,
            timedOut: request.timedOut === true,
          });
        }
        return true;
      }
      if (!confirmedStopOwnedNativeBoundary) {
        requireBackgroundLifecycleReconciliation(
          request,
          "stop_owner_mismatch",
          "native_stop_confirmed_without_expected_owner_boundary"
        );
        return false;
      }
      backgroundStarted = false;
      releaseBackgroundNativeOwner(request, "native_stop_confirmed");
      setBackgroundLifecycleOutcome(request, "stopped");
    } else {
      backgroundStarted = false;
      if (backgroundNativeOwnerRunId) {
        releaseBackgroundNativeOwner(request, "status_probe_confirmed_stopped");
      } else {
        backgroundNativeGeneration = request.generation;
        backgroundNativeActivatedAtMs = 0;
      }
      setBackgroundLifecycleOutcome(request, "already_stopped");
    }
    setBackgroundCapabilityForRequest(request, false, "stopped");
    updateRuntimeState({
      backgroundTaskStatus: "stopped",
    });
    log("background_tracking_stopped", {
      expectedRunId: request.expectedRunId,
      reason: request.reason,
    });
    recordRunEvent("LOCATION_WATCHER_STOPPED", {
      runId: request.expectedRunId,
      reason: request.reason,
      watcherStatus: "stopped",
      backgroundTaskStatus: ACTIVE_RUN_LOCATION_TASK,
    });
    recordRunEvent("RUN_BACKGROUND_TASK_CANCELLED_OR_STOPPED", {
      runId: request.expectedRunId,
      reason: request.reason,
      backgroundTaskStatus: "stopped",
      taskName: ACTIVE_RUN_LOCATION_TASK,
    });
    recordBackgroundTaskStatus("stopped", {
      runId: request.expectedRunId,
      reason: request.reason,
    });
    return true;
  } catch (error) {
    const targetChanged = !requestMatchesCurrentBackgroundTarget(
      request,
      activeSnapshot
    );
    if (
      !isBackgroundRequestCurrent(request) ||
      targetChanged ||
      !isStopBackgroundRequestSafe(request, activeSnapshot)
    ) {
      if (isBackgroundRequestCurrent(request)) {
        requireBackgroundLifecycleReconciliation(
          request,
          "stop_failed_after_target_changed",
          "native_stop_failed_after_active_run_changed"
        );
      }
      recordRunEvent("RUN_BACKGROUND_STOP_STALE_FAILURE_IGNORED", {
        runId: request.expectedRunId,
        reason: request.reason,
        generation: request.generation,
        activeRunId: activeSnapshot?.activeRunId || null,
        error,
        level: "warn",
      });
      return false;
    }
    setBackgroundLifecycleOutcome(request, "stop_failed");
    recordBackgroundTaskStatus("stop_failed", {
      runId: request.expectedRunId,
      reason: request.reason,
      error,
    });
    emitError(error, {
      fn: "stopBackgroundLocationUpdates",
      reason: request.reason,
    });
    return false;
  }
}

export function stopBackgroundLocationUpdates(options = {}) {
  if (
    options.requireNoRunningActiveRun === true &&
    activeSnapshot?.status === ACTIVE_RUN_STATUS.RUNNING
  ) {
    return Promise.resolve(false);
  }
  const expectedRunId = normalizeBackgroundRunId(
    options.expectedRunId || activeSnapshot?.activeRunId
  );
  const requireNoRunningActiveRun =
    options.requireNoRunningActiveRun === true;
  const ownerIdentity = createBackgroundOwnerIdentity(
    {
      ...options,
      expectedRunId,
    },
    activeSnapshot
  );
  const request = {
    type: "stop",
    expectedRunId: ownerIdentity.primaryRunId || expectedRunId,
    ownerAliases: ownerIdentity.aliases,
    reason: options.reason || "manual",
    requireNoRunningActiveRun,
    handoffRequested: Boolean(options.handoff),
  };
  return enqueueBackgroundLifecycle(
    request,
    (authorizedRequest) =>
      stopBackgroundLocationUpdatesInternal(authorizedRequest),
    options.callerTimeoutMs
  );
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
    if (!matchesExpectedActiveRunId(
      { ...options, transition: "record_location" },
      activeSnapshot
    )) {
      return activeSnapshot;
    }
    if (
      options.backgroundLifecycleFence &&
      !isBackgroundCallbackFenceCurrent(
        options.backgroundLifecycleFence,
        activeSnapshot
      )
    ) {
      recordBackgroundCallbackFenceMismatch(
        options.backgroundLifecycleFence,
        "before_location_ingestion",
        activeSnapshot
      );
      return activeSnapshot;
    }
    if (
      options.backgroundLifecycleFence &&
      !isBackgroundLocationInsideFence(
        location,
        options.backgroundLifecycleFence
      )
    ) {
      recordBackgroundCallbackFenceMismatch(
        options.backgroundLifecycleFence,
        "location_predates_native_generation",
        activeSnapshot
      );
      return activeSnapshot;
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
    if (!matchesExpectedActiveRunId(
      { ...options, transition: "pause" },
      activeSnapshot
    )) {
      return activeSnapshot;
    }
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
    if (!matchesExpectedActiveRunId(
      { ...options, transition: "resume" },
      activeSnapshot
    )) {
      return activeSnapshot;
    }
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
    const finishedAtMs = Number(
      options.finishedAtMs ??
      options.nowMs ??
      Date.now()
    );
    const finishedAt = options.finishedAt || nowIso(finishedAtMs);
    const finishingPausedMs = getPausedDurationIncludingOpenPause(activeSnapshot, finishedAtMs);
    const snapshot = createSnapshotFromTrackingSession(session, {
      ...activeSnapshot,
      pausedDurationMs: finishingPausedMs,
      totalPausedMs: finishingPausedMs,
      totalPausedTime: finishingPausedMs,
      recoveryPending: true,
    }, {
      status: ACTIVE_RUN_STATUS.FINISHING,
      nowMs: finishedAtMs,
      finishedAtMs,
      finishedAt,
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
    const frozenFinishedAtMs = activeSnapshot.status === ACTIVE_RUN_STATUS.FINISHING
      ? toOptionalTimestampMs(
          activeSnapshot.finishedAtMs ??
          activeSnapshot.finishedAt ??
          activeSnapshot.endedAt
        )
      : null;
    const finishedAtMs = frozenFinishedAtMs || Number(options.finishedAtMs || Date.now());
    const finishedAt = activeSnapshot.status === ACTIVE_RUN_STATUS.FINISHING
      ? activeSnapshot.finishedAt || nowIso(finishedAtMs)
      : options.finishedAt || nowIso(finishedAtMs);
    const durationMs = calculateActiveRunDurationSeconds(activeSnapshot, { nowMs: finishedAtMs }) * 1000;
    const finish = session.finishTrackingSession?.({
      durationMs,
      finishedAt: finishedAtMs,
    });
    const snapshot = createSnapshotFromTrackingSession(session, {
      ...activeSnapshot,
      ...(finish || {}),
      finishedAtMs,
      finishedAt,
    }, {
      status: ACTIVE_RUN_STATUS.FINISHED,
      nowMs: finishedAtMs,
      finishedAtMs,
      finishedAt,
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
  const lifecycleFence = captureBackgroundCallbackFence(data);
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
  const snapshot = activeSnapshot || (await loadPersistedSnapshot());
  if (!isBackgroundCallbackFenceCurrent(lifecycleFence, snapshot)) {
    recordBackgroundCallbackFenceMismatch(
      lifecycleFence,
      "before_background_batch",
      snapshot
    );
    return snapshot || null;
  }
  updateRuntimeState({
    backgroundTaskStatus: "handled",
  });
  recordRunEvent("RUN_BACKGROUND_TASK_HANDLED", {
    taskName: ACTIVE_RUN_LOCATION_TASK,
    locationsCount: locations.length,
    runId: snapshot?.activeRunId || null,
    generation: lifecycleFence.generation,
  }, {
    category: LOG_CATEGORIES.BACKGROUND,
  });
  recordBackgroundTaskStatus("handled", {
    runId: snapshot?.activeRunId || null,
    locationsCount: locations.length,
    generation: lifecycleFence.generation,
  });
  if (
    !snapshot?.activeRunId ||
    snapshot.status !== ACTIVE_RUN_STATUS.RUNNING
  ) {
    recordRunEvent("RUN_BACKGROUND_TASK_NO_ACTIVE_SESSION", {
      taskName: ACTIVE_RUN_LOCATION_TASK,
      locationsCount: locations.length,
      runId: snapshot?.activeRunId || null,
      status: snapshot?.status || null,
    }, {
      category: LOG_CATEGORIES.BACKGROUND,
    });
    await stopBackgroundLocationUpdates({
      expectedRunId: snapshot?.activeRunId || null,
      reason: "orphaned_background_task",
      requireNoRunningActiveRun: true,
    });
    return snapshot || null;
  }
  if (locations.length === 0) return snapshot;
  for (const loc of locations) {
    if (!isBackgroundCallbackFenceCurrent(lifecycleFence, snapshot)) {
      recordBackgroundCallbackFenceMismatch(
        lifecycleFence,
        "during_background_batch",
        snapshot
      );
      break;
    }
    if (!isBackgroundLocationInsideFence(loc, lifecycleFence)) {
      recordBackgroundCallbackFenceMismatch(
        lifecycleFence,
        "location_predates_native_generation",
        snapshot
      );
      continue;
    }
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
    }, {
      source: "background",
      deferCheckpoint: true,
      expectedRunId: snapshot.activeRunId,
      backgroundLifecycleFence: lifecycleFence,
    });
  }
  if (!isBackgroundCallbackFenceCurrent(lifecycleFence, snapshot)) {
    return activeSnapshot || snapshot;
  }
  return flushPendingActiveRunCheckpoint({
    reason: "background_batch",
    force: true,
  });
}

export async function handleActiveRunLocationTask({ data, error } = {}) {
  const lifecycleFence = captureBackgroundCallbackFence(data || {});
  if (error) {
    if (!isBackgroundCallbackFenceCurrent(lifecycleFence, activeSnapshot)) {
      recordBackgroundCallbackFenceMismatch(
        lifecycleFence,
        "background_task_error",
        activeSnapshot
      );
      return activeSnapshot;
    }
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

export function __getActiveRunCheckpointWorkCountersForTests() {
  return { ...checkpointWorkCounters };
}

export async function __flushActiveRunBackgroundLifecycleForTests() {
  try {
    await backgroundLifecycleQueue;
  } catch {
    // The operation already records its own failure.
  }
  try {
    await locationIngestionQueue;
  } catch {
    // The serialized failure handler already records its own failure.
  }
}

export function __resetActiveRunRuntimeForTests() {
  clearCheckpointTimer();
  if (backgroundLifecycleActiveOperation) {
    backgroundLifecycleActiveOperation.authoritative = false;
  }
  if (backgroundLifecyclePendingNativeOperation) {
    backgroundLifecyclePendingNativeOperation.authoritative = false;
  }
  if (backgroundStatusProbeInFlight) {
    backgroundStatusProbeInFlight.authoritative = false;
  }
  activeSession = null;
  activeSnapshot = null;
  backgroundStarted = false;
  backgroundOperationGeneration += 1;
  backgroundLifecycleQueue = Promise.resolve();
  backgroundLifecycleActiveOperation = null;
  backgroundLifecyclePendingNativeOperation = null;
  backgroundLifecycleLastOperation = null;
  backgroundLifecycleLastLateOutcome = null;
  backgroundLifecycleState = BACKGROUND_LIFECYCLE_STATE.IDLE;
  backgroundLifecycleReconciliationRequired = false;
  backgroundLifecycleQueueReleased = true;
  backgroundNativeOwnerRunId = null;
  backgroundNativeOwnerAliases = [];
  backgroundNativeGeneration = backgroundOperationGeneration;
  backgroundNativeActivatedAtMs = 0;
  backgroundStatusProbeInFlight = null;
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
  persistedCheckpointState = {
    activeRunId: null,
    trustedPointsCount: 0,
    rawPointsCount: 0,
    distanceMeters: 0,
  };
  checkpointWorkCounters = {
    committedCheckpointWrites: 0,
    committedCheckpointFallbacks: 0,
    normalizedPersistCalls: 0,
    routeChunkWrites: 0,
    routeChunkPointsSanitized: 0,
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
