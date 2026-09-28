import { useCallback, useEffect } from "react";
import { auth } from "../firebaseConfig";
import {
  ACTIVE_RUN_STATUS,
  calculateActiveRunDurationSeconds,
  limitPathForRendering,
} from "../services/runTracking";
import { onActiveRunSnapshot } from "../services/runTracking/activeRunTrackingService.js";
import { hydrateActiveRunFromRuntime } from "../services/runTracking/activeRunRuntimeService.js";
import { recordRunEvent, recordRunSnapshotEvent } from "../services/diagnostics/runDiagnosticsService.js";
import { projectActiveRunSnapshot } from "../screens/map/activeRunProjection.js";

const ROUTE_CAP = 8000;
const RUN_UI_UPDATE_INTERVAL_MS = 1000;

function useActiveRunSubscription({ applySnapshot, refs, scheduleSnapshot }) {
  useEffect(() => {
    const unsubscribe = onActiveRunSnapshot?.(({ event, snapshot }) => {
      if (!snapshot || !refs.mounted.current || event === "active_snapshot_cleared" ||
        event === "run_cancelled") return;
      if (event === "run_finishing") {
        refs.pendingUiSnapshot.current = null;
        if (refs.activeRunUiTimer.current) clearTimeout(refs.activeRunUiTimer.current);
        refs.activeRunUiTimer.current = null;
        return;
      }
      if (event === "foreground_point_buffered" || event === "background_point_buffered") {
        scheduleSnapshot(snapshot, { syncControls: false, source: event });
        return;
      }
      refs.pendingUiSnapshot.current = null;
      if (refs.activeRunUiTimer.current) clearTimeout(refs.activeRunUiTimer.current);
      refs.activeRunUiTimer.current = null;
      refs.lastActiveRunUiAt.current = Date.now();
      applySnapshot(snapshot, {
        recovered: event === "run_restored",
        allowTerminal: event === "run_finished_snapshot_saved",
      });
    });
    return () => {
      try {
        unsubscribe?.();
      } catch (error) {
        recordRunEvent("ACTIVE_RUN_SNAPSHOT_UNSUBSCRIBE_FAILED", {
          runId: refs.currentRunId.current,
          error,
          screen: "MapScreen",
          level: "warn",
        });
      }
      if (refs.activeRunUiTimer.current) clearTimeout(refs.activeRunUiTimer.current);
      refs.activeRunUiTimer.current = null;
      refs.pendingUiSnapshot.current = null;
    };
  }, [applySnapshot, refs, scheduleSnapshot]);
}

export default function useActiveRunProjection(options) {
  const {
    refs,
    setters,
    cancelReplay,
    recordSnapshot,
    startBackgroundLocationService,
    startElapsedTimer,
    startLocationWatcher,
    stopBackgroundLocationService,
    stopElapsedTimer,
    stopWatcherAndPolling,
    updateActiveZonePreview,
  } = options;

  const applySnapshot = useCallback((snapshot, applyOptions = {}) => {
    if (!snapshot?.activeRunId) return;
    const projection = projectActiveRunSnapshot(snapshot, {
      activeRunId: refs.currentRunId.current,
      trustedPath: refs.savedPath.current || refs.routeState.current,
      livePath: refs.displayPath.current,
      liveSegments: refs.displaySegments.current,
      distanceMeters: refs.distance.current,
      durationSeconds: refs.timeSec.current,
    });
    if (!projection?.live && applyOptions.allowTerminal !== true) {
      recordRunSnapshotEvent("RUN_RECONCILE_INCONSISTENT_STATE", snapshot, {
        reason: "non_live_snapshot_without_terminal_event",
        currentUiStatus: refs.runStatus.current,
        screen: "MapScreen",
      });
      hydrateActiveRunFromRuntime("non_live_snapshot_guard", {
        userId: auth.currentUser?.uid || "offline",
        appState: refs.appState.current,
        screenFocusState: "focused",
        restartTracking: true,
      }).then((result) => {
        if (result?.snapshot?.activeRunId) applySnapshot(result.snapshot, {
          recovered: true,
          forceSyncControls: true,
        });
      }).catch(() => {});
      return;
    }
    const {
      status,
      paused,
      recoverable,
      live,
      session,
      runStatus,
      trustedPath,
      rawPath,
      livePath,
      liveSegments,
      distanceMeters,
      durationSeconds,
    } = projection;
    const previousStatus = refs.runStatus.current;
    const syncControls = applyOptions.syncControls !== false;
    const forceControls = applyOptions.forceSyncControls === true;

    if (projection.emptyOverwriteBlocked) recordRunSnapshotEvent(
      "ACTIVE_RUN_EMPTY_OVERWRITE_BLOCKED",
      snapshot,
      { previousPoints: trustedPath.length, screen: "MapScreen" }
    );
    if (projection.stalePathBlocked) recordRunSnapshotEvent("RUN_UI_STATE_STALE_UPDATE_BLOCKED", snapshot, {
      previousPoints: trustedPath.length,
      incomingPoints: projection.incomingPathLength,
      screen: "MapScreen",
    });
    if (projection.distanceRegressionBlocked) recordRunSnapshotEvent(
      "RUN_UI_DISTANCE_REGRESSION_BLOCKED",
      snapshot,
      {
        previousDistanceMeters: refs.distance.current,
        incomingDistanceMeters: projection.incomingDistanceMeters,
        screen: "MapScreen",
      }
    );
    if (projection.elapsedRegressionBlocked) recordRunSnapshotEvent(
      "RUN_UI_ELAPSED_REGRESSION_BLOCKED",
      snapshot,
      {
        previousElapsedMs: (refs.timeSec.current || 0) * 1000,
        incomingElapsedMs: calculateActiveRunDurationSeconds(snapshot, { nowMs: Date.now() }) * 1000,
        screen: "MapScreen",
      }
    );

    refs.trackingSession.current = session;
    refs.currentRunId.current = snapshot.activeRunId;
    refs.mode.current = snapshot.mode || "free";
    refs.running.current = status === ACTIVE_RUN_STATUS.RUNNING || recoverable;
    refs.runStatus.current = runStatus;
    refs.rawPath.current = rawPath;
    refs.savedPath.current = trustedPath;
    refs.routeState.current = trustedPath;
    refs.displayPath.current = livePath;
    refs.displaySegments.current = liveSegments;
    refs.distance.current = distanceMeters;
    refs.timeSec.current = durationSeconds;
    refs.lastAcceptedLocation.current = trustedPath[trustedPath.length - 1] || null;
    if (refs.lastAcceptedLocation.current) refs.lastLocationAcceptedAt.current = new Date().toISOString();
    setters.setRunning(live);
    setters.setPaused(paused);
    setters.setMode(snapshot.mode || "free");
    cancelReplay();
    setters.setRouteState(limitPathForRendering(trustedPath, ROUTE_CAP));
    setters.setDisplayRouteState(livePath);
    setters.setDisplayRouteSegments(liveSegments);
    setters.setDistanceState(distanceMeters);
    setters.setTimeSec(durationSeconds);
    if (projection.location) setters.setLocation(projection.location);
    setters.setGpsQualityWarning(projection.gpsQualityWarning);
    updateActiveZonePreview(trustedPath);
    recordRunSnapshotEvent("RUN_UI_STATE_APPLIED", snapshot, {
      previousStatus,
      nextStatus: refs.runStatus.current,
      running: live,
      paused,
      source: applyOptions.source || snapshot.source || null,
      routePointsCount: trustedPath.length,
      routeSegmentsCount: liveSegments.length,
      displayPointsCount: livePath.length,
      distanceMeters,
      elapsedMs: durationSeconds * 1000,
      screen: "MapScreen",
    });
    recordRunSnapshotEvent("CANONICAL_SNAPSHOT_APPLIED", snapshot, {
      previousStatus,
      nextStatus: refs.runStatus.current,
      source: applyOptions.source || snapshot.source || null,
      recovered: Boolean(applyOptions.recovered),
      routePointsCount: trustedPath.length,
      routeSegmentsCount: liveSegments.length,
      screen: "MapScreen",
    });
    recordRunSnapshotEvent("MAP_ROUTE_HYDRATED", snapshot, {
      routePointsCount: trustedPath.length,
      routeSegmentsCount: liveSegments.length,
      displayPointsCount: livePath.length,
      recovered: Boolean(applyOptions.recovered),
      screen: "MapScreen",
    });
    if (applyOptions.recovered) recordSnapshot("recovery", {
      source: applyOptions.source || snapshot.source || null,
      recovered: true,
    }, { force: true });

    if (status === ACTIVE_RUN_STATUS.RUNNING) {
      if (!refs.timer.current || previousStatus !== "active") startElapsedTimer();
      if (syncControls && (forceControls || previousStatus !== "active")) {
        startLocationWatcher().catch(() => {});
        startBackgroundLocationService().catch(() => {});
      }
    } else if (paused) {
      stopElapsedTimer();
      if (syncControls && (forceControls || previousStatus === "active")) {
        stopWatcherAndPolling();
        stopBackgroundLocationService();
      }
    } else if (recoverable) {
      stopElapsedTimer();
    }
    if (applyOptions.recovered) refs.recoveryUi.current.showNotice?.(6500);
  }, [
    cancelReplay,
    recordSnapshot,
    refs,
    setters,
    startBackgroundLocationService,
    startElapsedTimer,
    startLocationWatcher,
    stopBackgroundLocationService,
    stopElapsedTimer,
    stopWatcherAndPolling,
    updateActiveZonePreview,
  ]);

  const flushPending = useCallback(() => {
    if (refs.activeRunUiTimer.current) clearTimeout(refs.activeRunUiTimer.current);
    refs.activeRunUiTimer.current = null;
    const pending = refs.pendingUiSnapshot.current;
    refs.pendingUiSnapshot.current = null;
    if (!pending?.snapshot || !refs.mounted.current) return;
    refs.lastActiveRunUiAt.current = Date.now();
    applySnapshot(pending.snapshot, pending.options);
  }, [applySnapshot, refs]);

  const scheduleSnapshot = useCallback((snapshot, scheduleOptions = {}) => {
    if (!snapshot?.activeRunId || !refs.mounted.current) return;
    refs.pendingUiSnapshot.current = { snapshot, options: scheduleOptions };
    if (refs.activeRunUiTimer.current) return;
    const delay = Math.max(
      0,
      RUN_UI_UPDATE_INTERVAL_MS - (Date.now() - refs.lastActiveRunUiAt.current)
    );
    refs.activeRunUiTimer.current = setTimeout(flushPending, delay);
  }, [flushPending, refs]);

  useActiveRunSubscription({ applySnapshot, refs, scheduleSnapshot });

  return applySnapshot;
}
