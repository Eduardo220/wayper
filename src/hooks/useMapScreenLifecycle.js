import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import { WAYPER_FALLBACK_COORD } from "../components/Map/WayperMapLibre";
import { stopForegroundWatcher } from "../services/runTracking/activeRunForegroundWatcher.js";
import { setRuntimeSurfaceState } from "../services/runTracking/activeRunRuntimeService.js";
import {
  checkpointOnLocationError,
  forceCheckpointForAppState,
} from "../services/run/runAutoSaveService.js";
import { checkLocationPermission, ensureLocationForRun, openAppSettings } from "../services/permissions";
import { recordRunEvent } from "../services/diagnostics/runDiagnosticsService.js";
import { listRunHistory } from "../repositories/runRepository.js";

const POSITION_TIMEOUT_MS = 6000;

function recordUnmount({ appStateRef, currentRunIdRef, runStatusRef }) {
  recordRunEvent("MAP_SCREEN_UNMOUNTED", {
    runId: currentRunIdRef.current,
    status: runStatusRef.current,
    appState: appStateRef.current,
    screen: "MapScreen",
  }, { forcePersist: true });
}

export default function useMapScreenLifecycle({
  currentRunIdRef,
  recordDiagnosticsSnapshotRef,
  restoreActiveRunForReentryRef,
  runningRef,
  runStatusRef,
  timerRef,
}) {
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [locationPermission, setLocationPermission] = useState(null);
  const [runsList, setRunsList] = useState([]);
  const [polygons, setPolygons] = useState([]);
  const appStateRef = useRef(AppState.currentState);
  const mountedRef = useRef(true);
  const locationPermissionRef = useRef(null);
  const backgroundPermissionWarnedRef = useRef(false);

  const refreshForegroundLocation = useCallback(async ({ updatePosition = true } = {}) => {
    const permission = await checkLocationPermission();
    if (!mountedRef.current) return permission;
    setLocationPermission(permission);
    locationPermissionRef.current = permission;
    setPermissionDenied(!permission.granted);
    if (!permission.granted) {
      setLocation((current) => current || WAYPER_FALLBACK_COORD);
      return permission;
    }
    if (!updatePosition) return permission;
    try {
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), POSITION_TIMEOUT_MS)),
      ]);
      if (mountedRef.current && position?.coords) setLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch (error) {
      checkpointOnLocationError(error, { phase: "foreground_position_refresh", minIntervalMs: 15000 })
        .catch(() => {});
      if (mountedRef.current) setLocation((current) => current || WAYPER_FALLBACK_COORD);
    }
    return permission;
  }, []);

  const requestMapLocationPermission = useCallback(async () => {
    if (locationPermission?.canAskAgain === false) {
      await openAppSettings();
      return null;
    }
    const permission = await ensureLocationForRun();
    setLocationPermission(permission);
    locationPermissionRef.current = permission;
    setPermissionDenied(!permission.granted);
    if (permission.granted) await refreshForegroundLocation({ updatePosition: true });
    return permission;
  }, [locationPermission?.canAskAgain, refreshForegroundLocation]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    let appStateSubscription = null;
    recordRunEvent("MAP_SCREEN_MOUNTED", { appState: appStateRef.current, screen: "MapScreen" }, {
      forcePersist: true,
    });

    const handleAppStateChange = (next) => {
      appStateRef.current = next;
      setRuntimeSurfaceState({ appState: next, screenFocusState: "mounted" });
      if (next !== "active" && currentRunIdRef.current) {
        recordRunEvent("RUN_APP_BACKGROUND", {
          runId: currentRunIdRef.current,
          status: runStatusRef.current,
          appState: next,
          screen: "MapScreen",
        });
        recordDiagnosticsSnapshotRef.current?.("app_state_background", { appState: next }, { force: true });
        recordRunEvent("APP_BACKGROUND", {
          runId: currentRunIdRef.current,
          status: runStatusRef.current,
          appState: next,
          screen: "MapScreen",
        });
        forceCheckpointForAppState(next).catch(() => {});
      }
      if (next !== "active") return;

      const expectedActiveRun = Boolean(currentRunIdRef.current || runningRef.current ||
        ["active", "paused", "recovering", "finishing"].includes(String(runStatusRef.current || "")));
      recordRunEvent("RUN_APP_ACTIVE", {
        runId: currentRunIdRef.current,
        status: runStatusRef.current,
        appState: next,
        screen: "MapScreen",
      });
      recordDiagnosticsSnapshotRef.current?.("app_state_active", { appState: next }, { force: true });
      recordRunEvent("APP_ACTIVE", {
        runId: currentRunIdRef.current,
        status: runStatusRef.current,
        appState: next,
        screen: "MapScreen",
      });
      const restore = restoreActiveRunForReentryRef.current;
      if (typeof restore !== "function") {
        if (!runningRef.current) refreshForegroundLocation({ updatePosition: true });
        return;
      }
      restore({ reason: "app_state_active", forceSyncControls: true }).then((restored) => {
        if (!restored && expectedActiveRun) recordRunEvent("ACTIVE_RUN_MISSING_AFTER_FOREGROUND", {
          runId: currentRunIdRef.current,
          status: runStatusRef.current,
          appState: next,
          screen: "MapScreen",
          level: "warn",
        });
        if (!restored && !runningRef.current) refreshForegroundLocation({ updatePosition: true });
      }).catch(() => {
        if (!runningRef.current) refreshForegroundLocation({ updatePosition: true });
      });
    };

    (async () => {
      try {
        await refreshForegroundLocation({ updatePosition: true });
        if (cancelled) return;
        appStateSubscription = AppState.addEventListener("change", handleAppStateChange);
        const persistedRuns = (await listRunHistory()).data;
        if (!cancelled && Array.isArray(persistedRuns) && persistedRuns.length > 0) setRunsList(persistedRuns);
        if (!cancelled) setPolygons([]);
      } catch {
        if (!cancelled) {
          setPermissionDenied(true);
          setLocation((current) => current || WAYPER_FALLBACK_COORD);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      recordUnmount({ appStateRef, currentRunIdRef, runStatusRef });
      stopForegroundWatcher();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      appStateSubscription?.remove?.();
    };
  }, [
    currentRunIdRef,
    recordDiagnosticsSnapshotRef,
    refreshForegroundLocation,
    restoreActiveRunForReentryRef,
    runningRef,
    runStatusRef,
    timerRef,
  ]);

  return {
    appStateRef,
    backgroundPermissionWarnedRef,
    loading,
    location,
    locationPermission,
    locationPermissionRef,
    mountedRef,
    permissionDenied,
    polygons,
    refreshForegroundLocation,
    requestMapLocationPermission,
    runsList,
    setLocation,
    setLocationPermission,
    setPermissionDenied,
    setPolygons,
    setRunsList,
  };
}
