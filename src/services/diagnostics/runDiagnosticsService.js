import logger, { LOG_CATEGORIES, sanitizeLogContext } from "../../utils/logger.js";
import { getDiagnosticsConfig } from "../../config/diagnosticsConfig.js";
import {
  getErrorLogs,
  getLogsSummary,
  getRecentLogs,
} from "./logStorageService.js";

export const RUN_DIAGNOSTIC_EVENTS = Object.freeze({
  RUN_STARTED: "RUN_STARTED",
  RUN_START_FAILED: "RUN_START_FAILED",
  RUN_START_ATTEMPT: "RUN_START_ATTEMPT",
  LOCATION_PERMISSION_REQUESTED: "LOCATION_PERMISSION_REQUESTED",
  LOCATION_PERMISSION_GRANTED: "LOCATION_PERMISSION_GRANTED",
  LOCATION_PERMISSION_DENIED: "LOCATION_PERMISSION_DENIED",
  LOCATION_WATCHER_STARTED: "LOCATION_WATCHER_STARTED",
  LOCATION_WATCHER_STOPPED: "LOCATION_WATCHER_STOPPED",
  LOCATION_WATCHER_RESTARTED: "LOCATION_WATCHER_RESTARTED",
  LOCATION_POINT_RECEIVED: "LOCATION_POINT_RECEIVED",
  LOCATION_POINT_ACCEPTED: "LOCATION_POINT_ACCEPTED",
  LOCATION_POINT_REJECTED: "LOCATION_POINT_REJECTED",
  ACTIVE_RUN_SAVED: "ACTIVE_RUN_SAVED",
  ACTIVE_RUN_SAVE_FAILED: "ACTIVE_RUN_SAVE_FAILED",
  ACTIVE_RUN_EMPTY_OVERWRITE_BLOCKED: "ACTIVE_RUN_EMPTY_OVERWRITE_BLOCKED",
  ACTIVE_RUN_DISTANCE_REGRESSION_BLOCKED: "ACTIVE_RUN_DISTANCE_REGRESSION_BLOCKED",
  ACTIVE_RUN_STALE_CHECKPOINT_IGNORED: "ACTIVE_RUN_STALE_CHECKPOINT_IGNORED",
  APP_BACKGROUND: "APP_BACKGROUND",
  APP_ACTIVE: "APP_ACTIVE",
  RECOVERY_STARTED: "RECOVERY_STARTED",
  RECOVERY_LOADED_ACTIVE_RUN: "RECOVERY_LOADED_ACTIVE_RUN",
  RECOVERY_MERGED_STATE: "RECOVERY_MERGED_STATE",
  RECOVERY_COMPLETED: "RECOVERY_COMPLETED",
  RECOVERY_FAILED: "RECOVERY_FAILED",
  MAP_ROUTE_HYDRATED: "MAP_ROUTE_HYDRATED",
  MAP_ROUTE_RENDERED: "MAP_ROUTE_RENDERED",
  MAP_ROUTE_PRESERVED: "MAP_ROUTE_PRESERVED",
  MAP_GEOJSON_REBUILT: "MAP_GEOJSON_REBUILT",
  MAP_ERROR: "MAP_ERROR",
  PAUSE_PRESSED: "PAUSE_PRESSED",
  PAUSE_SUCCESS: "PAUSE_SUCCESS",
  PAUSE_FAILED: "PAUSE_FAILED",
  RESUME_PRESSED: "RESUME_PRESSED",
  RESUME_SUCCESS: "RESUME_SUCCESS",
  RESUME_FAILED: "RESUME_FAILED",
  FINISH_PRESSED: "FINISH_PRESSED",
  FINISH_SUCCESS: "FINISH_SUCCESS",
  FINISH_FAILED: "FINISH_FAILED",
  RUN_SAVED_LOCAL: "RUN_SAVED_LOCAL",
  RUN_SYNC_QUEUED: "RUN_SYNC_QUEUED",
  RUN_SYNC_SUCCESS: "RUN_SYNC_SUCCESS",
  RUN_SYNC_FAILED: "RUN_SYNC_FAILED",
});

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function latestTimestampFromPoints(points = []) {
  const last = toArray(points).slice(-1)[0];
  return last?.timestamp || last?.time || last?.t || null;
}

function countSegmentPoints(segments = [], keyCandidates = ["trustedPath", "filteredPoints", "path"]) {
  return toArray(segments).reduce((total, segment) => {
    if (Array.isArray(segment)) return total + segment.length;
    for (const key of keyCandidates) {
      if (Array.isArray(segment?.[key])) return total + segment[key].length;
    }
    return total;
  }, 0);
}

export function summarizeRunSnapshot(snapshot = {}, extra = {}) {
  const segments = toArray(snapshot.routeSegments || snapshot.segments);
  const trustedPoints = toArray(snapshot.trustedPath || snapshot.filteredPoints || snapshot.points || snapshot.path);
  const rawPoints = toArray(snapshot.rawPath || snapshot.rawPoints);
  const displayPoints = toArray(snapshot.displayPoints || snapshot.liveRenderPath || snapshot.renderPath || snapshot.displayPath);
  const durationMs = Number(
    snapshot.durationMs ??
      (Number(snapshot.durationSeconds ?? snapshot.duration) || 0) * 1000 ??
      0
  ) || 0;

  return sanitizeLogContext({
    runId: snapshot.activeRunId || snapshot.runId || snapshot.id || extra.runId || null,
    localRunId: snapshot.localRunId || extra.localRunId || null,
    status: snapshot.status || extra.status || null,
    segmentsCount: segments.length,
    rawPointsCount: rawPoints.length || countSegmentPoints(segments, ["rawPath", "rawPoints"]),
    trustedPointsCount: trustedPoints.length || countSegmentPoints(segments),
    displayPointsCount: displayPoints.length || countSegmentPoints(segments, ["displayPoints", "liveRenderPath", "summaryRenderPath"]),
    distance: Number(snapshot.distanceMeters ?? snapshot.distance ?? extra.distance ?? 0) || 0,
    elapsedMs: durationMs || Number(extra.elapsedMs || 0) || 0,
    lastLocationAt: extra.lastLocationAt || latestTimestampFromPoints(trustedPoints) || latestTimestampFromPoints(rawPoints),
    watcherStatus: extra.watcherStatus || snapshot.watcherStatus || null,
    backgroundTaskStatus: extra.backgroundTaskStatus || snapshot.backgroundTaskStatus || null,
    appState: extra.appState || snapshot.appState || null,
  });
}

function categoryForRunEvent(event = "") {
  if (event.startsWith("LOCATION_PERMISSION")) return LOG_CATEGORIES.PERMISSION;
  if (event.startsWith("LOCATION_")) return LOG_CATEGORIES.LOCATION;
  if (event.startsWith("APP_")) return LOG_CATEGORIES.APP_STATE;
  if (event.startsWith("RECOVERY_")) return LOG_CATEGORIES.RUN_RECOVERY;
  if (event.startsWith("MAP_")) return LOG_CATEGORIES.MAP;
  if (event.startsWith("RUN_SYNC_")) return LOG_CATEGORIES.SYNC;
  if (event.startsWith("ACTIVE_RUN_") || event === "RUN_SAVED_LOCAL") return LOG_CATEGORIES.STORAGE;
  if (event.startsWith("PAUSE_") || event.startsWith("RESUME_") || event.startsWith("FINISH_")) return LOG_CATEGORIES.UI_ACTION;
  if (event.includes("WATCHER")) return LOG_CATEGORIES.RUN_TRACKING;
  return LOG_CATEGORIES.RUN_SESSION;
}

function levelForRunEvent(event = "", context = {}) {
  if (context.level) return context.level;
  if (event.endsWith("_FAILED") || event === "MAP_ERROR") return "error";
  if (
    event.endsWith("_DENIED") ||
    event.endsWith("_REJECTED") ||
    event.endsWith("_IGNORED") ||
    event.includes("_BLOCKED")
  ) {
    return "warn";
  }
  if (event === "LOCATION_POINT_RECEIVED") return "debug";
  return "info";
}

export function recordRunEvent(event, context = {}, options = {}) {
  const name = String(event || "RUN_EVENT").toUpperCase();
  const category = options.category || categoryForRunEvent(name);
  const level = levelForRunEvent(name, context);
  const payload = sanitizeLogContext({
    runEvent: name,
    ...context,
  });
  return logger[level]?.(category, name, payload, options) || logger.info(category, name, payload, options);
}

export function recordRunSnapshotEvent(event, snapshot = {}, context = {}, options = {}) {
  return recordRunEvent(event, {
    ...summarizeRunSnapshot(snapshot, context),
    ...context,
  }, options);
}

export function recordLocationPointEvent(event, point = {}, context = {}, options = {}) {
  return recordRunEvent(event, {
    point,
    accuracy: point?.accuracy ?? point?.coords?.accuracy ?? null,
    timestamp: point?.timestamp ?? null,
    source: point?.source || point?.provider || null,
    ...context,
  }, options);
}

async function safePermissionSummary() {
  try {
    const permissions = await import("../permissions.js");
    const [foreground, background] = await Promise.all([
      permissions.checkLocationPermission?.().catch(() => null),
      permissions.checkBackgroundLocationPermission?.().catch(() => null),
    ]);
    return sanitizeLogContext({ foreground, background });
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

async function safeActiveRunSummary() {
  try {
    const runtimeModule = await import("../runTracking/activeRunRuntimeService.js");
    const runtimeService = runtimeModule.default || runtimeModule;
    const runtime = await runtimeService.getActiveRunRuntimeSnapshot?.("diagnostics_export");
    return sanitizeLogContext(runtime || {});
  } catch (error) {
    try {
      const module = await import("../runTracking/activeRunTrackingService.js");
      const service = module.default || module;
      const snapshot = await service.getActiveRunSnapshot?.();
      const runtime = service.getTrackingRuntimeStatus?.() || {};
      return summarizeRunSnapshot(snapshot || {}, runtime);
    } catch (fallbackError) {
      return { error: fallbackError?.message || error?.message || String(error) };
    }
  }
}

async function safeStorageSummary() {
  try {
    const offline = await import("../runOfflineStorageService.js");
    const tracking = await import("../runTracking/activeRunTrackingService.js");
    const trackingService = tracking.default || tracking;
    const activeRun = await offline.loadActiveRun?.();
    const canonical = await trackingService.getActiveRunStorageDiagnostics?.();
    const logs = await getLogsSummary();
    return sanitizeLogContext({
      logs,
      canonical,
      activeRun: activeRun
        ? {
            localRunId: activeRun.localRunId || null,
            status: activeRun.status || null,
            syncStatus: activeRun.syncStatus || null,
            pointsCount: toArray(activeRun.points).length,
            segmentsCount: toArray(activeRun.segments).length,
            distanceMeters: Number(activeRun.distanceMeters || 0),
            checkpointAt: activeRun.checkpointAt || null,
          }
        : null,
    });
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

async function safeWatcherSummary() {
  try {
    const runtimeModule = await import("../runTracking/activeRunRuntimeService.js");
    const runtimeService = runtimeModule.default || runtimeModule;
    return sanitizeLogContext(await runtimeService.getActiveRunRuntimeSnapshot?.("watcher_summary"));
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

export async function exportDiagnosticsBundle(options = {}) {
  const limit = Number(options.limit || 300);
  const diagnosticsConfig = getDiagnosticsConfig();
  const [logs, errorLogs, activeRun, storage, permissions, watcher] = await Promise.all([
    getRecentLogs(limit),
    getErrorLogs(),
    safeActiveRunSummary(),
    safeStorageSummary(),
    safePermissionSummary(),
    safeWatcherSummary(),
  ]);

  return sanitizeLogContext({
    metadata: {
      app: "Wayper",
      timestamp: new Date().toISOString(),
      environment: typeof __DEV__ === "undefined" || __DEV__ ? "dev" : "prod",
      bundleVersion: 1,
      preciseLocationLogsEnabled: diagnosticsConfig.allowPreciseLocationLogs === true,
      locationPrecisionMode: diagnosticsConfig.locationPrecisionMode,
    },
    platform: logs[logs.length - 1]?.platform || "unknown",
    timestamp: new Date().toISOString(),
    logs,
    errorLogs,
    activeRun,
    storage,
    permissions,
    watcher,
    backgroundTask: watcher?.backgroundTaskStatus || watcher?.backgroundStarted || null,
    foregroundWatcher: watcher?.foregroundWatcherStatus || null,
    notification: watcher?.notificationStatus || null,
    nativeNotificationState: watcher?.nativeNotificationState || activeRun?.nativeNotificationState || null,
    lastDeepLinkReceived: watcher?.lastDeepLinkReceived || null,
    lastNotificationActionReceived: watcher?.lastNotificationActionReceived || null,
    rejectionSummary: {
      rejectedPointsCount: activeRun?.rejectedPointsCount || watcher?.rejectedPointsCount || 0,
      acceptedPointsCount: activeRun?.acceptedPointsCount || watcher?.acceptedPointsCount || 0,
    },
    routeChunks: {
      chunksCount: activeRun?.routeChunksCount || watcher?.routeChunksCount || storage?.canonical?.routeChunks?.chunksCount || storage?.canonical?.meta?.routeChunksCount || 0,
      routeChunksIndex: activeRun?.routeChunksIndex || watcher?.routeChunksIndex || null,
      storage: storage?.canonical?.routeChunks || storage?.canonical || null,
    },
    activeEvidence: {
      recoveryReason: activeRun?.recoveryReason || watcher?.recoveryReason || null,
      reconciliationStatus: activeRun?.reconciliationStatus || watcher?.reconciliationStatus || null,
      canShowStartButton: activeRun?.canShowStartButton ?? watcher?.canShowStartButton ?? null,
    },
  });
}

export default {
  RUN_DIAGNOSTIC_EVENTS,
  exportDiagnosticsBundle,
  recordLocationPointEvent,
  recordRunEvent,
  recordRunSnapshotEvent,
  summarizeRunSnapshot,
};
