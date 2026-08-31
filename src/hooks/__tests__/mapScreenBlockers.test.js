import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let stateValues = [];
let stateSetters = [];
let refValues = [];
let stateCursor = 0;
let refCursor = 0;
let effectCleanups = [];

function resetHookRuntime() {
  stateValues = [];
  stateSetters = [];
  refValues = [];
  stateCursor = 0;
  refCursor = 0;
  effectCleanups = [];
}

function renderHooks(render) {
  stateCursor = 0;
  refCursor = 0;
  return render();
}

jest.unstable_mockModule("react", () => ({
  useCallback: (callback) => callback,
  useEffect: (effect) => {
    const cleanup = effect();
    if (typeof cleanup === "function") effectCleanups.push(cleanup);
  },
  useRef: (initialValue) => {
    const index = refCursor++;
    if (!refValues[index]) refValues[index] = { current: initialValue };
    return refValues[index];
  },
  useState: (initialValue) => {
    const index = stateCursor++;
    if (!(index in stateValues)) {
      stateValues[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      stateSetters[index] = jest.fn((nextValue) => {
        stateValues[index] = typeof nextValue === "function"
          ? nextValue(stateValues[index])
          : nextValue;
      });
    }
    return [stateValues[index], stateSetters[index]];
  },
}));

jest.unstable_mockModule("@react-navigation/native", () => ({ useFocusEffect: jest.fn() }));

const alert = jest.fn();
const addEventListener = jest.fn(() => ({ remove: jest.fn() }));
jest.unstable_mockModule("react-native", () => ({
  Alert: { alert },
  AppState: { currentState: "active", addEventListener },
}));

const getCurrentPositionAsync = jest.fn(async () => ({
  coords: { latitude: -23.56, longitude: -46.64 },
}));
jest.unstable_mockModule("expo-location", () => ({
  Accuracy: { Highest: 6 },
  getCurrentPositionAsync,
}));

jest.unstable_mockModule("../../firebaseConfig.js", () => ({
  auth: { currentUser: { uid: "user-1" } },
}));
jest.unstable_mockModule("../../components/Map/WayperMapLibre.js", () => ({
  WAYPER_FALLBACK_COORD: { latitude: -23.56, longitude: -46.64 },
}));

const stopForegroundWatcher = jest.fn();
const onActiveRunSnapshot = jest.fn(() => jest.fn());
jest.unstable_mockModule("../../services/runTracking/activeRunForegroundWatcher.js", () => ({
  stopForegroundWatcher,
}));
jest.unstable_mockModule("../../services/runTracking/activeRunTrackingService.js", () => ({
  onActiveRunSnapshot,
}));

const hydrateActiveRunFromRuntime = jest.fn();
const recordNotificationOpen = jest.fn();
const setRuntimeSurfaceState = jest.fn();
jest.unstable_mockModule("../../services/runTracking/activeRunRuntimeService.js", () => ({
  hydrateActiveRunFromRuntime,
  recordNotificationOpen,
  setRuntimeSurfaceState,
}));

const ACTIVE_RUN_STATUS = {
  STARTING: "STARTING",
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  RECOVERING: "RECOVERING",
  ERROR_RECOVERABLE: "ERROR_RECOVERABLE",
};
jest.unstable_mockModule("../../services/runTracking/index.js", () => ({
  ACTIVE_RUN_STATUS,
  calculateActiveRunDurationSeconds: jest.fn(() => 0),
  limitPathForRendering: jest.fn((path) => path),
}));

const recordRunEvent = jest.fn();
const recordRunSnapshotEvent = jest.fn();
jest.unstable_mockModule("../../services/diagnostics/runDiagnosticsService.js", () => ({
  recordRunEvent,
  recordRunSnapshotEvent,
}));
jest.unstable_mockModule("../../utils/logger.js", () => ({
  LOG_CATEGORIES: { NOTIFICATION: "notification" },
}));

jest.unstable_mockModule("../../services/run/runAutoSaveService.js", () => ({
  checkpointOnLocationError: jest.fn(async () => {}),
  forceCheckpointForAppState: jest.fn(async () => {}),
}));
jest.unstable_mockModule("../../services/permissions.js", () => ({
  checkLocationPermission: jest.fn(async () => ({ granted: true })),
  ensureLocationForRun: jest.fn(async () => ({ granted: true })),
  openAppSettings: jest.fn(async () => {}),
}));
jest.unstable_mockModule("../../repositories/runRepository.js", () => ({
  listRunHistory: jest.fn(async () => ({ data: [] })),
}));

const projectActiveRunSnapshot = jest.fn(() => ({
  status: ACTIVE_RUN_STATUS.RUNNING,
  paused: false,
  recoverable: false,
  live: true,
  session: {},
  runStatus: "active",
  trustedPath: [],
  rawPath: [],
  livePath: [],
  liveSegments: [],
  distanceMeters: 0,
  durationSeconds: 0,
  incomingPathLength: 0,
  incomingDistanceMeters: 0,
  location: null,
  gpsQualityWarning: null,
}));
jest.unstable_mockModule("../../screens/map/activeRunProjection.js", () => ({
  projectActiveRunSnapshot,
}));

const discardRecoveredRun = jest.fn();
jest.unstable_mockModule("../../services/run/runRecoveryService.js", () => ({
  buildRunDataFromRecoveredRun: jest.fn(),
  discardRecoveredRun,
  findRecoverableRunForUser: jest.fn(async () => null),
  hydrateRecoverableRunCandidate: jest.fn(),
  isFinishedRecovery: jest.fn(() => false),
  isLiveRecovery: jest.fn(() => false),
}));
jest.unstable_mockModule("../../repositories/runDeferredTaskQueueRepository.js", () => ({
  default: {},
}));
jest.unstable_mockModule("../../services/run/runFinalizationService.js", () => ({
  enqueuePostRunProcessing: jest.fn(),
  persistMinimumFinishedRun: jest.fn(),
}));
jest.unstable_mockModule("../../services/run/runFinalizationDependencies.js", () => ({
  RUN_FINALIZATION_PERSISTENCE_DEPENDENCIES: {},
}));
jest.unstable_mockModule("../../services/run/runSyncQueueService.js", () => ({
  schedulePendingRunsSync: jest.fn(),
}));

const { default: useRunRecoveryFlow } = await import("../useRunRecoveryFlow.js");
const { default: useMapScreenLifecycle } = await import("../useMapScreenLifecycle.js");
const { default: useActiveRunProjection } = await import("../useActiveRunProjection.js");
const { default: useActiveRunReentry } = await import("../useActiveRunReentry.js");

function recoveryOptions() {
  return {
    loading: true,
    mountedRef: { current: true },
    applySnapshot: jest.fn(),
    closeBlockingOverlays: jest.fn(),
    resetRunVisuals: jest.fn(async () => {}),
    setCurrentRunData: jest.fn(),
    setShowRunModal: jest.fn(),
    stopRun: jest.fn(),
  };
}

function openDiscardConfirmation(options, candidate) {
  let flow = renderHooks(() => useRunRecoveryFlow(options));
  flow.showCandidate(candidate);
  flow = renderHooks(() => useRunRecoveryFlow(options));
  flow.onDiscard();
  return { flow, confirm: alert.mock.calls.at(-1)[2][1].onPress };
}

describe("MapScreen blocker regressions", () => {
  beforeEach(() => {
    resetHookRuntime();
    jest.clearAllMocks();
  });

  test("discard failure keeps recovery visible and retryable", async () => {
    const candidate = { id: "recovery-1", recoverable: true, source: "tracking" };
    const options = recoveryOptions();
    const { confirm } = openDiscardConfirmation(options, candidate);
    discardRecoveredRun.mockResolvedValueOnce({ ok: false, error: new Error("cleanup failed") });

    await confirm();
    const afterFailure = renderHooks(() => useRunRecoveryFlow(options));

    expect(afterFailure.pending).toBe(candidate);
    expect(afterFailure.modalVisible).toBe(true);
    expect(options.resetRunVisuals).not.toHaveBeenCalled();
    expect(alert).toHaveBeenLastCalledWith(
      "Recuperacao",
      "Nao foi possivel descartar a corrida recuperada."
    );
  });

  test("discard success closes recovery and resets visuals", async () => {
    const candidate = { id: "recovery-2", recoverable: true, source: "tracking" };
    const options = recoveryOptions();
    const { confirm } = openDiscardConfirmation(options, candidate);
    discardRecoveredRun.mockResolvedValueOnce({ ok: true });

    await confirm();
    const afterSuccess = renderHooks(() => useRunRecoveryFlow(options));

    expect(afterSuccess.pending).toBeNull();
    expect(afterSuccess.modalVisible).toBe(false);
    expect(options.resetRunVisuals).toHaveBeenCalledTimes(1);
  });

  test("late reentry result cannot reactivate projection resources after lifecycle cleanup", async () => {
    let resolveHydration;
    hydrateActiveRunFromRuntime.mockReturnValueOnce(new Promise((resolve) => {
      resolveHydration = resolve;
    }));
    const startElapsedTimer = jest.fn();
    const startLocationWatcher = jest.fn(async () => {});
    const startBackgroundLocationService = jest.fn(async () => {});
    const projectionSetters = {
      setRunning: jest.fn(), setPaused: jest.fn(), setMode: jest.fn(), setRouteState: jest.fn(),
      setDisplayRouteState: jest.fn(), setDisplayRouteSegments: jest.fn(), setDistanceState: jest.fn(),
      setTimeSec: jest.fn(), setLocation: jest.fn(), setGpsQualityWarning: jest.fn(),
    };
    const timerRef = { current: null };
    const lifecycle = renderHooks(() => useMapScreenLifecycle({
      currentRunIdRef: { current: null },
      recordDiagnosticsSnapshotRef: { current: null },
      restoreActiveRunForReentryRef: { current: null },
      runningRef: { current: false },
      runStatusRef: { current: "idle" },
      timerRef,
    }));
    const lifecycleCleanup = effectCleanups[0];
    const refs = {
      trackingSession: { current: null }, currentRunId: { current: null }, mode: { current: "free" },
      running: { current: false }, runStatus: { current: "idle" }, rawPath: { current: [] },
      savedPath: { current: [] }, routeState: { current: [] }, displayPath: { current: [] },
      displaySegments: { current: [] }, distance: { current: 0 }, timeSec: { current: 0 },
      lastAcceptedLocation: { current: null }, lastLocationAcceptedAt: { current: null },
      timer: timerRef, recoveryUi: { current: {} }, activeRunUiTimer: { current: null },
      pendingUiSnapshot: { current: null }, lastActiveRunUiAt: { current: 0 },
      appState: lifecycle.appStateRef, mounted: lifecycle.mountedRef,
    };
    const applySnapshot = useActiveRunProjection({
      refs,
      setters: projectionSetters,
      cancelReplay: jest.fn(),
      recordSnapshot: jest.fn(),
      startBackgroundLocationService,
      startElapsedTimer,
      startLocationWatcher,
      stopBackgroundLocationService: jest.fn(),
      stopElapsedTimer: jest.fn(),
      stopWatcherAndPolling: jest.fn(),
      updateActiveZonePreview: jest.fn(),
    });
    const contextRef = { current: {
      runningRef: refs.running,
      currentRunIdRef: refs.currentRunId,
      runStatusRef: refs.runStatus,
      appStateRef: refs.appState,
      mountedRef: refs.mounted,
      closeBlockingOverlays: jest.fn(),
      applySnapshot,
    } };
    const stateSetterCount = stateSetters.length;
    const { restore } = useActiveRunReentry({
      navigation: null,
      route: null,
      contextRef,
      restoreRef: { current: null },
    });
    const recoveringSetter = stateSetters[stateSetterCount];

    const pendingRestore = restore({ reason: "test_reentry", forceSyncControls: true });
    lifecycleCleanup();
    resolveHydration({ snapshot: { activeRunId: "run-1", status: ACTIVE_RUN_STATUS.RUNNING } });

    await expect(pendingRestore).resolves.toBe(false);
    expect(lifecycle.mountedRef.current).toBe(false);
    expect(stopForegroundWatcher).toHaveBeenCalledTimes(1);
    expect(projectActiveRunSnapshot).not.toHaveBeenCalled();
    expect(startElapsedTimer).not.toHaveBeenCalled();
    expect(startLocationWatcher).not.toHaveBeenCalled();
    expect(startBackgroundLocationService).not.toHaveBeenCalled();
    expect(projectionSetters.setRunning).not.toHaveBeenCalled();
    expect(recoveringSetter).toHaveBeenCalledTimes(1);
    expect(recoveringSetter).toHaveBeenCalledWith(true);
  });
});
