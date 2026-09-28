import { useEffect, useRef, useState } from "react";
import { createTrackingSession } from "../services/runTracking";

export default function useMapRunState() {
  const [runPermissionNoticeVisible, setRunPermissionNoticeVisible] = useState(false);
  const [runLimitationNotice, setRunLimitationNotice] = useState(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [selectModeVisible, setSelectModeVisible] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [currentRunData, setCurrentRunData] = useState(null);
  const [captureResult, setCaptureResult] = useState(null);
  const [routeState, setRouteState] = useState([]);
  const [displayRouteState, setDisplayRouteState] = useState([]);
  const [displayRouteSegments, setDisplayRouteSegments] = useState([]);
  const [distanceState, setDistanceState] = useState(0);
  const [timeSec, setTimeSec] = useState(0);
  const [completedZonePreview, setCompletedZonePreview] = useState([]);
  const [mode, setMode] = useState(null);
  const [gpsQualityWarning, setGpsQualityWarning] = useState(null);
  const [isFinishingRun, setIsFinishingRun] = useState(false);
  const [showRunsModal, setShowRunsModal] = useState(false);
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [savedShareVisible, setSavedShareVisible] = useState(false);
  const [lastSavedRun, setLastSavedRun] = useState(null);

  const timerRef = useRef(null);
  const timeSecRef = useRef(0);
  const lastReplayRequestRef = useRef(null);
  const replayLifecycleRef = useRef({});
  const recoveryUiRef = useRef({});
  const finalizationContextRef = useRef({});
  const reentryContextRef = useRef({});
  const pauseResumeContextRef = useRef({});
  const startContextRef = useRef({});
  const locationResourcesContextRef = useRef({});
  const elapsedTimerContextRef = useRef({});
  const projectionBindingsRef = useRef(null);
  const rawPathRef = useRef([]);
  const savedPathRef = useRef([]);
  const displayPathRef = useRef([]);
  const displaySegmentsRef = useRef([]);
  const trackingSessionRef = useRef(createTrackingSession({ mode: "run" }));
  const lastAcceptedLocationRef = useRef(null);
  const currentRunIdRef = useRef(null);
  const pendingActiveRunUiSnapshotRef = useRef(null);
  const activeRunUiTimerRef = useRef(null);
  const lastActiveRunUiAtRef = useRef(0);
  const finishInFlightRef = useRef(false);
  const isFinishingRunRef = useRef(false);
  const routeStateRef = useRef([]);
  const distanceRef = useRef(0);
  const runningRef = useRef(false);
  const runStatusRef = useRef("idle");
  const modeRef = useRef(null);
  const zonePreviewLastAtRef = useRef(0);
  const zonePreviewLastPointCountRef = useRef(0);
  const restoreActiveRunForReentryRef = useRef(null);
  const clearTerritoryFocusRef = useRef(null);
  const lastMapRouteDiagnosticRef = useRef("");
  const lastMapRouteRenderAtRef = useRef(0);
  const lastUiTickAtRef = useRef(null);
  const lastUiHeartbeatAtRef = useRef(0);
  const lastLocationReceivedAtRef = useRef(null);
  const lastLocationAcceptedAtRef = useRef(null);
  const lastRenderPathUpdatedAtRef = useRef(null);
  const lastMapRenderStallAtRef = useRef(0);
  const timerStallCountRef = useRef(0);
  const uiStallCountRef = useRef(0);
  const watcherRestartCountRef = useRef(0);
  const discardedPointReasonsRef = useRef({});
  const lastRunDiagnosticErrorRef = useRef(null);
  const emergencyDiagnosticsContextRef = useRef({});
  const recordDiagnosticsSnapshotRef = useRef(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  return {
    activeRunUiTimerRef,
    captureResult,
    clearTerritoryFocusRef,
    completedZonePreview,
    currentRunData,
    currentRunIdRef,
    discardedPointReasonsRef,
    displayPathRef,
    displayRouteSegments,
    displayRouteState,
    displaySegmentsRef,
    distanceRef,
    distanceState,
    elapsedTimerContextRef,
    emergencyDiagnosticsContextRef,
    finalizationContextRef,
    finishInFlightRef,
    gpsQualityWarning,
    isFinishingRun,
    isFinishingRunRef,
    lastAcceptedLocationRef,
    lastActiveRunUiAtRef,
    lastLocationAcceptedAtRef,
    lastLocationReceivedAtRef,
    lastMapRenderStallAtRef,
    lastMapRouteDiagnosticRef,
    lastMapRouteRenderAtRef,
    lastRenderPathUpdatedAtRef,
    lastReplayRequestRef,
    lastRunDiagnosticErrorRef,
    lastSavedRun,
    lastUiHeartbeatAtRef,
    lastUiTickAtRef,
    locationResourcesContextRef,
    mode,
    modeRef,
    pauseResumeContextRef,
    paused,
    pendingActiveRunUiSnapshotRef,
    projectionBindingsRef,
    rawPathRef,
    recordDiagnosticsSnapshotRef,
    recoveryUiRef,
    reentryContextRef,
    replayLifecycleRef,
    restoreActiveRunForReentryRef,
    routeState,
    routeStateRef,
    running,
    runningRef,
    runLimitationNotice,
    runPermissionNoticeVisible,
    runStatusRef,
    savedPathRef,
    savedShareVisible,
    selectModeVisible,
    setCaptureResult,
    setCompletedZonePreview,
    setCurrentRunData,
    setDisplayRouteSegments,
    setDisplayRouteState,
    setDistanceState,
    setGpsQualityWarning,
    setIsFinishingRun,
    setLastSavedRun,
    setMode,
    setPaused,
    setRouteState,
    setRunLimitationNotice,
    setRunPermissionNoticeVisible,
    setRunning,
    setSavedShareVisible,
    setSelectModeVisible,
    setShowRunModal,
    setShowRunsModal,
    setShowSavedModal,
    setTimeSec,
    showRunModal,
    showRunsModal,
    showSavedModal,
    startContextRef,
    timeSec,
    timeSecRef,
    timerRef,
    timerStallCountRef,
    trackingSessionRef,
    uiStallCountRef,
    watcherRestartCountRef,
    zonePreviewLastAtRef,
    zonePreviewLastPointCountRef,
  };
}
