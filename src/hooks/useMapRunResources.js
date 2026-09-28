import useActiveRunProjection from "./useActiveRunProjection";
import useActiveRunReentry from "./useActiveRunReentry";
import useEmergencyRunDiagnostics from "./useEmergencyRunDiagnostics";
import useRunElapsedTimer from "./useRunElapsedTimer";
import useRunLocationResources from "./useRunLocationResources";
import useRunPermissionActions from "./useRunPermissionActions";
import useRunUiDiagnostics from "./useRunUiDiagnostics";

export default function useMapRunResources({
  closeBlockingOverlays,
  lifecycle,
  navigation,
  replay,
  route,
  run,
}) {
  run.emergencyDiagnosticsContextRef.current = {
    runId: run.currentRunIdRef,
    status: run.runStatusRef,
    elapsed: run.timeSecRef,
    distance: run.distanceRef,
    appState: lifecycle.appStateRef,
    timer: run.timerRef,
    lastUiTick: run.lastUiTickAtRef,
    lastLocationReceived: run.lastLocationReceivedAtRef,
    lastLocationAccepted: run.lastLocationAcceptedAtRef,
    lastRenderPathUpdated: run.lastRenderPathUpdatedAtRef,
    rawPath: run.rawPathRef,
    trustedPath: run.savedPathRef,
    renderPath: run.displayPathRef,
    segments: run.displaySegmentsRef,
    discardedReasons: run.discardedPointReasonsRef,
    lastError: run.lastRunDiagnosticErrorRef,
    uiStalls: run.uiStallCountRef,
    timerStalls: run.timerStallCountRef,
    watcherRestarts: run.watcherRestartCountRef,
    running: run.runningRef,
    mounted: lifecycle.mountedRef,
    finishInFlight: run.finishInFlightRef,
    routeState: run.routeStateRef,
    pendingUiSnapshot: run.pendingActiveRunUiSnapshotRef,
    lastMapRouteDiagnostic: run.lastMapRouteDiagnosticRef,
    lastMapRouteRenderAt: run.lastMapRouteRenderAtRef,
    lastMapRenderStallAt: run.lastMapRenderStallAtRef,
    lastUiHeartbeat: run.lastUiHeartbeatAtRef,
  };
  const diagnostics = useEmergencyRunDiagnostics(run.emergencyDiagnosticsContextRef);
  run.recordDiagnosticsSnapshotRef.current = diagnostics.recordSnapshot;

  useRunUiDiagnostics({
    contextRef: run.emergencyDiagnosticsContextRef,
    displayRouteSegments: run.displayRouteSegments,
    displayRouteState: run.displayRouteState,
    paused: run.paused,
    recordSnapshot: diagnostics.recordSnapshot,
    replaying: replay.replaying,
    routeState: run.routeState,
    running: run.running,
  });

  run.locationResourcesContextRef.current = {
    recordSnapshot: diagnostics.recordSnapshot,
    currentRunIdRef: run.currentRunIdRef,
    trackingSessionRef: run.trackingSessionRef,
    rawPathRef: run.rawPathRef,
    savedPathRef: run.savedPathRef,
    displayPathRef: run.displayPathRef,
    displaySegmentsRef: run.displaySegmentsRef,
    routeStateRef: run.routeStateRef,
    lastAcceptedLocationRef: run.lastAcceptedLocationRef,
    zonePreviewLastAtRef: run.zonePreviewLastAtRef,
    zonePreviewLastPointCountRef: run.zonePreviewLastPointCountRef,
    setRouteState: run.setRouteState,
    setDisplayRouteState: run.setDisplayRouteState,
    setDisplayRouteSegments: run.setDisplayRouteSegments,
    runningRef: run.runningRef,
    modeRef: run.modeRef,
    setPolygons: lifecycle.setPolygons,
    discardedPointReasonsRef: run.discardedPointReasonsRef,
    lastLocationReceivedAtRef: run.lastLocationReceivedAtRef,
    runStatusRef: run.runStatusRef,
    setLocation: lifecycle.setLocation,
    lastRunDiagnosticErrorRef: run.lastRunDiagnosticErrorRef,
    watcherRestartCountRef: run.watcherRestartCountRef,
    mountedRef: lifecycle.mountedRef,
    setRunLimitationNotice: run.setRunLimitationNotice,
    backgroundPermissionWarnedRef: lifecycle.backgroundPermissionWarnedRef,
    setLocationPermission: lifecycle.setLocationPermission,
    locationPermissionRef: lifecycle.locationPermissionRef,
    setPermissionDenied: lifecycle.setPermissionDenied,
    setRunPermissionNoticeVisible: run.setRunPermissionNoticeVisible,
  };
  const location = useRunLocationResources(run.locationResourcesContextRef);
  const permissions = useRunPermissionActions({
    lifecycle,
    run,
    startBackgroundLocationService: location.startBackgroundLocationService,
  });

  run.elapsedTimerContextRef.current = {
    timerRef: run.timerRef,
    lastUiTickAtRef: run.lastUiTickAtRef,
    runningRef: run.runningRef,
    runStatusRef: run.runStatusRef,
    timerStallCountRef: run.timerStallCountRef,
    currentRunIdRef: run.currentRunIdRef,
    recordSnapshot: diagnostics.recordSnapshot,
    timeSecRef: run.timeSecRef,
    setTimeSec: run.setTimeSec,
    lastRunDiagnosticErrorRef: run.lastRunDiagnosticErrorRef,
  };
  const elapsed = useRunElapsedTimer(run.elapsedTimerContextRef, location.startLocationWatcher);

  if (!run.projectionBindingsRef.current) {
    run.projectionBindingsRef.current = {
      refs: {
        currentRunId: run.currentRunIdRef,
        savedPath: run.savedPathRef,
        routeState: run.routeStateRef,
        displayPath: run.displayPathRef,
        displaySegments: run.displaySegmentsRef,
        distance: run.distanceRef,
        timeSec: run.timeSecRef,
        runStatus: run.runStatusRef,
        appState: lifecycle.appStateRef,
        trackingSession: run.trackingSessionRef,
        mode: run.modeRef,
        running: run.runningRef,
        rawPath: run.rawPathRef,
        lastAcceptedLocation: run.lastAcceptedLocationRef,
        lastLocationAcceptedAt: run.lastLocationAcceptedAtRef,
        timer: run.timerRef,
        recoveryUi: run.recoveryUiRef,
        activeRunUiTimer: run.activeRunUiTimerRef,
        pendingUiSnapshot: run.pendingActiveRunUiSnapshotRef,
        lastActiveRunUiAt: run.lastActiveRunUiAtRef,
        mounted: lifecycle.mountedRef,
      },
      setters: {
        setRunning: run.setRunning,
        setPaused: run.setPaused,
        setMode: run.setMode,
        setRouteState: run.setRouteState,
        setDisplayRouteState: run.setDisplayRouteState,
        setDisplayRouteSegments: run.setDisplayRouteSegments,
        setDistanceState: run.setDistanceState,
        setTimeSec: run.setTimeSec,
        setLocation: lifecycle.setLocation,
        setGpsQualityWarning: run.setGpsQualityWarning,
      },
    };
  }
  const applyActiveRunSnapshotToUi = useActiveRunProjection({
    ...run.projectionBindingsRef.current,
    cancelReplay: replay.cancelReplay,
    recordSnapshot: diagnostics.recordSnapshot,
    startBackgroundLocationService: location.startBackgroundLocationService,
    startElapsedTimer: elapsed.startElapsedTimer,
    startLocationWatcher: location.startLocationWatcher,
    stopBackgroundLocationService: location.stopBackgroundLocationService,
    stopElapsedTimer: elapsed.stopElapsedTimer,
    stopWatcherAndPolling: location.stopWatcherAndPolling,
    updateActiveZonePreview: location.updateActiveZonePreview,
  });

  run.reentryContextRef.current = {
    runningRef: run.runningRef,
    currentRunIdRef: run.currentRunIdRef,
    runStatusRef: run.runStatusRef,
    appStateRef: lifecycle.appStateRef,
    mountedRef: lifecycle.mountedRef,
    closeBlockingOverlays,
    applySnapshot: applyActiveRunSnapshotToUi,
  };
  const { recovering: runtimeRecovering } = useActiveRunReentry({
    navigation,
    route,
    contextRef: run.reentryContextRef,
    restoreRef: run.restoreActiveRunForReentryRef,
  });

  return {
    ...diagnostics,
    ...elapsed,
    ...location,
    ...permissions,
    applyActiveRunSnapshotToUi,
    runtimeRecovering,
  };
}
