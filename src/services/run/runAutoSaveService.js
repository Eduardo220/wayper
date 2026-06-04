import NetInfo from "@react-native-community/netinfo";
import activeRunTrackingService from "../runTracking/activeRunTrackingService.js";
import {
  ACTIVE_RUN_STATUS as OFFLINE_RUN_STATUS,
  ACTIVE_RUN_SYNC_STATUS,
  saveActiveRunSnapshot,
  toAppRunMode,
} from "../runOfflineStorageService.js";

const LOG_PREFIX = "[Wayper RunAutoSave]";

let handlersInstalled = false;
let previousErrorHandler = null;

const isDev = () => typeof __DEV__ !== "undefined" && __DEV__;

function log(event, payload = {}) {
  if (!isDev()) return;
  try {
    console.log(`${LOG_PREFIX} ${event}`, payload);
  } catch {}
}

function toOfflineMode(mode = "free") {
  return mode === "territory" || mode === "zones" ? "territory" : "free";
}

function toOfflineStatus(status) {
  const raw = String(status || "").toUpperCase();
  if (raw === "PAUSED") return OFFLINE_RUN_STATUS.PAUSED;
  if (raw === "FINISHED" || raw === "COMPLETED") return OFFLINE_RUN_STATUS.FINISHED;
  if (raw === "PENDING_SYNC" || raw === "SYNC_FAILED") return raw;
  return OFFLINE_RUN_STATUS.RUNNING;
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
  const durationMs = Number(snapshot.durationMs ?? snapshot.durationSeconds * 1000 ?? snapshot.duration * 1000 ?? 0) || 0;
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
    updatedAt: now,
  };
}

export async function flushActiveRunCheckpoint(context = {}) {
  try {
    const snapshot = await activeRunTrackingService.getActiveRunSnapshot?.();
    if (!snapshot?.activeRunId) return null;

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
    return saved;
  } catch (error) {
    log("checkpoint_flush_failed", {
      reason: context.reason || "manual",
      error: error?.message || String(error),
    });
    return null;
  }
}

export async function checkpointOnCaughtError(error, context = {}) {
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
  return () => {};
}

export async function forceCheckpointForAppState(appState) {
  return flushActiveRunCheckpoint({
    reason: "app_state",
    appState,
  });
}

export function getAppRunModeFromCheckpoint(checkpoint = {}) {
  return toAppRunMode(checkpoint.mode || "free");
}

export default {
  buildOfflineCheckpointFromTrackingSnapshot,
  checkpointOnCaughtError,
  flushActiveRunCheckpoint,
  forceCheckpointForAppState,
  getAppRunModeFromCheckpoint,
  installGlobalRunErrorHandlers,
};
