import { useCallback } from "react";
import { WayperTheme } from "../theme/wayperTheme";
import {
  TRACKING_CONFIG,
  createTrackingSession,
  debugTracking,
  finalizeRoutePath,
  normalizeLocation,
} from "../services/runTracking";
import { recordLocation } from "../services/runTracking/activeRunTrackingService.js";
import {
  isForegroundWatcherActive,
  startForegroundWatcher,
  stopForegroundWatcher,
} from "../services/runTracking/activeRunForegroundWatcher.js";
import { setRuntimeSurfaceState } from "../services/runTracking/activeRunRuntimeService.js";
import { checkpointOnLocationError } from "../services/run/runAutoSaveService.js";
import { routeToZoneGeometry } from "../services/territory";
import { recordRunEvent } from "../services/diagnostics/runDiagnosticsService.js";
import { startBackgroundLocation, stopBackgroundLocation } from "./runBackgroundLocationControl.js";

const MAX_ACCURACY = TRACKING_CONFIG.GPS_ACCURACY_HARD_REJECT_M;
const MAX_SPEED = TRACKING_CONFIG.MAX_HUMAN_SPRINT_SPEED_KMH / 3.6;
const ZONE_PREVIEW_INTERVAL_MS = 5000;
const ZONE_PREVIEW_MIN_NEW_POINTS = 5;

function updateZonePreview(context, path = []) {
  if (!context.runningRef.current || context.modeRef.current !== "zones") return;
  const now = Date.now();
  if (now - context.zonePreviewLastAtRef.current < ZONE_PREVIEW_INTERVAL_MS) return;
  const count = Array.isArray(path) ? path.length : 0;
  if (count - context.zonePreviewLastPointCountRef.current < ZONE_PREVIEW_MIN_NEW_POINTS) return;
  context.zonePreviewLastAtRef.current = now;
  context.zonePreviewLastPointCountRef.current = count;
  const previewPath = finalizeRoutePath(path, {
    minPointDistanceM: 1,
    toleranceM: 2.8,
    spikeToleranceM: 6,
    maxPoints: 420,
    maxAccuracyM: MAX_ACCURACY,
    maxSpeedMps: MAX_SPEED,
    preserveTurns: true,
  });
  const built = routeToZoneGeometry(previewPath, {
    closeDistanceM: 32,
    maxCloseDistanceM: 48,
    minLoopPoints: 8,
    minDistanceM: 40,
    minAreaM2: 15,
    simplifyTolerance: 0.000015,
    maxPoints: 240,
    maxRouteGeometryPoints: 320,
  });
  context.setPolygons(built?.ok && built.geometry ? [{
    geometry: built.geometry,
    coords: built.coordsPreview || [],
    area: built.areaM2,
    id: "active-zone-preview",
    color: WayperTheme.colors.primary,
    strokeColor: WayperTheme.colors.primaryLight,
    fillOpacity: 0.16,
    preview: true,
  }] : []);
}

function noteDiscarded(context, reason = "unknown") {
  const key = String(reason || "unknown");
  context.discardedPointReasonsRef.current = {
    ...context.discardedPointReasonsRef.current,
    [key]: (context.discardedPointReasonsRef.current[key] || 0) + 1,
  };
}

function ingestLocation(context, locObj = {}) {
  try {
    if (locObj.runSessionId && context.currentRunIdRef.current &&
      locObj.runSessionId !== context.currentRunIdRef.current) {
      noteDiscarded(context, "stale_session");
      recordRunEvent("LOCATION_POINT_REJECTED", {
        runId: context.currentRunIdRef.current,
        reason: "stale_session",
        screen: "MapScreen",
      });
      return;
    }
    const point = normalizeLocation(locObj);
    if (!point) {
      noteDiscarded(context, "invalid_coordinate");
      return;
    }
    const receivedAt = new Date().toISOString();
    context.lastLocationReceivedAtRef.current = receivedAt;
    if (context.currentRunIdRef.current || context.runningRef.current) {
      context.recordSnapshot("location_point_received", {
        lastLocationReceivedAt: receivedAt,
      }, { minIntervalMs: 30000 });
    }
    if (!context.runningRef.current) {
      if (context.runStatusRef.current === "idle") context.setLocation((previous) =>
        previous?.latitude === point.latitude && previous?.longitude === point.longitude ? previous : point
      );
      noteDiscarded(context, "inactive_run");
      return;
    }
    if (context.runStatusRef.current !== "active") {
      noteDiscarded(context, "invalid_run_status");
      return;
    }
    const source = locObj.source === "background" ? "background" : "foreground";
    recordLocation({ ...point, source: locObj.source || point.source || source }, { source }).catch((error) => {
      context.lastRunDiagnosticErrorRef.current = {
        message: error?.message || String(error),
        code: error?.code || null,
        at: new Date().toISOString(),
      };
      recordRunEvent("LOCATION_INGESTION_FAILED", {
        runId: context.currentRunIdRef.current,
        status: context.runStatusRef.current,
        source,
        error,
        screen: "MapScreen",
      });
      checkpointOnLocationError(error, { phase: "canonical_location_ingestion" });
    });
  } catch (error) {
    noteDiscarded(context, "handler_error");
    context.lastRunDiagnosticErrorRef.current = {
      message: error?.message || String(error),
      code: error?.code || null,
      at: new Date().toISOString(),
    };
    checkpointOnLocationError(error, { phase: "handle_location_update" }).catch(() => {});
  }
}

export default function useRunLocationResources(contextRef) {
  const stopWatcherAndPolling = useCallback(() => {
    const context = contextRef.current;
    stopForegroundWatcher();
    setRuntimeSurfaceState({ foregroundWatcherStatus: "stopped" });
    recordRunEvent("LOCATION_WATCHER_STOPPED", {
      runId: context.currentRunIdRef.current,
      watcherStatus: "foreground_stopped",
      screen: "MapScreen",
    });
    context.recordSnapshot("watcher_stop", { watcherStatus: "foreground_stopped" }, { force: true });
    debugTracking("watcher_stopped", { runSessionId: context.currentRunIdRef.current });
  }, [contextRef]);

  const resetTrackingPipeline = useCallback((options = {}) => {
    const context = contextRef.current;
    context.trackingSessionRef.current = createTrackingSession({ mode: "run", startedAt: Date.now() });
    context.rawPathRef.current = [];
    context.savedPathRef.current = [];
    context.displayPathRef.current = [];
    context.displaySegmentsRef.current = [];
    context.routeStateRef.current = [];
    context.lastAcceptedLocationRef.current = null;
    context.zonePreviewLastAtRef.current = 0;
    context.zonePreviewLastPointCountRef.current = 0;
    context.setRouteState([]);
    context.setDisplayRouteState([]);
    context.setDisplayRouteSegments([]);
    debugTracking("path_reset", { segmentId: Number(options.segmentId) || 0 });
  }, [contextRef]);

  const handleLocationUpdate = useCallback((location) => ingestLocation(contextRef.current, location), [contextRef]);
  const updateActiveZonePreview = useCallback((path) => updateZonePreview(contextRef.current, path), [contextRef]);
  const stopBackgroundLocationService = useCallback(
    () => stopBackgroundLocation(contextRef.current),
    [contextRef]
  );
  const startBackgroundLocationService = useCallback(
    () => startBackgroundLocation(contextRef.current),
    [contextRef]
  );
  const startLocationWatcher = useCallback(async () => {
    const context = contextRef.current;
    const runId = context.currentRunIdRef.current;
    if (!runId || context.runStatusRef.current !== "active") return false;
    const restarting = isForegroundWatcherActive();
    if (restarting) context.watcherRestartCountRef.current += 1;
    const result = await startForegroundWatcher({
      runId,
      isRunActive: (expected) => context.currentRunIdRef.current === expected &&
        context.runStatusRef.current === "active",
      onLocation: handleLocationUpdate,
      onError: (error, errorContext) => {
        context.lastRunDiagnosticErrorRef.current = {
          message: error?.message || String(error),
          code: error?.code || null,
          at: new Date().toISOString(),
        };
        checkpointOnLocationError(error, errorContext).catch(() => {});
      },
    });
    if (result.reason === "permission_denied") {
      context.setLocationPermission(result.permission);
      context.locationPermissionRef.current = result.permission;
      context.setPermissionDenied(true);
      context.setRunPermissionNoticeVisible(true);
      return false;
    }
    if (!result.ok) return false;
    setRuntimeSurfaceState({ foregroundWatcherStatus: "started" });
    recordRunEvent(restarting ? "LOCATION_WATCHER_RESTARTED" : "LOCATION_WATCHER_STARTED", {
      runId,
      watcherStatus: result.mode === "polling" ? "fallback_polling_started" : "foreground_started",
      accuracy: result.accuracy ?? null,
      screen: "MapScreen",
    });
    context.recordSnapshot(restarting ? "watcher_restart" : "watcher_start", {}, { force: restarting });
    return true;
  }, [contextRef, handleLocationUpdate]);

  return {
    handleLocationUpdate,
    resetTrackingPipeline,
    startBackgroundLocationService,
    startLocationWatcher,
    stopBackgroundLocationService,
    stopWatcherAndPolling,
    updateActiveZonePreview,
  };
}
