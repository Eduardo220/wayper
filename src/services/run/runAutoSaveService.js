import NetInfo from "@react-native-community/netinfo";
import activeRunTrackingService from "../runTracking/activeRunTrackingService.js";
import { calculateActiveRunDurationSeconds } from "../runTracking/activeRunState.js";
import {
  ACTIVE_RUN_STATUS as OFFLINE_RUN_STATUS,
  ACTIVE_RUN_SYNC_STATUS,
  saveActiveRunSnapshot,
  toAppRunMode,
} from "../runOfflineStorageService.js";
import logger, { LOG_CATEGORIES } from "../../utils/logger.js";
import {
  recordRunEvent,
  recordRunSnapshotEvent,
} from "../diagnostics/runDiagnosticsService.js";

const LOG_PREFIX = "[Wayper RunAutoSave]";

let handlersInstalled = false;
let previousErrorHandler = null;
let checkpointUnsubscribe = null;
let checkpointErrorUnsubscribe = null;
let checkpointInterval = null;
let checkpointInFlight = false;
let checkpointPendingContext = null;
let lastCheckpointAt = 0;
let lastLocationErrorCheckpointAt = 0;

const isDev = () => typeof __DEV__ !== "undefined" && __DEV__;

function log(event, payload = {}) {
  if (!isDev()) return;
  logger.debug(LOG_CATEGORIES.STORAGE, `${LOG_PREFIX} ${event}`, payload);
}

function toOfflineMode(mode = "free") {
  return mode === "territory" || mode === "zones" ? "territory" : "free";
}

function toOfflineStatus(status) {
  const raw = String(status || "").toUpperCase();
  if (raw === "PAUSED") return OFFLINE_RUN_STATUS.PAUSED;
  if (raw === "FINISHING") return OFFLINE_RUN_STATUS.FINISHED;
  if (raw === "FINISHED" || raw === "COMPLETED") return OFFLINE_RUN_STATUS.FINISHED;
  if (raw === "PENDING_SYNC" || raw === "SYNC_FAILED") return raw;
  return OFFLINE_RUN_STATUS.RUNNING;
}

function isTerminalTrackingStatus(status) {
  const raw = String(status || "").toUpperCase();
  return raw === "FINISHED" || raw === "COMPLETED" || raw === "CANCELLED";
}

function canCheckpointTerminalSnapshot(context = {}) {
  return (
    context.allowTerminal === true ||
    context.event === "run_finished_snapshot_saved" ||
    context.reason === "before_finish" ||
    context.reason === "finish"
  );
}

async function getNetworkSnapshot() {
  try {
    const state = await NetInfo.fetch();
    return {
      isConnected: Boolean(state.isConnected),
      isInternetReachable: state.isInternetReachable !== false,
    };
  } catch {
    return {
      isConnected: true,
      isInternetReachable: true,
    };
  }
}

export function buildOfflineCheckpointFromTrackingSnapshot(snapshot = {}, context = {}) {
  if (!snapshot?.activeRunId) return null;

  const points = Array.isArray(snapshot.trustedPath)
    ? snapshot.trustedPath
    : Array.isArray(snapshot.points)
      ? snapshot.points
      : Array.isArray(snapshot.path)
        ? snapshot.path
        : [];
  const rawPoints = Array.isArray(snapshot.rawPath)
    ? snapshot.rawPath
    : Array.isArray(snapshot.rawPoints)
      ? snapshot.rawPoints
      : points;
  const checkpointAtMs = Number(context.checkpointAtMs || Date.now());
  const checkpointAt = new Date(checkpointAtMs).toISOString();
  const liveDurationSeconds = calculateActiveRunDurationSeconds(snapshot, { nowMs: checkpointAtMs });
  const durationMs = Number(
    context.durationMs ??
      liveDurationSeconds * 1000 ??
      snapshot.durationMs ??
      snapshot.durationSeconds * 1000 ??
      snapshot.duration * 1000 ??
      0
  ) || 0;
  const distanceMeters = Number(snapshot.distanceMeters ?? snapshot.distance ?? 0) || 0;
  const mode = toOfflineMode(snapshot.mode);
  const now = new Date().toISOString();

  return {
    localRunId: String(snapshot.activeRunId),
    remoteRunId: snapshot.remoteRunId,
    userId: snapshot.userId || "offline",
    mode,
    status: toOfflineStatus(snapshot.status),
    syncStatus: ACTIVE_RUN_SYNC_STATUS.LOCAL_ONLY,
    startedAt: snapshot.startedAt || now,
    endedAt: snapshot.finishedAt || snapshot.endedAt,
    pausedAt: snapshot.pausedAt || null,
    totalPausedTime: snapshot.totalPausedTime ?? snapshot.pausedDurationMs ?? null,
    durationMs,
    movingDurationMs: Number(snapshot.movingDurationMs ?? durationMs) || durationMs,
    distanceMeters,
    pace: snapshot.pace ?? snapshot.paceSecondsPerKm,
    averageSpeed: snapshot.averageSpeed ?? snapshot.avgSpeed,
    maxSpeed: snapshot.maxSpeed,
    points,
    rawPoints,
    lastValidPoint: snapshot.currentLocation || points[points.length - 1] || null,
    segments: snapshot.routeSegments || snapshot.segments || [],
    territoryData: mode === "territory" ? { pendingCalculation: true } : undefined,
    pendingSync: true,
    permissions: snapshot.permissions || snapshot.meta?.permissions || context.permissions || null,
    network: snapshot.network || snapshot.meta?.network || context.network || null,
    appState: context.appState || null,
    finalRunData: snapshot.finalRunData,
    schemaVersion: 1,
    checkpointAt,
    checkpointAtMs,
    updatedAt: now,
  };
}

export async function flushActiveRunCheckpoint(context = {}) {
  try {
    const snapshot = await activeRunTrackingService.getActiveRunSnapshot?.();
    if (!snapshot?.activeRunId) return null;
    if (isTerminalTrackingStatus(snapshot.status) && !canCheckpointTerminalSnapshot(context)) {
      recordRunEvent("ACTIVE_RUN_TERMINAL_CHECKPOINT_SKIPPED", {
        runId: snapshot.activeRunId,
        status: snapshot.status,
        reason: context.reason || "manual",
        event: context.event || null,
      });
      return null;
    }

    const network = context.network || (await getNetworkSnapshot());
    const checkpoint = buildOfflineCheckpointFromTrackingSnapshot(snapshot, {
      ...context,
      network,
    });
    if (!checkpoint) return null;

    const saved = await saveActiveRunSnapshot(checkpoint);
    log("checkpoint_flushed", {
      localRunId: saved?.localRunId,
      status: saved?.status,
      points: saved?.points?.length || 0,
      reason: context.reason || "manual",
    });
    recordRunSnapshotEvent("ACTIVE_RUN_SAVED", saved, {
      source: "auto_checkpoint",
      reason: context.reason || "manual",
    });
    return saved;
  } catch (error) {
    log("checkpoint_flush_failed", {
      reason: context.reason || "manual",
      error: error?.message || String(error),
    });
    recordRunEvent("ACTIVE_RUN_SAVE_FAILED", {
      source: "auto_checkpoint",
      reason: context.reason || "manual",
      error,
    });
    return null;
  }
}

export async function checkpointOnCaughtError(error, context = {}) {
  recordRunEvent("ACTIVE_RUN_SAVE_FAILED", {
    source: "caught_error_checkpoint",
    reason: context.reason || "caught_js_error",
    error,
  });
  return flushActiveRunCheckpoint({
    ...context,
    reason: context.reason || "caught_js_error",
    errorName: error?.name || null,
  });
}

export function installGlobalRunErrorHandlers() {
  if (handlersInstalled) return () => {};
  handlersInstalled = true;

  try {
    const errorUtils = globalThis.ErrorUtils;
    if (errorUtils?.getGlobalHandler && errorUtils?.setGlobalHandler) {
      previousErrorHandler = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((error, isFatal) => {
        flushActiveRunCheckpoint({
          reason: isFatal ? "fatal_js_error" : "global_js_error",
        }).finally(() => {
          if (typeof previousErrorHandler === "function") {
            previousErrorHandler(error, isFatal);
          } else {
            throw error;
          }
        });
      });
    }
  } catch (error) {
    log("error_handler_install_failed", { error: error?.message || String(error) });
  }

  try {
    const previousUnhandled = globalThis.onunhandledrejection;
    globalThis.onunhandledrejection = (event) => {
      flushActiveRunCheckpoint({ reason: "unhandled_promise_rejection" });
      if (typeof previousUnhandled === "function") previousUnhandled(event);
    };
  } catch {}

  log("error_handlers_installed");
  logger.info(LOG_CATEGORIES.UNKNOWN, "RUN_ERROR_HANDLERS_INSTALLED", {
    checkpointEnabled: true,
  });
  return () => {};
}

export async function forceCheckpointForAppState(appState) {
  recordRunEvent(appState === "active" ? "APP_ACTIVE" : "APP_BACKGROUND", {
    appState,
  });
  return flushActiveRunCheckpoint({
    reason: "app_state",
    appState,
  });
}

function shouldForceCheckpointForEvent(event) {
  return [
    "run_started",
    "run_paused",
    "run_resumed",
    "run_finished_snapshot_saved",
    "active_snapshot_cleared",
    "run_cancelled",
  ].includes(event);
}

async function flushQueuedCheckpoint(context = {}) {
  if (checkpointInFlight) {
    checkpointPendingContext = {
      ...(checkpointPendingContext || {}),
      ...context,
    };
    return null;
  }

  checkpointInFlight = true;
  try {
    lastCheckpointAt = Date.now();
    return await flushActiveRunCheckpoint(context);
  } finally {
    checkpointInFlight = false;
    const pending = checkpointPendingContext;
    checkpointPendingContext = null;
    if (pending) {
      flushQueuedCheckpoint(pending).catch((error) => {
        log("queued_checkpoint_failed", {
          reason: pending.reason || "queued",
          error: error?.message || String(error),
        });
      });
    }
  }
}

export async function checkpointOnLocationError(error, context = {}) {
  const now = Date.now();
  const minIntervalMs = Number(context.minIntervalMs ?? 8000);
  if (now - lastLocationErrorCheckpointAt < minIntervalMs) return null;
  lastLocationErrorCheckpointAt = now;
  return flushQueuedCheckpoint({
    ...context,
    reason: context.reason || "location_error",
    checkpointAtMs: now,
    errorName: error?.name || null,
  });
}

export function startActiveRunAutoCheckpointing(options = {}) {
  if (checkpointUnsubscribe) return stopActiveRunAutoCheckpointing;

  const minIntervalMs = Number(options.minIntervalMs ?? 1500);
  const periodicIntervalMs = Number(options.periodicIntervalMs ?? 10000);
  checkpointUnsubscribe = activeRunTrackingService.onActiveRunSnapshot?.(({ event, snapshot }) => {
    if (!snapshot?.activeRunId) return;

    const now = Date.now();
    const force = shouldForceCheckpointForEvent(event);
    if (!force && now - lastCheckpointAt < minIntervalMs) {
      checkpointPendingContext = {
        reason: "tracking_snapshot_throttled",
        event,
      };
      return;
    }

    flushQueuedCheckpoint({
      reason: "tracking_snapshot",
      event,
    }).catch((error) => {
      log("auto_checkpoint_failed", {
        event,
        error: error?.message || String(error),
      });
    });
  }) || null;

  checkpointErrorUnsubscribe = activeRunTrackingService.onActiveRunError?.(({ error, context }) => {
    flushQueuedCheckpoint({
      reason: "tracking_error",
      checkpointAtMs: Date.now(),
      errorName: error?.name || null,
      source: context?.fn || null,
    }).catch((checkpointError) => {
      log("tracking_error_checkpoint_failed", {
        error: checkpointError?.message || String(checkpointError),
      });
    });
  }) || null;

  if (periodicIntervalMs > 0) {
    checkpointInterval = setInterval(() => {
      flushQueuedCheckpoint({
        reason: "periodic_active_run",
        checkpointAtMs: Date.now(),
      }).catch((error) => {
        log("periodic_checkpoint_failed", {
          error: error?.message || String(error),
        });
      });
    }, periodicIntervalMs);
  }

  log("auto_checkpoint_started");
  return stopActiveRunAutoCheckpointing;
}

export function stopActiveRunAutoCheckpointing() {
  if (checkpointUnsubscribe) {
    try {
      checkpointUnsubscribe();
    } catch {}
    checkpointUnsubscribe = null;
  }
  if (checkpointErrorUnsubscribe) {
    try {
      checkpointErrorUnsubscribe();
    } catch {}
    checkpointErrorUnsubscribe = null;
  }
  if (checkpointInterval) {
    clearInterval(checkpointInterval);
    checkpointInterval = null;
  }
  checkpointInFlight = false;
  checkpointPendingContext = null;
  lastCheckpointAt = 0;
  lastLocationErrorCheckpointAt = 0;
  log("auto_checkpoint_stopped");
}

export function getAppRunModeFromCheckpoint(checkpoint = {}) {
  return toAppRunMode(checkpoint.mode || "free");
}

export default {
  buildOfflineCheckpointFromTrackingSnapshot,
  checkpointOnLocationError,
  checkpointOnCaughtError,
  flushActiveRunCheckpoint,
  forceCheckpointForAppState,
  getAppRunModeFromCheckpoint,
  installGlobalRunErrorHandlers,
  startActiveRunAutoCheckpointing,
  stopActiveRunAutoCheckpointing,
};
