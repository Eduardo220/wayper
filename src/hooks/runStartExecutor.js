import * as Location from "expo-location";
import { auth } from "../firebaseConfig";
import { ACTIVE_RUN_STATUS, debugTracking } from "../services/runTracking";
import {
  getActiveRunSnapshot,
  startActiveRun,
} from "../services/runTracking/activeRunTrackingService.js";
import { hydrateActiveRunFromRuntime } from "../services/runTracking/activeRunRuntimeService.js";
import { checkpointOnLocationError } from "../services/run/runAutoSaveService.js";
import { findRecoverableRunForUser } from "../services/run/runRecoveryService.js";
import { checkLocationPermission } from "../services/permissions";
import { recordRunEvent, recordRunSnapshotEvent } from "../services/diagnostics/runDiagnosticsService.js";

const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const LIVE_STATUSES = [
  ACTIVE_RUN_STATUS.STARTING,
  ACTIVE_RUN_STATUS.RUNNING,
  ACTIVE_RUN_STATUS.PAUSED,
  ACTIVE_RUN_STATUS.RECOVERING,
  ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
];

async function existingRunGuard(context, selectedMode) {
  const runtime = await hydrateActiveRunFromRuntime("start_guard", {
    userId: auth.currentUser?.uid || "offline",
    appState: context.appStateRef.current,
    screenFocusState: "focused",
    restartTracking: true,
  });
  const snapshot = runtime?.snapshot || await getActiveRunSnapshot?.();
  if (snapshot?.activeRunId && LIVE_STATUSES.includes(snapshot.status)) {
    context.applySnapshot(snapshot, { recovered: true, forceSyncControls: true });
    recordRunEvent("RUN_START_FAILED", {
      mode: selectedMode,
      reason: "existing_active_run_recovered",
      runId: snapshot.activeRunId,
      level: "warn",
      screen: "MapScreen",
    });
    return { ok: false, reason: "existing_active_run_recovered", snapshot };
  }
  if (!snapshot?.activeRunId) return null;
  const recovery = await findRecoverableRunForUser(auth.currentUser?.uid || "offline", {
    activeSnapshot: snapshot,
  });
  if (recovery?.recoverable) context.recoveryUiRef.current.showCandidate?.(recovery);
  recordRunSnapshotEvent("RUN_START_FAILED", snapshot, {
    mode: selectedMode,
    reason: "existing_run_requires_recovery",
    recoveryAvailable: Boolean(recovery?.recoverable),
    level: "warn",
    screen: "MapScreen",
  });
  return { ok: false, reason: "existing_run_requires_recovery", snapshot };
}

function resetFailedStart(context) {
  context.setRunning(false);
  context.setPaused(false);
  context.runningRef.current = false;
  context.runStatusRef.current = "idle";
  context.currentRunIdRef.current = null;
  context.resetTrackingPipeline({ segmentId: 0 });
  context.timeSecRef.current = 0;
  context.distanceRef.current = 0;
  context.setTimeSec(0);
  context.setDistanceState(0);
  context.stopWatcherAndPolling();
  context.stopElapsedTimer();
}

export default async function startRun(context, selectedMode = "free", options = {}) {
  const pressedAtMs = Number(options.pressedAtMs || Date.now());
  let activeRunStarted = false;
  try {
    recordRunEvent("RUN_START_ATTEMPT", {
      mode: selectedMode,
      running: context.runningRef.current || context.running,
      screen: "MapScreen",
    });
    if (context.runningRef.current || context.running) {
      return { ok: false, reason: "already_running" };
    }
    const existing = await existingRunGuard(context, selectedMode);
    if (existing) return existing;

    const permission = options.permission?.granted
      ? options.permission
      : await checkLocationPermission();
    context.setLocationPermission(permission);
    context.locationPermissionRef.current = permission;
    context.setPermissionDenied(!permission.granted);
    if (!permission.granted) {
      context.setRunPermissionNoticeVisible(true);
      return { ok: false, reason: "location_permission_denied", permission };
    }

    context.setRunning(false);
    context.setPaused(false);
    context.setMode(selectedMode);
    context.modeRef.current = selectedMode;
    context.runningRef.current = false;
    context.runStatusRef.current = "starting";
    context.cancelReplay();
    context.setCaptureResult(null);
    context.closeSelectedTerritory();
    const startedAtMs = Date.now();
    const runId = uid();
    context.currentRunIdRef.current = runId;
    context.resetTrackingPipeline({ segmentId: 0 });
    context.trackingSessionRef.current?.start?.({ startedAt: startedAtMs });
    context.setPolygons([]);
    context.setCompletedZonePreview([]);
    context.distanceRef.current = 0;
    context.setDistanceState(0);
    context.zonePreviewLastAtRef.current = 0;
    context.timeSecRef.current = 0;
    context.setTimeSec(0);
    debugTracking("session_started", { runSessionId: runId, mode: selectedMode });
    recordRunEvent("TRACKING_START_REQUESTED", {
      marker: "tracking_start_requested",
      runId,
      mode: selectedMode,
      elapsedSincePressMs: Date.now() - pressedAtMs,
      screen: "MapScreen",
    });
    context.recordSnapshot("start", {
      runId,
      status: ACTIVE_RUN_STATUS.STARTING,
      trigger: "start_run",
    }, { force: true });

    const snapshot = await startActiveRun?.({
      activeRunId: runId,
      userId: auth.currentUser?.uid || "offline",
      mode: selectedMode,
      startedAtMs,
      meta: { permissions: {
        locationStatus: permission.status || null,
        locationGranted: Boolean(permission.granted),
        canAskAgain: permission.canAskAgain !== false,
      } },
    });
    if (snapshot?.activeRunId !== runId && snapshot?.meta?.protectedFromReplace) {
      context.applySnapshot(snapshot, { recovered: true, forceSyncControls: true });
      return { ok: false, reason: "existing_active_run_recovered", snapshot };
    }
    if (!snapshot?.activeRunId || snapshot.nativeLifecycleResult?.transitionConfirmed !== true) {
      const error = new Error("activeRunTrackingService.startActiveRun did not confirm native lifecycle");
      error.code = "RUN_START_NOT_CONFIRMED";
      throw error;
    }
    context.currentRunIdRef.current = snapshot.activeRunId;
    context.applySnapshot(snapshot, { source: "run_started", syncControls: false });
    activeRunStarted = true;
    context.startElapsedTimer();
    await context.startLocationWatcher();
    recordRunEvent("TRACKING_STARTED", {
      marker: "tracking_started",
      runId: context.currentRunIdRef.current,
      mode: selectedMode,
      elapsedSincePressMs: Date.now() - pressedAtMs,
      screen: "MapScreen",
    });
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, timeout: 7000 });
      if (position?.coords) context.handleLocationUpdate({
        ...position.coords,
        timestamp: position.timestamp,
        source: "expo-location",
        runSessionId: context.currentRunIdRef.current,
      });
    } catch (error) {
      checkpointOnLocationError(error, { phase: "start_current_position" }).catch(() => {});
    }
    return { ok: true, runId: context.currentRunIdRef.current };
  } catch (error) {
    recordRunEvent("RUN_START_FAILED", { mode: selectedMode, error, screen: "MapScreen" });
    if (!activeRunStarted) resetFailedStart(context);
    return { ok: false, reason: "exception", error };
  }
}
