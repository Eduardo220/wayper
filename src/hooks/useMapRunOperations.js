import { useCallback } from "react";
import { WAYPER_FALLBACK_COORD } from "../components/Map/WayperMapLibre";
import * as activeRunTrackingService from "../services/runTracking/activeRunTrackingService";
import useRunFinalization from "./useRunFinalization";
import useRunPauseResume from "./useRunPauseResume";
import useRunRecoveryFlow from "./useRunRecoveryFlow";
import useRunStartFlow from "./useRunStartFlow";

export default function useMapRunOperations({
  closeBlockingOverlays,
  lifecycle,
  presentation,
  replay,
  resources,
  run,
  territory,
}) {
  run.startContextRef.current = {
    mountedRef: lifecycle.mountedRef,
    setLocationPermission: lifecycle.setLocationPermission,
    locationPermissionRef: lifecycle.locationPermissionRef,
    setPermissionDenied: lifecycle.setPermissionDenied,
    setRunLimitationNotice: run.setRunLimitationNotice,
    running: run.running,
    runningRef: run.runningRef,
    runtimeRecovering: resources.runtimeRecovering,
    isFinishingRunRef: run.isFinishingRunRef,
    isFinishingRun: run.isFinishingRun,
    permissionDenied: lifecycle.permissionDenied,
    setRunPermissionNoticeVisible: run.setRunPermissionNoticeVisible,
    setMode: run.setMode,
    appStateRef: lifecycle.appStateRef,
    applySnapshot: resources.applyActiveRunSnapshotToUi,
    recoveryUiRef: run.recoveryUiRef,
    setRunning: run.setRunning,
    setPaused: run.setPaused,
    modeRef: run.modeRef,
    cancelReplay: replay.cancelReplay,
    setCaptureResult: run.setCaptureResult,
    closeSelectedTerritory: territory.closeSelectedTerritory,
    currentRunIdRef: run.currentRunIdRef,
    runStatusRef: run.runStatusRef,
    resetTrackingPipeline: resources.resetTrackingPipeline,
    trackingSessionRef: run.trackingSessionRef,
    setPolygons: lifecycle.setPolygons,
    setCompletedZonePreview: run.setCompletedZonePreview,
    distanceRef: run.distanceRef,
    setDistanceState: run.setDistanceState,
    zonePreviewLastAtRef: run.zonePreviewLastAtRef,
    timeSecRef: run.timeSecRef,
    setTimeSec: run.setTimeSec,
    recordSnapshot: resources.recordSnapshot,
    startElapsedTimer: resources.startElapsedTimer,
    startLocationWatcher: resources.startLocationWatcher,
    handleLocationUpdate: resources.handleLocationUpdate,
    stopWatcherAndPolling: resources.stopWatcherAndPolling,
    stopElapsedTimer: resources.stopElapsedTimer,
  };
  const start = useRunStartFlow(run.startContextRef);
  const isRunStartBusy = start.isStartingRun || start.counting || run.running ||
    resources.runtimeRecovering || run.isFinishingRun;

  run.pauseResumeContextRef.current = {
    currentRunIdRef: run.currentRunIdRef,
    runStatusRef: run.runStatusRef,
    running: run.running,
    paused: run.paused,
    recordSnapshot: resources.recordSnapshot,
    applySnapshot: resources.applyActiveRunSnapshotToUi,
    runningRef: run.runningRef,
    setPaused: run.setPaused,
    trackingSessionRef: run.trackingSessionRef,
    distanceRef: run.distanceRef,
    stopWatcherAndPolling: resources.stopWatcherAndPolling,
    stopElapsedTimer: resources.stopElapsedTimer,
    setLocationPermission: lifecycle.setLocationPermission,
    locationPermissionRef: lifecycle.locationPermissionRef,
    setPermissionDenied: lifecycle.setPermissionDenied,
    setRunPermissionNoticeVisible: run.setRunPermissionNoticeVisible,
    startElapsedTimer: resources.startElapsedTimer,
    setLocation: lifecycle.setLocation,
    startLocationWatcher: resources.startLocationWatcher,
  };
  const pauseResume = useRunPauseResume(run.pauseResumeContextRef);
  const { setPolygons } = lifecycle;
  const { cancelReplay } = replay;
  const { resetTrackingPipeline } = resources;
  const {
    currentRunIdRef,
    distanceRef,
    modeRef,
    runStatusRef,
    setCompletedZonePreview,
    setDistanceState,
    setGpsQualityWarning,
    setMode,
    setPaused,
    setTimeSec,
    timeSecRef,
  } = run;

  const resetRunVisuals = useCallback(() => {
    distanceRef.current = 0;
    setDistanceState(0);
    resetTrackingPipeline({ segmentId: 0 });
    cancelReplay();
    setPolygons([]);
    setCompletedZonePreview([]);
    timeSecRef.current = 0;
    setTimeSec(0);
    modeRef.current = null;
    setMode(null);
    setPaused(false);
    setGpsQualityWarning(null);
    currentRunIdRef.current = null;
    runStatusRef.current = "idle";
  }, [
    cancelReplay,
    currentRunIdRef,
    distanceRef,
    modeRef,
    resetTrackingPipeline,
    runStatusRef,
    setCompletedZonePreview,
    setDistanceState,
    setGpsQualityWarning,
    setMode,
    setPaused,
    setPolygons,
    setTimeSec,
    timeSecRef,
  ]);

  run.finalizationContextRef.current = {
    activeRunTrackingService,
    applyActiveRunSnapshotToUi: resources.applyActiveRunSnapshotToUi,
    currentRunIdRef: run.currentRunIdRef,
    runStatusRef: run.runStatusRef,
    running: run.running,
    runningRef: run.runningRef,
    recordEmergencyDiagnosticsSnapshot: resources.recordSnapshot,
    finishInFlightRef: run.finishInFlightRef,
    isFinishingRunRef: run.isFinishingRunRef,
    setIsFinishingRun: run.setIsFinishingRun,
    cancelEmergencyDiagnosticsForFinish: resources.cancelForFinish,
    setRunning: run.setRunning,
    setPaused: run.setPaused,
    stopWatcherAndPolling: resources.stopWatcherAndPolling,
    stopElapsedTimer: resources.stopElapsedTimer,
    stopBackgroundLocationService: resources.stopBackgroundLocationService,
    startLocationWatcher: resources.startLocationWatcher,
    startBackgroundLocationService: resources.startBackgroundLocationService,
    modeRef: run.modeRef,
    mode: run.mode,
    trackingSessionRef: run.trackingSessionRef,
    timeSecRef: run.timeSecRef,
    timeSec: run.timeSec,
    lastAcceptedLocationRef: run.lastAcceptedLocationRef,
    location: lifecycle.location,
    defaultLocation: WAYPER_FALLBACK_COORD,
    savedPathRef: run.savedPathRef,
    displayPathRef: run.displayPathRef,
    distanceRef: run.distanceRef,
    setCaptureResult: run.setCaptureResult,
    fadeOutRoute: presentation.fadeOutRoute,
    resetRunVisuals,
    setCompletedZonePreview: run.setCompletedZonePreview,
    setCurrentRunData: run.setCurrentRunData,
    setRunsList: lifecycle.setRunsList,
    setShowRunModal: run.setShowRunModal,
    recoveryUiRef: run.recoveryUiRef,
    mountedRef: lifecycle.mountedRef,
  };
  const stopRun = useRunFinalization(run.finalizationContextRef);

  const recovery = useRunRecoveryFlow({
    loading: lifecycle.loading,
    mountedRef: lifecycle.mountedRef,
    applySnapshot: resources.applyActiveRunSnapshotToUi,
    closeBlockingOverlays,
    resetRunVisuals,
    setCurrentRunData: run.setCurrentRunData,
    setShowRunModal: run.setShowRunModal,
    stopRun,
  });
  run.recoveryUiRef.current = {
    showNotice: recovery.showNotice,
    showCandidate: recovery.showCandidate,
  };

  return {
    ...pauseResume,
    ...recovery,
    ...start,
    isRunStartBusy,
    resetRunVisuals,
    stopRun,
  };
}
