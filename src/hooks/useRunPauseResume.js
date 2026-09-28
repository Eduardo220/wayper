import { useCallback } from "react";
import * as Location from "expo-location";
import { ACTIVE_RUN_STATUS, debugTracking, normalizeLocation } from "../services/runTracking";
import { pauseActiveRun, resumeActiveRun } from "../services/runTracking/activeRunTrackingService.js";
import { checkpointOnLocationError } from "../services/run/runAutoSaveService.js";
import { checkLocationPermission } from "../services/permissions";
import { recordRunEvent } from "../services/diagnostics/runDiagnosticsService.js";

async function pauseRun(context) {
  recordRunEvent("PAUSE_PRESSED", {
    runId: context.currentRunIdRef.current,
    status: context.runStatusRef.current,
    running: context.running,
    paused: context.paused,
    screen: "MapScreen",
  });
  context.recordSnapshot("pause", { trigger: "pause_pressed" }, { force: true });
  if (!context.running || context.paused) {
    recordRunEvent("PAUSE_FAILED", {
      runId: context.currentRunIdRef.current,
      status: context.runStatusRef.current,
      reason: "invalid_state",
      screen: "MapScreen",
    });
    return;
  }
  try {
    const snapshot = await pauseActiveRun?.({
      expectedRunId: context.currentRunIdRef.current,
      endedAtMs: Date.now(),
      source: "MapScreen",
    });
    const confirmed = snapshot?.activeRunId &&
      snapshot.nativeLifecycleResult?.transitionConfirmed === true &&
      String(snapshot.status || "").toUpperCase() === ACTIVE_RUN_STATUS.PAUSED &&
      (!context.currentRunIdRef.current ||
        String(snapshot.activeRunId) === String(context.currentRunIdRef.current));
    if (!confirmed) {
      const error = new Error("activeRunTrackingService.pauseActiveRun did not confirm PAUSED");
      error.code = "RUN_PAUSE_NOT_CONFIRMED";
      throw error;
    }
    context.applySnapshot(snapshot, { source: "pause_button", syncControls: false, forceSyncControls: false });
    context.runningRef.current = false;
    context.runStatusRef.current = "paused";
    context.setPaused(true);
    debugTracking("session_paused", {
      runSessionId: context.currentRunIdRef.current,
      segments: context.trackingSessionRef.current?.getState?.()?.segments?.length || 0,
      distanceMeters: context.distanceRef.current,
    });
  } catch (error) {
    recordRunEvent("PAUSE_FAILED", {
      runId: context.currentRunIdRef.current,
      status: context.runStatusRef.current,
      source: "activeRunTrackingService",
      error,
      screen: "MapScreen",
    });
    return;
  }
  context.stopWatcherAndPolling();
  context.stopElapsedTimer();
  recordRunEvent("PAUSE_SUCCESS", {
    runId: context.currentRunIdRef.current,
    status: "PAUSED",
    segmentsCount: context.trackingSessionRef.current?.getState?.()?.segments?.length || 0,
    distance: context.distanceRef.current,
    screen: "MapScreen",
  });
  context.recordSnapshot("pause_success", { status: ACTIVE_RUN_STATUS.PAUSED }, { force: true });
}

async function resumeRun(context) {
  recordRunEvent("RESUME_PRESSED", {
    runId: context.currentRunIdRef.current,
    status: context.runStatusRef.current,
    running: context.running,
    paused: context.paused,
    screen: "MapScreen",
  });
  context.recordSnapshot("resume", { trigger: "resume_pressed" }, { force: true });
  if (!context.running || !context.paused) return;
  try {
    const permission = await checkLocationPermission();
    context.setLocationPermission(permission);
    context.locationPermissionRef.current = permission;
    context.setPermissionDenied(!permission.granted);
    if (!permission.granted) {
      context.setRunPermissionNoticeVisible(true);
      recordRunEvent("RESUME_FAILED", {
        runId: context.currentRunIdRef.current,
        reason: "location_permission_denied",
        permissionStatus: permission.status,
        screen: "MapScreen",
      });
      return;
    }
    const snapshot = await resumeActiveRun?.({
      expectedRunId: context.currentRunIdRef.current,
      startedAtMs: Date.now(),
      source: "MapScreen",
    });
    const confirmed = snapshot?.activeRunId &&
      snapshot.nativeLifecycleResult?.transitionConfirmed === true &&
      String(snapshot.status || "").toUpperCase() === ACTIVE_RUN_STATUS.RUNNING &&
      (!context.currentRunIdRef.current ||
        String(snapshot.activeRunId) === String(context.currentRunIdRef.current));
    if (!confirmed) {
      const error = new Error("activeRunTrackingService.resumeActiveRun did not confirm RUNNING");
      error.code = "RUN_RESUME_NOT_CONFIRMED";
      throw error;
    }
    context.applySnapshot(snapshot, { source: "resume_button", syncControls: false, forceSyncControls: false });
    context.setPaused(false);
    context.runningRef.current = true;
    context.runStatusRef.current = "active";
    context.startElapsedTimer();
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, timeout: 7000 });
      const point = position?.coords ? normalizeLocation({
        ...position.coords,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: position.timestamp || Date.now(),
        source: "expo-location",
      }) : null;
      if (point) context.setLocation(point);
    } catch (error) {
      checkpointOnLocationError(error, { phase: "resume_current_position" }).catch(() => {});
    }
    await context.startLocationWatcher();
    recordRunEvent("RESUME_SUCCESS", {
      runId: context.currentRunIdRef.current,
      status: "RUNNING",
      segmentsCount: context.trackingSessionRef.current?.getState?.()?.segments?.length || 0,
      screen: "MapScreen",
    });
    context.recordSnapshot("resume_success", { status: ACTIVE_RUN_STATUS.RUNNING }, { force: true });
  } catch (error) {
    recordRunEvent("RESUME_FAILED", {
      runId: context.currentRunIdRef.current,
      status: context.runStatusRef.current,
      error,
      screen: "MapScreen",
    });
  }
}

export default function useRunPauseResume(contextRef) {
  return {
    pauseRun: useCallback(() => pauseRun(contextRef.current), [contextRef]),
    resumeRun: useCallback(() => resumeRun(contextRef.current), [contextRef]),
  };
}
