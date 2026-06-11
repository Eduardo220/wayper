import logger, { LOG_CATEGORIES, sanitizeLogContext } from "../../utils/logger.js";
import { getDiagnosticsConfig } from "../../config/diagnosticsConfig.js";
import {
  getDiagnosticStorageHealth,
  getErrorLogs,
  getLogs,
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
  const logOptions = {
    ...options,
    forcePersist: options.forcePersist !== false,
  };
  return logger[level]?.(category, name, payload, logOptions) || logger.info(category, name, payload, logOptions);
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
    const [logs, diagnosticFiles] = await Promise.all([
      getLogsSummary(),
      getDiagnosticStorageHealth(),
    ]);
    return sanitizeLogContext({
      logs,
      diagnosticFiles,
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

function numericStats(values = []) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (numbers.length === 0) {
    return { count: 0, min: null, max: null, avg: null };
  }
  const sum = numbers.reduce((total, value) => total + value, 0);
  return {
    count: numbers.length,
    min: Math.min(...numbers),
    max: Math.max(...numbers),
    avg: sum / numbers.length,
  };
}

function pointTimestampMs(log = {}) {
  const value =
    log.context?.timestamp ??
    log.context?.point?.timestamp ??
    log.context?.receivedAt ??
    log.timestamp;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function longestGapMs(logs = []) {
  const timestamps = logs
    .map(pointTimestampMs)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  let longest = 0;
  for (let index = 1; index < timestamps.length; index += 1) {
    longest = Math.max(longest, timestamps[index] - timestamps[index - 1]);
  }
  return longest;
}

export function buildGpsFilterReport(logs = [], options = {}) {
  const rawEvents = logs.filter((log) => log.event === "LOCATION_POINT_RECEIVED");
  const acceptedEvents = logs.filter((log) => log.event === "LOCATION_POINT_ACCEPTED");
  const rejectedEvents = logs.filter((log) => log.event === "LOCATION_POINT_REJECTED");
  const decisions = [...acceptedEvents, ...rejectedEvents];
  const topRejectReasons = rejectedEvents.reduce((acc, log) => {
    const reason = String(log.context?.reason || "unknown");
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const acceptedByRelaxedFilter = decisions.filter((log) => (
    log.event === "LOCATION_POINT_ACCEPTED" ||
    log.context?.acceptedByRelaxedFilter === true
  )).length;
  const lastRawPointAtMs = rawEvents.map(pointTimestampMs).filter(Number.isFinite).sort((a, b) => b - a)[0] || null;
  const lastAcceptedPointAtMs = acceptedEvents.map(pointTimestampMs).filter(Number.isFinite).sort((a, b) => b - a)[0] || null;
  const nowMs = Number(options.nowMs || Date.now());

  return {
    rawPoints: rawEvents.length,
    rawGpsPointsReceived: rawEvents.length,
    acceptedByCurrentFilter: acceptedEvents.length,
    acceptedGpsPoints: acceptedEvents.length,
    rejectedByCurrentFilter: rejectedEvents.length,
    rejectedGpsPoints: rejectedEvents.length,
    acceptedByRelaxedFilter,
    topRejectReasons,
    longestGapBetweenAcceptedPointsMs: longestGapMs(acceptedEvents),
    longestGapBetweenRawPointsMs: longestGapMs(rawEvents),
    lastAcceptedPointAt: lastAcceptedPointAtMs ? new Date(lastAcceptedPointAtMs).toISOString() : null,
    lastRawPointAt: lastRawPointAtMs ? new Date(lastRawPointAtMs).toISOString() : null,
    timeSinceLastAcceptedPointMs: lastAcceptedPointAtMs ? Math.max(0, nowMs - lastAcceptedPointAtMs) : null,
    accuracyStats: numericStats(rawEvents.map((log) => log.context?.accuracy ?? log.context?.point?.accuracy)),
    speedStats: numericStats(rawEvents.map((log) => log.context?.point?.speed)),
    calculatedSpeedStats: numericStats(decisions.map((log) => log.context?.calculatedSpeedMps)),
    distanceFromPreviousStats: numericStats(decisions.map((log) => log.context?.distanceFromPreviousMeters)),
    elapsedFromPreviousStats: numericStats(decisions.map((log) => log.context?.elapsedFromPreviousMs)),
  };
}

function selectEvents(logs = [], matcher) {
  return logs.filter((log) => matcher(log)).map((log) => ({
    timestamp: log.timestamp,
    level: log.level,
    category: log.category,
    event: log.event,
    context: log.context,
  }));
}

export async function exportDiagnosticsBundle(options = {}) {
  const limit = Number(options.limit || 300);
  const diagnosticsConfig = getDiagnosticsConfig();
  const [logs, errorLogs, activeRun, storage, permissions, watcher] = await Promise.all([
    options.runId
      ? getLogs({ runId: options.runId, limit })
      : getRecentLogs(limit),
    options.runId
      ? getLogs({ runId: options.runId, minLevel: "error" })
      : getErrorLogs(),
    safeActiveRunSummary(),
    safeStorageSummary(),
    safePermissionSummary(),
    safeWatcherSummary(),
  ]);

  const gpsFilterReport = buildGpsFilterReport(logs);
  return sanitizeLogContext({
    metadata: {
      app: "Wayper",
      timestamp: new Date().toISOString(),
      environment: typeof __DEV__ === "undefined" || __DEV__ ? "dev" : "prod",
      bundleVersion: 2,
      requestedRunId: options.runId || null,
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
    appState: watcher?.appState || activeRun?.appState || null,
    screenFocusState: watcher?.screenFocusState || activeRun?.screenFocusState || null,
    backgroundTask: watcher?.backgroundTaskStatus || watcher?.backgroundStarted || null,
    foregroundWatcher: watcher?.foregroundWatcherStatus || null,
    notification: watcher?.notificationStatus || null,
    nativeNotificationState: watcher?.nativeNotificationState || activeRun?.nativeNotificationState || null,
    lastDeepLinkReceived: watcher?.lastDeepLinkReceived || null,
    lastNotificationActionReceived: watcher?.lastNotificationActionReceived || null,
    rejectionSummary: {
      rejectedPointsCount: gpsFilterReport.rejectedGpsPoints || activeRun?.rejectedPointsCount || watcher?.rejectedPointsCount || 0,
      acceptedPointsCount: gpsFilterReport.acceptedGpsPoints || activeRun?.acceptedPointsCount || watcher?.acceptedPointsCount || 0,
    },
    rawGpsPointsReceived: gpsFilterReport.rawGpsPointsReceived,
    acceptedGpsPoints: gpsFilterReport.acceptedGpsPoints,
    rejectedGpsPoints: gpsFilterReport.rejectedGpsPoints,
    topRejectReasons: gpsFilterReport.topRejectReasons,
    lastAcceptedPointAt: gpsFilterReport.lastAcceptedPointAt,
    lastRawPointAt: gpsFilterReport.lastRawPointAt,
    timeSinceLastAcceptedPointMs: gpsFilterReport.timeSinceLastAcceptedPointMs,
    accuracyStats: gpsFilterReport.accuracyStats,
    speedStats: gpsFilterReport.speedStats,
    distanceFromPreviousStats: gpsFilterReport.distanceFromPreviousStats,
    gpsFilterReport,
    backgroundTaskEvents: selectEvents(logs, (log) => (
      log.category === LOG_CATEGORIES.BACKGROUND ||
      log.event.includes("BACKGROUND_TASK") ||
      log.event.includes("WATCHER")
    )),
    taskCancelledOrRestartedEvents: selectEvents(logs, (log) => (
      log.event.includes("CANCELLED_OR_STOPPED") ||
      log.event.includes("WATCHER_RESTARTED") ||
      log.event.includes("WATCHER_STARTED")
    )),
    routeChunkEvents: selectEvents(logs, (log) => log.event.includes("ROUTE_CHUNK")),
    uiRenderEvents: selectEvents(logs, (log) => (
      log.event === "MAP_ROUTE_RENDERED" ||
      log.event === "MAP_GEOJSON_REBUILT" ||
      log.event.includes("UI_RENDER")
    )),
    freezeEvents: selectEvents(logs, (log) => (
      log.category === LOG_CATEGORIES.PERFORMANCE ||
      log.event.includes("ANR") ||
      log.event.includes("STALL") ||
      log.event.includes("SKIPPED_FRAME")
    )),
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
