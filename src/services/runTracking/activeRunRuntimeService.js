import { AppState } from "react-native";
import activeRunTrackingService from "./activeRunTrackingService.js";
import {
  ACTIVE_RUN_STATUS,
  calculateActiveRunDurationSeconds,
  normalizeActiveRunSnapshot,
} from "./activeRunState.js";
import {
  findRecoverableRunForUser,
  hydrateRecoverableRunCandidate,
  isLiveRecovery,
} from "../run/runRecoveryService.js";
import {
  buildRunNotificationPayloadFromSnapshot,
  getNativeNotificationState,
  startRunNotification,
  updateRunNotification,
} from "../run/runNotificationService.js";
import { loadActiveRun } from "../runOfflineStorageService.js";
import {
  recordRunEvent,
  recordRunSnapshotEvent,
  summarizeRunSnapshot,
} from "../diagnostics/runDiagnosticsService.js";
import { LOG_CATEGORIES } from "../../utils/logger.js";
import { recordFlightEvent } from "../diagnostics/activeRunFlightRecorder.js";

export const RUN_RUNTIME_STATUS = {
  IDLE: ACTIVE_RUN_STATUS.IDLE,
  STARTING: ACTIVE_RUN_STATUS.STARTING,
  RUNNING: ACTIVE_RUN_STATUS.RUNNING,
  PAUSED: ACTIVE_RUN_STATUS.PAUSED,
  RECOVERING: ACTIVE_RUN_STATUS.RECOVERING,
  STOPPING: ACTIVE_RUN_STATUS.STOPPING,
  FINISHED: ACTIVE_RUN_STATUS.FINISHED,
  ERROR_RECOVERABLE: ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
};

const LIVE_STATUSES = new Set([
  ACTIVE_RUN_STATUS.STARTING,
  ACTIVE_RUN_STATUS.RUNNING,
  ACTIVE_RUN_STATUS.PAUSED,
  ACTIVE_RUN_STATUS.RECOVERING,
  ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
]);

let reconcileInFlight = null;
let lastDeepLinkReceived = null;
let lastNotificationActionReceived = null;
let lastReconcileReason = null;

function normalizeReason(reason = "runtime") {
  return String(reason || "runtime");
}

function isLiveSnapshot(snapshot = {}) {
  return LIVE_STATUSES.has(String(snapshot?.status || "").toUpperCase());
}

function isNativeNotificationActive(state = {}) {
  return Boolean(state?.isActive || state?.hasForegroundService);
}

function activeEvidenceRunId(runtime = {}) {
  if (runtime.activeRunId && LIVE_STATUSES.has(runtime.status)) return runtime.activeRunId;
  return null;
}

function isRuntimeActiveEvidence(runtime = {}) {
  return (
    Boolean(activeEvidenceRunId(runtime)) ||
    Boolean(runtime.offlineRun?.localRunId && ["RUNNING", "PAUSED"].includes(runtime.offlineRun.status)) ||
    runtime.backgroundTaskProbe?.started === true ||
    runtime.backgroundTaskProbe?.status === "probe_failed" ||
    isNativeNotificationActive(runtime.nativeNotificationState)
  );
}

function toRuntimeStatus(snapshot = null, fallback = ACTIVE_RUN_STATUS.IDLE) {
  const status = String(snapshot?.status || fallback || ACTIVE_RUN_STATUS.IDLE).toUpperCase();
  if (status === ACTIVE_RUN_STATUS.RUNNING || status === ACTIVE_RUN_STATUS.PAUSED) return status;
  if (status === ACTIVE_RUN_STATUS.STARTING) return ACTIVE_RUN_STATUS.STARTING;
  if (status === ACTIVE_RUN_STATUS.RECOVERING) return ACTIVE_RUN_STATUS.RECOVERING;
  if (status === ACTIVE_RUN_STATUS.ERROR_RECOVERABLE) return ACTIVE_RUN_STATUS.ERROR_RECOVERABLE;
  if (status === ACTIVE_RUN_STATUS.STOPPING || status === ACTIVE_RUN_STATUS.FINISHING) return ACTIVE_RUN_STATUS.STOPPING;
  if (status === ACTIVE_RUN_STATUS.FINISHED) return ACTIVE_RUN_STATUS.FINISHED;
  return ACTIVE_RUN_STATUS.IDLE;
}

function countChunks(run = {}) {
  const segments = Array.isArray(run.routeSegments || run.segments)
    ? (run.routeSegments || run.segments)
    : [];
  return segments.length;
}

function summarizeOfflineRun(run = null) {
  if (!run) return null;
  return {
    localRunId: run.localRunId || null,
    userId: run.userId || null,
    status: run.status || null,
    syncStatus: run.syncStatus || null,
    pointsCount: Array.isArray(run.points) ? run.points.length : 0,
    rawPointsCount: Array.isArray(run.rawPoints) ? run.rawPoints.length : 0,
    chunksCount: countChunks(run),
    distanceMeters: Number(run.distanceMeters || 0) || 0,
    checkpointAt: run.checkpointAt || null,
    checkpointAtMs: run.checkpointAtMs || null,
  };
}

function buildRuntimeSnapshot({
  snapshot = null,
  offlineRun = null,
  nativeNotificationState = null,
  reason = "runtime",
  reconciliationStatus = "unknown",
} = {}) {
  const normalized = snapshot ? normalizeActiveRunSnapshot(snapshot) : null;
  const runtime = activeRunTrackingService.getTrackingRuntimeStatus?.() || {};
  const routeSegments = normalized?.routeSegments || normalized?.segments || [];
  const pathQuality = normalized?.pathQuality || normalized?.gpsQualitySummary || {};
  const elapsedSeconds = normalized
    ? calculateActiveRunDurationSeconds(normalized)
    : 0;

  return {
    sessionId: normalized?.activeRunId || offlineRun?.localRunId || null,
    runId: normalized?.activeRunId || offlineRun?.localRunId || null,
    activeRunId: normalized?.activeRunId || null,
    localRunId: normalized?.localRunId || offlineRun?.localRunId || null,
    userId: normalized?.userId || offlineRun?.userId || null,
    status: toRuntimeStatus(normalized, offlineRun?.status || ACTIVE_RUN_STATUS.IDLE),
    startedAt: normalized?.startedAt || offlineRun?.startedAt || null,
    updatedAt: normalized?.lastUpdatedAt || offlineRun?.updatedAt || null,
    lastPersistedAt: runtime.lastPersistedAt || offlineRun?.checkpointAt || null,
    elapsedMs: elapsedSeconds * 1000,
    totalPausedMs: Number(normalized?.pausedDurationMs || normalized?.totalPausedMs || offlineRun?.totalPausedTime || 0) || 0,
    distanceMeters: Number(normalized?.distanceMeters ?? offlineRun?.distanceMeters ?? 0) || 0,
    acceptedPointsCount: Array.isArray(normalized?.trustedPath) ? normalized.trustedPath.length : 0,
    rejectedPointsCount: Number(pathQuality.rejectedPoints || 0) || 0,
    currentSegment: Array.isArray(routeSegments) ? routeSegments[routeSegments.length - 1] || null : null,
    routeSegments: Array.isArray(routeSegments) ? routeSegments : [],
    routeChunksCount: Number(runtime.routeChunksCount || normalized?.routeChunksIndex?.chunks?.length || 0) || 0,
    routeChunksIndex: normalized?.routeChunksIndex || runtime.routeChunksIndex || null,
    lastValidPoint: normalized?.currentLocation || normalized?.trustedPath?.slice(-1)?.[0] || offlineRun?.lastValidPoint || null,
    lastRawPointReceivedAt: runtime.lastRawPointReceivedAt || null,
    foregroundWatcherStatus: runtime.foregroundWatcherStatus || runtime.watcherStatus || "unknown",
    backgroundTaskStatus: runtime.backgroundTaskStatus || runtime.taskName || "unknown",
    notificationStatus: runtime.notificationStatus || "unknown",
    nativeNotificationState,
    appState: runtime.appState || AppState.currentState || null,
    screenFocusState: runtime.screenFocusState || null,
    recoveryReason: reason,
    storageHealth: runtime.storageHealth || null,
    pendingFlushCount: Number(runtime.pendingFlushCount || 0) || 0,
    pendingFlushes: Number(runtime.pendingFlushCount || 0) || 0,
    pendingSync: normalized?.pendingSync ?? offlineRun?.pendingSync ?? false,
    offlineRun: summarizeOfflineRun(offlineRun),
    lastDeepLinkReceived,
    lastNotificationActionReceived,
    lastReconcileReason,
    reconciliationStatus,
    canShowStartButton: reconciliationStatus === "idle",
    summary: summarizeRunSnapshot(normalized || {}, runtime),
  };
}

export function setRuntimeSurfaceState(patch = {}) {
  return activeRunTrackingService.setRunRuntimeSurfaceState?.(patch);
}

export function recordDeepLinkReceived(url, context = {}) {
  lastDeepLinkReceived = {
    url: String(url || ""),
    receivedAt: new Date().toISOString(),
    ...context,
  };
  recordRunEvent("RUN_DEEP_LINK_RECEIVED", lastDeepLinkReceived, {
    category: LOG_CATEGORIES.APP_STATE,
  });
}

export function recordNotificationOpen(context = {}) {
  lastNotificationActionReceived = {
    action: "open",
    receivedAt: new Date().toISOString(),
    ...context,
  };
  recordRunEvent("RUN_OPENED_FROM_NOTIFICATION", lastNotificationActionReceived, {
    category: LOG_CATEGORIES.NOTIFICATION,
  });
}

export function recordNotificationAction(action, context = {}) {
  lastNotificationActionReceived = {
    action: String(action || "unknown"),
    receivedAt: new Date().toISOString(),
    ...context,
  };
  recordRunEvent("RUN_NOTIFICATION_ACTION_RECEIVED", lastNotificationActionReceived, {
    category: LOG_CATEGORIES.NOTIFICATION,
  });
}

export async function getActiveRunRuntimeSnapshot(reason = "runtime") {
  const [snapshot, offlineRun, nativeNotificationState, backgroundTaskProbe] = await Promise.all([
    activeRunTrackingService.getActiveRunSnapshot?.().catch(() => null),
    loadActiveRun().catch(() => null),
    getNativeNotificationState().catch(() => null),
    activeRunTrackingService.getBackgroundLocationTaskStatus?.().catch(() => null),
  ]);
  const runtime = buildRuntimeSnapshot({
    snapshot,
    offlineRun,
    nativeNotificationState,
    reason,
    reconciliationStatus: snapshot || offlineRun || isNativeNotificationActive(nativeNotificationState) ? "has_evidence" : "idle",
  });
  return {
    ...runtime,
    backgroundTaskStatus: backgroundTaskProbe?.status || runtime.backgroundTaskStatus,
    backgroundTaskProbe,
  };
}

function buildRecoverableEvidenceSnapshot(before = {}, error = null) {
  const runId = activeEvidenceRunId(before);
  if (!runId) return null;
  const startedAtMs = Date.parse(before.startedAt || "") || Date.now();
  return {
    activeRunId: runId,
    id: runId,
    localRunId: before.localRunId || before.offlineRun?.localRunId || runId,
    userId: before.userId || "offline",
    mode: "free",
    status: ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
    startedAtMs,
    startedAt: before.startedAt || new Date(startedAtMs).toISOString(),
    lastUpdatedAtMs: Date.now(),
    lastUpdatedAt: new Date().toISOString(),
    distanceMeters: Number(before.distanceMeters || 0) || 0,
    distance: Number(before.distanceMeters || 0) || 0,
    meta: {
      evidenceOnly: true,
      errorRecoverable: true,
      recoveryReason: before.recoveryReason || lastReconcileReason || "reconcile_failed",
      nativeNotificationActive: isNativeNotificationActive(before.nativeNotificationState),
      error: error?.message || String(error || ""),
    },
  };
}

function preserveActiveEvidence(current, reason, error = null) {
  const snapshot = buildRecoverableEvidenceSnapshot(current, error);
  if (error) activeRunTrackingService.setRunRuntimeSurfaceState?.({ recoveryReason: reason });
  if (snapshot) {
    const details = {
      reason,
      canShowStartButton: false,
      nativeNotificationActive: isNativeNotificationActive(current.nativeNotificationState),
    };
    recordRunSnapshotEvent("RUN_RECONCILE_PRESERVED_ACTIVE_EVIDENCE", snapshot, details);
    recordRunSnapshotEvent("RUN_ERROR_RECOVERABLE_ACTIVE_RUN", snapshot, details);
  }
  return {
    snapshot,
    source: error ? "preserved_active_evidence" : "active_evidence",
    ...(error ? { error } : {}),
    canShowStartButton: false,
    runtime: snapshot
      ? buildRuntimeSnapshot({
          snapshot,
          offlineRun: current.offlineRun,
          nativeNotificationState: current.nativeNotificationState,
          reason,
          reconciliationStatus: "error_recoverable",
        })
      : { ...current, reconciliationStatus: "error_recoverable", canShowStartButton: false },
  };
}

export async function ensureTrackingForActiveRun(reason = "runtime", options = {}) {
  const snapshot = options.snapshot || (await activeRunTrackingService.getActiveRunSnapshot?.());
  if (!snapshot?.activeRunId) return false;
  if (String(snapshot.status).toUpperCase() !== ACTIVE_RUN_STATUS.RUNNING) return false;
  const started = await activeRunTrackingService.startBackgroundLocationUpdates?.({
    force: false,
    reason,
  });
  recordRunSnapshotEvent("RUN_RECONCILE_RECOVERED", snapshot, {
    reason,
    ensured: "tracking",
    backgroundTaskStarted: Boolean(started),
  });
  return Boolean(started);
}

export async function ensureNotificationForActiveRun(reason = "runtime", options = {}) {
  const snapshot = options.snapshot || (await activeRunTrackingService.getActiveRunSnapshot?.());
  if (!snapshot?.activeRunId || !isLiveSnapshot(snapshot)) return false;
  const payload = buildRunNotificationPayloadFromSnapshot(snapshot);
  const updated = await updateRunNotification(payload, {
    force: options.force === true,
    requestPermission: false,
  });
  if (!updated) {
    await startRunNotification(payload, {
      requestPermission: false,
    });
  }
  activeRunTrackingService.setRunRuntimeSurfaceState?.({
    notificationStatus: "active",
  });
  recordRunSnapshotEvent("RUN_NOTIFICATION_UPDATED", snapshot, {
    reason,
    status: snapshot.status,
  });
  return true;
}

export async function reconcileActiveRunState(reason = "runtime", options = {}) {
  const normalizedReason = normalizeReason(reason);
  lastReconcileReason = normalizedReason;

  if (reconcileInFlight && options.joinExisting !== false) {
    return reconcileInFlight;
  }

  reconcileInFlight = (async () => {
    activeRunTrackingService.setRunRuntimeSurfaceState?.({
      recoveryReason: normalizedReason,
      appState: options.appState || AppState.currentState || null,
      screenFocusState: options.screenFocusState || undefined,
    });

    const before = await getActiveRunRuntimeSnapshot(normalizedReason);
    recordRunEvent("RUN_RECONCILE_STARTED", {
      reason: normalizedReason,
      status: before.status,
      runId: before.runId,
      backgroundTaskStatus: before.backgroundTaskStatus,
      notificationStatus: before.notificationStatus,
      storageHealth: before.storageHealth,
    });
    if (isNativeNotificationActive(before.nativeNotificationState)) {
      recordRunEvent("RUN_NOTIFICATION_NATIVE_STATE_ACTIVE_EVIDENCE", {
        reason: normalizedReason,
        status: before.nativeNotificationState?.status || "UNKNOWN",
        notificationId: before.nativeNotificationState?.notificationId || null,
      }, {
        category: LOG_CATEGORIES.NOTIFICATION,
      });
    }

    try {
      const userId =
        options.userId ||
        before.userId ||
        before.offlineRun?.userId ||
        "offline";
      const recovery = await findRecoverableRunForUser(userId, {
        reason: normalizedReason,
      });

      let snapshot = null;
      let source = null;
      if (recovery?.recoverable && isLiveRecovery(recovery)) {
        if (recovery.source !== "tracking" || recovery.id !== before.runId) {
          recordRunEvent("RUN_RECONCILE_INCONSISTENT_STATE", {
            reason: normalizedReason,
            selectedSource: recovery.source,
            selectedRunId: recovery.id,
            previousRunId: before.runId,
            previousStatus: before.status,
          }, {
            category: LOG_CATEGORIES.RUN_RECOVERY,
          });
        }
        const hydrated = await hydrateRecoverableRunCandidate(recovery, {
          userId,
          restartTracking: options.restartTracking !== false,
          forceRunning: options.forceRunning,
        });
        snapshot = hydrated?.snapshot || recovery.raw || null;
        source = hydrated?.source || recovery.source;
      } else {
        const current = await activeRunTrackingService.getActiveRunSnapshot?.();
        if (current?.activeRunId && isLiveSnapshot(current)) {
          snapshot = await activeRunTrackingService.hydrateActiveRunSnapshot?.(current, {
            restartTracking: options.restartTracking !== false,
            event: "runtime_reconciled",
          });
          source = "tracking";
        }
      }

      if (snapshot?.activeRunId && isLiveSnapshot(snapshot)) {
        const current = await activeRunTrackingService.getActiveRunSnapshot?.();
        if (!current?.activeRunId || current.activeRunId !== snapshot.activeRunId || !isLiveSnapshot(current)) {
          snapshot = null;
        }
      }

      if (snapshot?.activeRunId && isLiveSnapshot(snapshot)) {
        recordFlightEvent("SESSION_RECOVERED", {
          snapshot,
          source: "recovery",
          appState: AppState.currentState,
          elapsedMs: calculateActiveRunDurationSeconds(snapshot) * 1000,
          reason: normalizedReason,
        });
        await ensureTrackingForActiveRun(normalizedReason, { snapshot });
        await ensureNotificationForActiveRun(normalizedReason, {
          snapshot,
          force: options.forceNotification === true,
        });
        recordRunSnapshotEvent("RUN_RECONCILE_RECOVERED", snapshot, {
          reason: normalizedReason,
          source,
        });
        return {
          snapshot,
          source,
          runtime: buildRuntimeSnapshot({
            snapshot,
            offlineRun: before.offlineRun,
            reason: normalizedReason,
            reconciliationStatus: "recovered",
          }),
        };
      }

      const current = await getActiveRunRuntimeSnapshot(normalizedReason);
      if (isRuntimeActiveEvidence(current)) return preserveActiveEvidence(current, normalizedReason);

      recordRunEvent("RUN_RECONCILE_RECOVERED", {
        reason: normalizedReason,
        status: ACTIVE_RUN_STATUS.IDLE,
        evidenceStatus: before.status,
      });
      return {
        snapshot: null,
        source: null,
        runtime: buildRuntimeSnapshot({
          snapshot: null,
          offlineRun: current.offlineRun,
          reason: normalizedReason,
          reconciliationStatus: "idle",
        }),
      };
    } catch (error) {
      recordRunEvent("RUN_RECONCILE_FAILED", {
        reason: normalizedReason,
        error,
      });
      const current = await getActiveRunRuntimeSnapshot(normalizedReason).catch(() => null);
      if (!current) return {
        snapshot: null,
        source: null,
        error,
        canShowStartButton: false,
        runtime: { ...before, reconciliationStatus: "error_recoverable", canShowStartButton: false },
      };
      if (isRuntimeActiveEvidence(current)) return preserveActiveEvidence(current, normalizedReason, error);
      return {
        snapshot: null,
        source: null,
        error,
        canShowStartButton: true,
        runtime: before,
      };
    } finally {
      reconcileInFlight = null;
    }
  })();

  return reconcileInFlight;
}

export async function hydrateActiveRunFromRuntime(reason = "runtime", options = {}) {
  const normalizedReason = normalizeReason(reason);
  recordRunEvent("RUN_REHYDRATE_STARTED", {
    reason: normalizedReason,
  });
  try {
    const result = await reconcileActiveRunState(normalizedReason, options);
    if (result?.snapshot?.activeRunId) {
      const current = await getActiveRunRuntimeSnapshot(normalizedReason);
      if (activeEvidenceRunId(current) !== result.snapshot.activeRunId) {
        const uncertain = isRuntimeActiveEvidence(current);
        recordRunEvent("RUN_RECONCILE_INCONSISTENT_STATE", {
          reason: normalizedReason,
          selectedRunId: result.snapshot.activeRunId,
          currentRunId: activeEvidenceRunId(current),
          previousStatus: result.snapshot.status,
          currentStatus: current.status,
        });
        return {
          snapshot: null,
          source: null,
          canShowStartButton: !uncertain,
          runtime: {
            ...current,
            reconciliationStatus: uncertain ? "error_recoverable" : "idle",
            canShowStartButton: !uncertain,
          },
        };
      }
      recordRunSnapshotEvent("RUN_REHYDRATE_SUCCESS", result.snapshot, {
        reason: normalizedReason,
        source: result.source,
      });
    } else {
      recordRunEvent("RUN_REHYDRATE_SUCCESS", {
        reason: normalizedReason,
        status: ACTIVE_RUN_STATUS.IDLE,
      });
    }
    return result;
  } catch (error) {
    recordRunEvent("RUN_REHYDRATE_FAILED", {
      reason: normalizedReason,
      error,
    });
    return {
      snapshot: null,
      source: null,
      error,
    };
  }
}

export default {
  RUN_RUNTIME_STATUS,
  ensureNotificationForActiveRun,
  ensureTrackingForActiveRun,
  getActiveRunRuntimeSnapshot,
  hydrateActiveRunFromRuntime,
  reconcileActiveRunState,
  recordDeepLinkReceived,
  recordNotificationAction,
  recordNotificationOpen,
  setRuntimeSurfaceState,
};
