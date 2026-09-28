import React, { useCallback, useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { auth } from "../firebaseConfig";
import useMapReplayOrchestration from "../hooks/useMapReplayOrchestration";
import useMapRunOperations from "../hooks/useMapRunOperations";
import useMapRunPresentation from "../hooks/useMapRunPresentation";
import useMapRunResources from "../hooks/useMapRunResources";
import useMapRunState from "../hooks/useMapRunState";
import useMapScreenActions from "../hooks/useMapScreenActions";
import useMapScreenLifecycle from "../hooks/useMapScreenLifecycle";
import useMapTerritories from "../hooks/useMapTerritories";
import useRunReplay from "../hooks/useRunReplay";
import useRunSummarySave from "../hooks/useRunSummarySave";
import { splitPathIntoSegments } from "../services/runTracking";
import { WayperTheme } from "../theme/wayperTheme";
import MapCanvasLayer from "./map/MapCanvasLayer.js";
import MapRunControls from "./map/MapRunControls.js";
import MapRunDialogs from "./map/MapRunDialogs.js";
import MapSavedRunDialogs from "./map/MapSavedRunDialogs.js";
import styles from "./map/MapScreen.styles.js";
import MapTerritoryPanels from "./map/MapTerritoryPanels.js";
import { buildMapScreenModels } from "./map/mapScreenModels.js";

const MapScreen = ({ navigation, route }) => {
  const run = useMapRunState();
  const lifecycle = useMapScreenLifecycle({
    currentRunIdRef: run.currentRunIdRef,
    recordDiagnosticsSnapshotRef: run.recordDiagnosticsSnapshotRef,
    restoreActiveRunForReentryRef: run.restoreActiveRunForReentryRef,
    runningRef: run.runningRef,
    runStatusRef: run.runStatusRef,
    timerRef: run.timerRef,
  });
  const currentUserId = auth.currentUser?.uid || "offline";
  const liveRoutePath = run.running || run.paused ? run.displayRouteState : run.routeState;
  const liveRouteSegments = useMemo(
    () => run.running || run.paused
      ? run.displayRouteSegments
      : splitPathIntoSegments(liveRoutePath),
    [liveRoutePath, run.displayRouteSegments, run.paused, run.running]
  );

  const replayIsActiveRun = useCallback(() => run.runningRef.current, [run.runningRef]);
  const replayBeforeStart = useCallback((context) => {
    run.replayLifecycleRef.current.beforeStart?.(context);
  }, [run.replayLifecycleRef]);
  const replayProgress = useCallback((context) => {
    run.replayLifecycleRef.current.progress?.(context);
  }, [run.replayLifecycleRef]);
  const replayFinished = useCallback(() => {
    run.replayLifecycleRef.current.finish?.();
  }, [run.replayLifecycleRef]);
  const replay = useRunReplay({
    navigation,
    currentUserId,
    isActiveRun: replayIsActiveRun,
    onBeforeStart: replayBeforeStart,
    onProgress: replayProgress,
    onFinish: replayFinished,
  });

  const presentation = useMapRunPresentation({
    clearTerritoryFocusRef: run.clearTerritoryFocusRef,
    paused: run.paused,
    replaying: replay.replaying,
    running: run.running,
    setDisplayRouteSegments: run.setDisplayRouteSegments,
    setDisplayRouteState: run.setDisplayRouteState,
    setRouteState: run.setRouteState,
  });
  const territory = useMapTerritories({
    location: lifecycle.location,
    navigation,
    routeParams: route?.params,
    interactionBlocked: run.running || replay.replaying,
    onDisableFollow: presentation.disableMapFollow,
  });
  run.clearTerritoryFocusRef.current = territory.clearTerritoryFocus;
  const {
    setSavedShareVisible,
    setSelectModeVisible,
    setShowRunModal,
    setShowRunsModal,
    setShowSavedModal,
  } = run;
  const { closeSelectedTerritory, closeZonesPanel } = territory;

  const saveRunSummary = useRunSummarySave({
    currentRunData: run.currentRunData,
    territories: territory.territories,
    patchTerritory: territory.patchTerritory,
    setCompletedZonePreview: run.setCompletedZonePreview,
    setCurrentRunData: run.setCurrentRunData,
    setLastSavedRun: run.setLastSavedRun,
    setRunsList: lifecycle.setRunsList,
    setShowRunModal: run.setShowRunModal,
    setShowSavedModal: run.setShowSavedModal,
  });
  const closeActiveRunBlockingOverlays = useCallback(() => {
    setSelectModeVisible(false);
    setShowRunsModal(false);
    closeZonesPanel();
    setShowSavedModal(false);
    setSavedShareVisible(false);
    setShowRunModal(false);
    closeSelectedTerritory();
  }, [
    closeSelectedTerritory,
    closeZonesPanel,
    setSavedShareVisible,
    setSelectModeVisible,
    setShowRunModal,
    setShowRunsModal,
    setShowSavedModal,
  ]);

  const resources = useMapRunResources({
    closeBlockingOverlays: closeActiveRunBlockingOverlays,
    lifecycle,
    navigation,
    replay,
    route,
    run,
  });
  const operations = useMapRunOperations({
    closeBlockingOverlays: closeActiveRunBlockingOverlays,
    lifecycle,
    presentation,
    replay,
    resources,
    run,
    territory,
  });

  useMapReplayOrchestration({
    clearTerritoryFocus: territory.clearTerritoryFocus,
    closeSelectedTerritory: territory.closeSelectedTerritory,
    distanceRef: run.distanceRef,
    enableMapFollow: presentation.enableMapFollow,
    lastReplayRequestRef: run.lastReplayRequestRef,
    location: lifecycle.location,
    modeRef: run.modeRef,
    navigation,
    replayLifecycleRef: run.replayLifecycleRef,
    resetTrackingPipeline: resources.resetTrackingPipeline,
    route,
    runningRef: run.runningRef,
    setCaptureResult: run.setCaptureResult,
    setCompletedZonePreview: run.setCompletedZonePreview,
    setDistanceState: run.setDistanceState,
    setMode: run.setMode,
    setPaused: run.setPaused,
    setRunning: run.setRunning,
    setSavedShareVisible: run.setSavedShareVisible,
    setShowRunModal: run.setShowRunModal,
    setShowRunsModal: run.setShowRunsModal,
    setShowSavedModal: run.setShowSavedModal,
    setTimeSec: run.setTimeSec,
    startReplay: replay.startReplay,
    stopBackgroundLocationService: resources.stopBackgroundLocationService,
    stopWatcherAndPolling: resources.stopWatcherAndPolling,
    timeSecRef: run.timeSecRef,
  });
  const actions = useMapScreenActions({
    closeSelectedTerritory: territory.closeSelectedTerritory,
    isRunStartBusy: operations.isRunStartBusy,
    lastSavedRun: run.lastSavedRun,
    navigation,
    selectedTerritory: territory.selectedTerritory,
    setCompletedZonePreview: run.setCompletedZonePreview,
    setSavedShareVisible: run.setSavedShareVisible,
    setSelectModeVisible: run.setSelectModeVisible,
    setShowRunModal: run.setShowRunModal,
    setShowRunsModal: run.setShowRunsModal,
    setShowSavedModal: run.setShowSavedModal,
    startReplay: replay.startReplay,
    startWithCountdown: operations.startWithCountdown,
  });

  if (lifecycle.loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={WayperTheme.colors.primary} />
      </View>
    );
  }

  const models = buildMapScreenModels({
    actions,
    currentUserId,
    lifecycle,
    liveRoutePath,
    liveRouteSegments,
    operations,
    presentation,
    replay,
    resources,
    run,
    saveRunSummary,
    territory,
  });

  return (
    <View style={styles.container}>
      <MapCanvasLayer model={models.canvasModel} />
      <MapRunControls model={models.runControlsModel} />
      <MapTerritoryPanels model={models.territoryPanelsModel} />
      <MapSavedRunDialogs model={models.savedRunDialogsModel} />
      <MapRunDialogs model={models.runDialogsModel} />
    </View>
  );
};

export default React.memo(MapScreen);
