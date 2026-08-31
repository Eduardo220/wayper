import { Platform } from "react-native";
import {
  checkBackgroundLocationPermission,
  checkLocationPermission,
  markPermissionEducationSeen,
  PermissionName,
  requestBackgroundLocationPermission,
  shouldShowPermissionEducation,
} from "../services/permissions";
import {
  recordActiveRunFailure,
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
} from "../services/runTracking/activeRunTrackingService.js";
import { checkpointOnLocationError } from "../services/run/runAutoSaveService.js";
import { recordRunEvent } from "../services/diagnostics/runDiagnosticsService.js";

export async function stopBackgroundLocation(context) {
  try {
    await stopBackgroundLocationUpdates?.({ reason: "map_control" });
    recordRunEvent("LOCATION_WATCHER_STOPPED", {
      runId: context.currentRunIdRef.current,
      watcherStatus: "background_stop_requested",
      reason: "map_control",
      screen: "MapScreen",
    });
  } catch (error) {
    recordRunEvent("LOCATION_WATCHER_STOPPED", {
      runId: context.currentRunIdRef.current,
      watcherStatus: "background_stop_failed",
      reason: "map_control",
      error,
      screen: "MapScreen",
    });
  }
}

async function prepareAndroidBackgroundPermission(context) {
  let background = await checkBackgroundLocationPermission();
  if (background.granted) return true;

  const educate = await shouldShowPermissionEducation(PermissionName.LOCATION_BACKGROUND, background);
  if (educate) {
    await markPermissionEducationSeen(PermissionName.LOCATION_BACKGROUND);
    if (context.mountedRef.current) context.setRunLimitationNotice({
      type: "background",
      title: "Corrida em segundo plano",
      description: "Para registrar melhor com a tela bloqueada, permita localizacao o tempo todo.",
      status: background.status,
      canAskAgain: background.canAskAgain !== false,
    });
    return false;
  }

  background = await requestBackgroundLocationPermission();
  if (background.granted || context.backgroundPermissionWarnedRef.current) return true;

  context.backgroundPermissionWarnedRef.current = true;
  const error = Object.assign(new Error("background location permission denied"), {
    code: "LOCATION_BACKGROUND_PERMISSION_DENIED",
  });
  await recordActiveRunFailure?.(error, {
    source: "MapScreen",
    reason: "background_location_permission_denied",
  });
  if (context.mountedRef.current) context.setRunLimitationNotice({
    type: "background",
    title: background.canAskAgain ? "Background limitado" : "Background bloqueado",
    description: "A corrida foi iniciada, mas a tela bloqueada pode registrar menos pontos.",
    status: background.status,
    canAskAgain: background.canAskAgain !== false,
  });
  return true;
}

export async function startBackgroundLocation(context) {
  try {
    const foreground = await checkLocationPermission();
    if (!foreground.granted) {
      const error = Object.assign(new Error("foreground location permission denied"), {
        code: "LOCATION_FOREGROUND_PERMISSION_DENIED",
      });
      await recordActiveRunFailure?.(error, {
        source: "MapScreen",
        reason: "foreground_location_permission_denied",
      });
      return false;
    }

    if (Platform.OS === "android" && !(await prepareAndroidBackgroundPermission(context))) return false;

    const started = await startBackgroundLocationUpdates?.({ force: true });
    if (started === false) throw Object.assign(new Error("background location service did not start"), {
      code: "BACKGROUND_LOCATION_SERVICE_NOT_STARTED",
    });
    recordRunEvent("LOCATION_WATCHER_STARTED", {
      runId: context.currentRunIdRef.current,
      watcherStatus: "background_start_requested",
      screen: "MapScreen",
    });
    context.recordSnapshot("watcher_start", {
      watcherStatus: "background_start_requested",
    }, { minIntervalMs: 30000 });
    return true;
  } catch (error) {
    context.watcherRestartCountRef.current += 1;
    context.lastRunDiagnosticErrorRef.current = {
      message: error?.message || String(error),
      code: error?.code || null,
      at: new Date().toISOString(),
    };
    recordRunEvent("LOCATION_WATCHER_RESTARTED", {
      runId: context.currentRunIdRef.current,
      watcherStatus: "background_start_failed",
      error,
      screen: "MapScreen",
    });
    context.recordSnapshot("watcher_restart", { watcherStatus: "background_start_failed" }, { force: true });
    checkpointOnLocationError(error, { phase: "background_location_service" }).catch(() => {});
    return false;
  }
}
