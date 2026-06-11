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
let lastKnownActiveSnapshot = null;

function normalizeReason(reason = "runtime") {
  return String(reason || "runtime");
}

function isLiveSnapshot(snapshot = {}) {
  return LIVE_STATUSES.has(String(snapshot?.status || "").toUpperCase());
}

function hasRecentEvidence(value = null, maxAgeMs = 120000) {
  const receivedAt = value?.receivedAt ? Date.parse(value.receivedAt) : 0;
  return Number.isFinite(receivedAt) && receivedAt > 0 && Date.now() - receivedAt <= maxAgeMs;
}

function isNativeNotificationActive(state = {}) {
  return Boolean(state?.isActive || state?.hasForegroundService);
}

function isRuntimeActiveEvidence(runtime = {}) {
  const status = String(runtime?.status || "").toUpperCase();
  return (
    LIVE_STATUSES.has(status) ||
    (
      Boolean(runtime?.activeRunId || runtime?.runId) &&
      status !== ACTIVE_RUN_STATUS.IDLE &&
      status !== ACTIVE_RUN_STATUS.FINISHED
    ) ||
    runtime?.backgroundTaskStatus === "started" ||
    runtime?.backgroundStarted === true ||
    isNativeNotificationActive(runtime?.nativeNotificationState) ||
    Boolean(runtime?.offlineRun && !["FINISHED", "COMPLETED", "CANCELLED"].includes(String(runtime.offlineRun.status || "").toUpperCase())) ||
    hasRecentEvidence(lastDeepLinkReceived) ||
    hasRecentEvidence(lastNotificationActionReceived)
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
  const [snapshot, offlineRun, nativeNotificationState] = await Promise.all([
    activeRunTrackingService.getActiveRunSnapshot?.().catch(() => null),
    loadActiveRun().catch(() => null),
    getNativeNotificationState().catch(() => null),
  ]);
  return buildRuntimeSnapshot({
    snapshot,
    offlineRun,
    nativeNotificationState,
    reason,
    reconciliationStatus: snapshot || offlineRun || isNativeNotificationActive(nativeNotificationState) ? "has_evidence" : "idle",
  });
}

function buildRecoverableEvidenceSnapshot(before = {}, error = null) {
  const runId =
    before.activeRunId ||
    before.runId ||
    before.offlineRun?.localRunId ||
    lastKnownActiveSnapshot?.activeRunId ||
    `recoverable_${Date.now().toString(36)}`;
  const startedAtMs = lastKnownActiveSnapshot?.startedAtMs || Date.now();
  return {
    ...(lastKnownActiveSnapshot || {}),
    activeRunId: runId,
    id: runId,
    localRunId: before.localRunId || before.offlineRun?.localRunId || lastKnownActiveSnapshot?.localRunId || runId,
    userId: lastKnownActiveSnapshot?.userId || "offline",
    mode: lastKnownActiveSnapshot?.mode || "free",
    status: ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
    startedAtMs,
    startedAt: lastKnownActiveSnapshot?.startedAt || new Date(startedAtMs).toISOString(),
    lastUpdatedAtMs: Date.now(),
    lastUpdatedAt: new Date().toISOString(),
    distanceMeters: Number(before.distanceMeters ?? lastKnownActiveSnapshot?.distanceMeters ?? 0) || 0,
    distance: Number(before.distanceMeters ?? lastKnownActiveSnapshot?.distanceMeters ?? 0) || 0,
    trustedPath: lastKnownActiveSnapshot?.trustedPath || [],
    path: lastKnownActiveSnapshot?.trustedPath || [],
    rawPath: lastKnownActiveSnapshot?.rawPath || [],
    rawPoints: lastKnownActiveSnapshot?.rawPath || [],
    routeSegments: lastKnownActiveSnapshot?.routeSegments || lastKnownActiveSnapshot?.segments || [],
    segments: lastKnownActiveSnapshot?.segments || lastKnownActiveSnapshot?.routeSegments || [],
    meta: {
      ...(lastKnownActiveSnapshot?.meta || {}),
      evidenceOnly: true,
      errorRecoverable: true,
      recoveryReason: before.recoveryReason || lastReconcileReason || "reconcile_failed",
      nativeNotificationActive: isNativeNotificationActive(before.nativeNotificationState),
      error: error?.message || String(error || ""),
    },
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
      const userId = options.userId || "offline";
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
        lastKnownActiveSnapshot = snapshot;
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

      if (isRuntimeActiveEvidence(before)) {
        const preserved = buildRecoverableEvidenceSnapshot(before, null);
        recordRunSnapshotEvent("RUN_RECONCILE_PRESERVED_ACTIVE_EVIDENCE", preserved, {
          reason: normalizedReason,
          canShowStartButton: false,
          nativeNotificationActive: isNativeNotificationActive(before.nativeNotificationState),
        });
        recordRunSnapshotEvent("RUN_ERROR_RECOVERABLE_ACTIVE_RUN", preserved, {
          reason: normalizedReason,
          canShowStartButton: false,
        });
        return {
          snapshot: preserved,
          source: "active_evidence",
          canShowStartButton: false,
          runtime: buildRuntimeSnapshot({
            snapshot: preserved,
            offlineRun: before.offlineRun,
            nativeNotificationState: before.nativeNotificationState,
            reason: normalizedReason,
            reconciliationStatus: "error_recoverable",
          }),
        };
      }

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
          offlineRun: before.offlineRun,
          reason: normalizedReason,
          reconciliationStatus: "idle",
        }),
      };
    } catch (error) {
      recordRunEvent("RUN_RECONCILE_FAILED", {
        reason: normalizedReason,
        error,
      });
      if (isRuntimeActiveEvidence(before)) {
        const preserved = buildRecoverableEvidenceSnapshot(before, error);
        activeRunTrackingService.setRunRuntimeSurfaceState?.({
          recoveryReason: normalizedReason,
        });
        recordRunSnapshotEvent("RUN_RECONCILE_PRESERVED_ACTIVE_EVIDENCE", preserved, {
          reason: normalizedReason,
          canShowStartButton: false,
          nativeNotificationActive: isNativeNotificationActive(before.nativeNotificationState),
        });
        recordRunSnapshotEvent("RUN_ERROR_RECOVERABLE_ACTIVE_RUN", preserved, {
          reason: normalizedReason,
          canShowStartButton: false,
        });
        return {
          snapshot: preserved,
          source: "preserved_active_evidence",
          error,
          canShowStartButton: false,
          runtime: buildRuntimeSnapshot({
            snapshot: preserved,
            offlineRun: before.offlineRun,
            nativeNotificationState: before.nativeNotificationState,
            reason: normalizedReason,
            reconciliationStatus: "error_recoverable",
          }),
        };
      }
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
