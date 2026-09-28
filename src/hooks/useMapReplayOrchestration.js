import { useEffect } from "react";

export default function useMapReplayOrchestration({
  clearTerritoryFocus,
  closeSelectedTerritory,
  distanceRef,
  enableMapFollow,
  lastReplayRequestRef,
  location,
  modeRef,
  navigation,
  replayLifecycleRef,
  resetTrackingPipeline,
  route,
  runningRef,
  setCaptureResult,
  setCompletedZonePreview,
  setDistanceState,
  setMode,
  setPaused,
  setRunning,
  setSavedShareVisible,
  setShowRunModal,
  setShowRunsModal,
  setShowSavedModal,
  setTimeSec,
  startReplay,
  stopBackgroundLocationService,
  stopWatcherAndPolling,
  timeSecRef,
}) {
  replayLifecycleRef.current.beforeStart = ({ stats, initialPoint }) => {
    stopWatcherAndPolling();
    stopBackgroundLocationService();
    runningRef.current = false;
    setRunning(false);
    setPaused(false);
    setMode(null);
    modeRef.current = null;
    setCaptureResult(null);
    closeSelectedTerritory();
    clearTerritoryFocus();
    enableMapFollow();
    resetTrackingPipeline({ segmentId: 0 });
    timeSecRef.current = 0;
    distanceRef.current = 0;
    setTimeSec(stats.durationSeconds > 0 ? 0 : Math.round(initialPoint?.cumulativeTime || 0));
    setDistanceState(0);
  };
  replayLifecycleRef.current.progress = ({ durationSeconds, distanceMeters }) => {
    timeSecRef.current = durationSeconds;
    distanceRef.current = distanceMeters;
    setTimeSec(durationSeconds);
    setDistanceState(distanceMeters);
  };
  replayLifecycleRef.current.finish = () => {
    resetTrackingPipeline({ segmentId: 0 });
    enableMapFollow();
  };

  useEffect(() => {
    const replayRun = route?.params?.replayRun;
    if (!replayRun || !location) return;
    const requestId = route?.params?.replayRequestId ||
      `${replayRun?.id || replayRun?.date || "run"}:${replayRun?.updatedAt || replayRun?.createdAt || ""}`;
    if (lastReplayRequestRef.current === requestId) return;
    lastReplayRequestRef.current = requestId;
    setShowSavedModal(false);
    setSavedShareVisible(false);
    setCompletedZonePreview([]);
    setShowRunModal(false);
    setShowRunsModal(false);
    startReplay(replayRun, {
      returnTo: route?.params?.replayReturnTo || { type: "previous" },
      readOnly: !!(route?.params?.readOnly || replayRun?.readOnly),
      allowLegacyLocal: route?.params?.replayAllowLegacyLocal === true,
    });
    navigation?.setParams?.({
      replayRun: undefined,
      replayReturnTo: undefined,
      replayRequestId: undefined,
      replayAllowLegacyLocal: undefined,
    });
  }, [
    lastReplayRequestRef,
    location,
    navigation,
    route?.params,
    setCompletedZonePreview,
    setSavedShareVisible,
    setShowRunModal,
    setShowRunsModal,
    setShowSavedModal,
    startReplay,
  ]);
}
