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
  RUN_START_REQUESTED: "RUN_START_REQUESTED",
  RUN_COUNTDOWN_STARTED: "RUN_COUNTDOWN_STARTED",
  RUN_RESTORE_STARTED: "RUN_RESTORE_STARTED",
  RUN_RESTORE_COMPLETED: "RUN_RESTORE_COMPLETED",
  APP_KILLED_OR_COLD_START_DETECTED: "APP_KILLED_OR_COLD_START_DETECTED",
  ACTIVE_RUN_RECOVERED_FROM_STORAGE: "ACTIVE_RUN_RECOVERED_FROM_STORAGE",
  ACTIVE_RUN_MISSING_AFTER_FOREGROUND: "ACTIVE_RUN_MISSING_AFTER_FOREGROUND",
  EMERGENCY_RUN_DIAGNOSTIC_SNAPSHOT: "EMERGENCY_RUN_DIAGNOSTIC_SNAPSHOT",
  RUN_EMERGENCY_DIAGNOSTICS_EXPORT_STARTED: "RUN_EMERGENCY_DIAGNOSTICS_EXPORT_STARTED",
  RUN_EMERGENCY_DIAGNOSTICS_EXPORT_SUCCESS: "RUN_EMERGENCY_DIAGNOSTICS_EXPORT_SUCCESS",
  RUN_EMERGENCY_DIAGNOSTICS_EXPORT_FAILED: "RUN_EMERGENCY_DIAGNOSTICS_EXPORT_FAILED",
  RUN_EMERGENCY_DIAGNOSTICS_LONG_PRESS: "RUN_EMERGENCY_DIAGNOSTICS_LONG_PRESS",
  RUN_UI_HEARTBEAT: "RUN_UI_HEARTBEAT",
  RUN_UI_TIMER_STALL: "RUN_UI_TIMER_STALL",
  RUN_UI_STALL: "RUN_UI_STALL",
  RUN_UI_POSSIBLE_FREEZE_DETECTED: "RUN_UI_POSSIBLE_FREEZE_DETECTED",
  MAP_RENDER_STALL_DETECTED: "MAP_RENDER_STALL_DETECTED",
  RUN_DRAWER_OPEN_REQUESTED: "RUN_DRAWER_OPEN_REQUESTED",
  RUN_DRAWER_OPENED: "RUN_DRAWER_OPENED",
  RUN_DRAWER_OPEN_TIMEOUT: "RUN_DRAWER_OPEN_TIMEOUT",
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
  CANONICAL_SNAPSHOT_APPLIED: "CANONICAL_SNAPSHOT_APPLIED",
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
  RUN_SAVE_STARTED: "RUN_SAVE_STARTED",
  RUN_SAVE_FAILED: "RUN_SAVE_FAILED",
  RUN_SAVED_LOCAL: "RUN_SAVED_LOCAL",
  RUN_SYNC_STARTED: "RUN_SYNC_STARTED",
  RUN_SYNC_QUEUED: "RUN_SYNC_QUEUED",
  RUN_SYNC_SUCCESS: "RUN_SYNC_SUCCESS",
  RUN_SYNC_FAILED: "RUN_SYNC_FAILED",
  RUN_SYNC_COMPLETED: "RUN_SYNC_COMPLETED",
});

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactStatus(value) {
  return value == null ? null : String(value);
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
  if (event === "ACTIVE_RUN_MISSING_AFTER_FOREGROUND") return LOG_CATEGORIES.APP_STATE;
  if (event === "ACTIVE_RUN_RECOVERED_FROM_STORAGE") return LOG_CATEGORIES.RUN_RECOVERY;
  if (event.startsWith("APP_")) return LOG_CATEGORIES.APP_STATE;
  if (event.startsWith("RECOVERY_") || event.startsWith("RUN_RESTORE_") || event.startsWith("RUN_REHYDRATE_") || event.startsWith("RUN_RECONCILE_")) return LOG_CATEGORIES.RUN_RECOVERY;
  if (event.startsWith("MAP_")) return LOG_CATEGORIES.MAP;
  if (event.startsWith("RUN_NOTIFICATION_") || event.startsWith("RUN_OPENED_FROM_NOTIFICATION")) return LOG_CATEGORIES.NOTIFICATION;
  if (event.startsWith("RUN_BACKGROUND_TASK_")) return LOG_CATEGORIES.BACKGROUND;
  if (event.startsWith("RUN_SYNC_")) return LOG_CATEGORIES.SYNC;
  if (event.startsWith("RUN_DRAWER_") || event.includes("DIAGNOSTICS")) return LOG_CATEGORIES.UI_ACTION;
  if (event.startsWith("RUN_UI_")) return event.includes("STALL") ? LOG_CATEGORIES.PERFORMANCE : LOG_CATEGORIES.UI;
  if (event === RUN_DIAGNOSTIC_EVENTS.EMERGENCY_RUN_DIAGNOSTIC_SNAPSHOT) return LOG_CATEGORIES.RUN_SESSION;
  if (event.startsWith("ACTIVE_RUN_") || event.startsWith("RUN_SAVE_") || event === "RUN_SAVED_LOCAL") {
    return LOG_CATEGORIES.STORAGE;
  }
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

export function buildEmergencyRunDiagnosticsSnapshot(context = {}) {
  const snapshot = context.snapshot || context.activeRun || {};
  const runtime = context.runtime || {};
  const ui = context.ui || {};
  const pathCounts = context.pathCounts || {};
  const stallCounters = context.stallCounters || {};
  const discardedPointReasons = context.discardedPointReasons || context.topRejectReasons || {};
  const nowIso = new Date(context.nowMs || Date.now()).toISOString();

  return sanitizeLogContext({
    event: context.event || context.reason || null,
    trigger: context.trigger || null,
    runId: context.runId || runtime.runId || runtime.activeRunId || snapshot.activeRunId || snapshot.runId || null,
    localRunId: context.localRunId || runtime.localRunId || snapshot.localRunId || null,
    status: compactStatus(context.status || runtime.status || snapshot.status || null),
    elapsedMs: toSafeNumber(
      context.elapsedMs ??
        ui.elapsedMs ??
        runtime.elapsedMs ??
        snapshot.elapsedMs ??
        snapshot.durationMs ??
        ((runtime.elapsedSeconds ?? snapshot.durationSeconds ?? snapshot.duration) * 1000),
      0
    ),
    distanceMeters: toSafeNumber(
      context.distanceMeters ??
        ui.distanceMeters ??
        runtime.distanceMeters ??
        snapshot.distanceMeters ??
        snapshot.distance,
      0
    ),
    lastUiTickAt: context.lastUiTickAt || ui.lastUiTickAt || runtime.lastUiTickAt || null,
    lastLocationReceivedAt: context.lastLocationReceivedAt || runtime.lastRawPointReceivedAt || runtime.lastLocationReceivedAt || null,
    lastLocationAcceptedAt: context.lastLocationAcceptedAt || runtime.lastAcceptedPointAt || runtime.lastLocationAcceptedAt || null,
    lastRenderPathUpdatedAt: context.lastRenderPathUpdatedAt || ui.lastRenderPathUpdatedAt || runtime.lastRenderPathUpdatedAt || null,
    watcherStatus: context.watcherStatus || runtime.foregroundWatcherStatus || runtime.watcherStatus || null,
    backgroundTaskStatus: context.backgroundTaskStatus || runtime.backgroundTaskStatus || runtime.backgroundTaskProbe?.status || null,
    appState: context.appState || runtime.appState || null,
    notificationStatus: context.notificationStatus || runtime.notificationStatus || null,
    timerStatus: context.timerStatus || ui.timerStatus || runtime.timerStatus || null,
    snapshotUpdatedAt:
      context.snapshotUpdatedAt ||
      runtime.updatedAt ||
      runtime.lastUpdatedAt ||
      snapshot.updatedAt ||
      snapshot.lastUpdatedAt ||
      snapshot.checkpointAt ||
      null,
    pathCounts: {
      rawPointsCount: toSafeNumber(pathCounts.rawPointsCount ?? context.rawPointsCount ?? runtime.rawPointsCount, 0),
      trustedPointsCount: toSafeNumber(pathCounts.trustedPointsCount ?? context.trustedPointsCount ?? runtime.acceptedPointsCount, 0),
      renderPointsCount: toSafeNumber(pathCounts.renderPointsCount ?? context.renderPointsCount ?? runtime.displayPointsCount, 0),
      segmentsCount: toSafeNumber(pathCounts.segmentsCount ?? context.segmentsCount ?? runtime.segmentsCount, 0),
      routeChunksCount: toSafeNumber(pathCounts.routeChunksCount ?? context.routeChunksCount ?? runtime.routeChunksCount, 0),
    },
    discardedPointReasons,
    lastError: context.lastError || runtime.lastError || null,
    stallCounters: {
      ui: toSafeNumber(stallCounters.ui ?? stallCounters.uiStalls, 0),
      timer: toSafeNumber(stallCounters.timer ?? stallCounters.timerStalls, 0),
      watcher: toSafeNumber(stallCounters.watcher ?? stallCounters.watcherRestarts, 0),
      drawer: toSafeNumber(stallCounters.drawer ?? stallCounters.drawerTimeouts, 0),
    },
    screen: context.screen || null,
    updatedAt: nowIso,
    preciseCoordinatesIncluded: false,
  });
}

export function recordEmergencyRunDiagnosticsSnapshot(context = {}, options = {}) {
  return recordRunEvent(RUN_DIAGNOSTIC_EVENTS.EMERGENCY_RUN_DIAGNOSTIC_SNAPSHOT, {
    ...buildEmergencyRunDiagnosticsSnapshot(context),
  }, {
    category: LOG_CATEGORIES.RUN_SESSION,
    ...options,
    forcePersist: true,
  });
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

async function safeLocalDiagnosticsSummary(options = {}) {
  try {
    const module = await import("./localDiagnosticsService.js");
    return await module.buildLocalDiagnosticsSummary?.({
      logsLimit: options.limit || 300,
    });
  } catch (error) {
    return {
      ok: false,
      error: {
        message: error?.message || String(error),
      },
    };
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
  const relaxedDecisions = decisions.filter((log) => (
    typeof log.context?.acceptedByRelaxedFilter === "boolean"
  ));
  const acceptedByRelaxedFilter = relaxedDecisions.length > 0
    ? relaxedDecisions.filter((log) => log.context.acceptedByRelaxedFilter === true).length
    : null;
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

function latestByEvent(logs = [], eventName) {
  return [...logs].reverse().find((log) => log.event === eventName) || null;
}

export function buildEmergencyRunDiagnosticsReport(logs = []) {
  const emergencySnapshots = selectEvents(logs, (log) => (
    log.event === RUN_DIAGNOSTIC_EVENTS.EMERGENCY_RUN_DIAGNOSTIC_SNAPSHOT
  )).slice(-20);
  const uiInteractionEvents = selectEvents(logs, (log) => (
    String(log.event || "").startsWith("RUN_UI_") ||
    String(log.event || "").startsWith("RUN_DRAWER_") ||
    String(log.event || "").startsWith("RUN_EMERGENCY_DIAGNOSTICS_") ||
    ["PAUSE_PRESSED", "RESUME_PRESSED", "FINISH_PRESSED"].includes(log.event)
  )).slice(-60);
  const drawerOpenAttempts = logs.filter((log) => log.event === "RUN_DRAWER_OPEN_REQUESTED").length;
  const drawerOpenTimeouts = logs.filter((log) => log.event === "RUN_DRAWER_OPEN_TIMEOUT").length;
  const timerStalls = logs.filter((log) => log.event === "RUN_UI_TIMER_STALL").length;
  const uiStalls = logs.filter((log) => log.event === "RUN_UI_STALL").length;
  const latestSnapshot = emergencySnapshots[emergencySnapshots.length - 1] || null;
  const latestHeartbeat = latestByEvent(logs, "RUN_UI_HEARTBEAT");

  return sanitizeLogContext({
    latestSnapshot: latestSnapshot?.context || null,
    snapshots: emergencySnapshots,
    uiInteractionEvents,
    drawerOpenAttempts,
    drawerOpenTimeouts,
    lastDrawerOpenRequestedAt: latestByEvent(logs, "RUN_DRAWER_OPEN_REQUESTED")?.timestamp || null,
    lastDrawerOpenTimeoutAt: latestByEvent(logs, "RUN_DRAWER_OPEN_TIMEOUT")?.timestamp || null,
    lastUiHeartbeatAt: latestHeartbeat?.timestamp || latestSnapshot?.context?.lastUiTickAt || null,
    lastUiTickAt: latestSnapshot?.context?.lastUiTickAt || latestHeartbeat?.context?.lastUiTickAt || null,
    lastRenderPathUpdatedAt: latestSnapshot?.context?.lastRenderPathUpdatedAt || null,
    lastLocationReceivedAt: latestSnapshot?.context?.lastLocationReceivedAt || null,
    lastLocationAcceptedAt: latestSnapshot?.context?.lastLocationAcceptedAt || null,
    timerStatus: latestSnapshot?.context?.timerStatus || latestHeartbeat?.context?.timerStatus || null,
    watcherStatus: latestSnapshot?.context?.watcherStatus || null,
    notificationStatus: latestSnapshot?.context?.notificationStatus || null,
    appState: latestSnapshot?.context?.appState || null,
    pathCounts: latestSnapshot?.context?.pathCounts || null,
    discardedPointReasons: latestSnapshot?.context?.discardedPointReasons || {},
    stallCounters: {
      ui: uiStalls,
      timer: timerStalls,
      drawer: drawerOpenTimeouts,
      eventLoop: logs.filter((log) => String(log.event || "").includes("JS_EVENT_LOOP_STALL")).length,
    },
  });
}

export async function exportDiagnosticsBundle(options = {}) {
  const limit = Number(options.limit || 300);
  const diagnosticsConfig = getDiagnosticsConfig();
  const [logs, errorLogs, activeRun, storage, permissions, watcher, localDiagnostics] = await Promise.all([
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
    safeLocalDiagnosticsSummary({ limit }),
  ]);

  const gpsFilterReport = buildGpsFilterReport(logs);
  const emergencyRunDiagnostics = buildEmergencyRunDiagnosticsReport(logs);
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
    localDiagnostics,
    syncReport: localDiagnostics?.sync || {},
    permissionsReport: localDiagnostics?.permissions || permissions || {},
    storageReport: localDiagnostics?.storage || storage || {},
    notificationBackgroundReport: localDiagnostics?.notificationBackground || {},
    shareReport: localDiagnostics?.share || {},
    storiesFeedReport: localDiagnostics?.social || {},
    territoryReport: localDiagnostics?.territory || {},
    profileRankingXpReport: localDiagnostics?.profileRankingXp || {},
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
    emergencyRunDiagnostics,
    emergencyRunDiagnosticsSnapshots: emergencyRunDiagnostics.snapshots,
    latestEmergencyRunDiagnosticsSnapshot: emergencyRunDiagnostics.latestSnapshot,
    uiInteractionEvents: emergencyRunDiagnostics.uiInteractionEvents,
    stallCounters: emergencyRunDiagnostics.stallCounters,
    drawerMenuAttempts: {
      requested: emergencyRunDiagnostics.drawerOpenAttempts,
      timedOut: emergencyRunDiagnostics.drawerOpenTimeouts,
      lastRequestedAt: emergencyRunDiagnostics.lastDrawerOpenRequestedAt,
      lastTimeoutAt: emergencyRunDiagnostics.lastDrawerOpenTimeoutAt,
    },
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
  buildEmergencyRunDiagnosticsReport,
  buildEmergencyRunDiagnosticsSnapshot,
  recordLocationPointEvent,
  recordEmergencyRunDiagnosticsSnapshot,
  recordRunEvent,
  recordRunSnapshotEvent,
  summarizeRunSnapshot,
};
