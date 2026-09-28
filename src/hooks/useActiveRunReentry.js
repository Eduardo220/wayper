import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { auth } from "../firebaseConfig";
import { ACTIVE_RUN_STATUS, calculateActiveRunDurationSeconds } from "../services/runTracking";
import {
  hydrateActiveRunFromRuntime,
  recordNotificationOpen,
  setRuntimeSurfaceState,
} from "../services/runTracking/activeRunRuntimeService.js";
import { recordRunEvent, recordRunSnapshotEvent } from "../services/diagnostics/runDiagnosticsService.js";
import { LOG_CATEGORIES } from "../utils/logger.js";

export default function useActiveRunReentry({ navigation, route, contextRef, restoreRef }) {
  const [recovering, setRecovering] = useState(false);
  const hydrationRef = useRef(false);
  const notificationRequestRef = useRef(null);

  const restore = useCallback(async (options = {}) => {
    const context = contextRef.current;
    if (hydrationRef.current) return Boolean(context.runningRef.current);
    hydrationRef.current = true;
    setRecovering(true);
    try {
      if (options.closeBlockingOverlays !== false) context.closeBlockingOverlays();
      const reason = options.reason || "map_reentry";
      recordRunEvent("RUN_RESTORE_STARTED", {
        reason,
        runId: context.currentRunIdRef.current,
        status: context.runStatusRef.current,
        appState: context.appStateRef.current,
        screen: "MapScreen",
      });
      const result = await hydrateActiveRunFromRuntime(reason, {
        userId: auth.currentUser?.uid || "offline",
        appState: context.appStateRef.current,
        screenFocusState: "focused",
        restartTracking: true,
        forceNotification: true,
        forceRunning: options.forceRunning,
      });
      if (!context.mountedRef.current) return false;
      const snapshot = result?.snapshot;
      const live = snapshot?.activeRunId && [
        ACTIVE_RUN_STATUS.STARTING,
        ACTIVE_RUN_STATUS.RUNNING,
        ACTIVE_RUN_STATUS.PAUSED,
        ACTIVE_RUN_STATUS.RECOVERING,
        ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
      ].includes(String(snapshot.status || "").toUpperCase());
      if (!live) return false;
      context.applySnapshot(snapshot, {
        recovered: options.recovered,
        forceSyncControls: options.forceSyncControls !== false,
        source: reason,
      });
      recordRunSnapshotEvent("RUN_RESTORE_COMPLETED", snapshot, {
        reason,
        source: result?.source || null,
        screen: "MapScreen",
      });
      if (reason === "notification_open") {
        recordRunSnapshotEvent("RUN_NOTIFICATION_OPEN_RESTORE_COMPLETED", snapshot, {
          screen: "MapScreen",
          routePointsCount: snapshot.trustedPath?.length || snapshot.path?.length || 0,
          distanceMeters: Number(snapshot.distanceMeters || snapshot.distance || 0) || 0,
          elapsedMs: calculateActiveRunDurationSeconds(snapshot, { nowMs: Date.now() }) * 1000,
        });
      }
      return true;
    } finally {
      hydrationRef.current = false;
      if (context.mountedRef.current) setRecovering(false);
    }
  }, [contextRef]);

  useEffect(() => {
    restoreRef.current = restore;
    return () => {
      if (restoreRef.current === restore) restoreRef.current = null;
    };
  }, [restore, restoreRef]);

  useFocusEffect(useCallback(() => {
    const context = contextRef.current;
    setRuntimeSurfaceState({ screenFocusState: "focused", appState: context.appStateRef.current });
    recordRunEvent("RUN_SCREEN_FOCUS", {
      runId: context.currentRunIdRef.current,
      status: context.runStatusRef.current,
      appState: context.appStateRef.current,
      screen: "MapScreen",
    });
    restore({ closeBlockingOverlays: false, forceSyncControls: true, recovered: false,
      reason: "screen_focus" }).catch(() => {});
    return () => {
      setRuntimeSurfaceState({ screenFocusState: "blurred", appState: context.appStateRef.current });
      recordRunEvent("RUN_SCREEN_BLUR", {
        runId: context.currentRunIdRef.current,
        status: context.runStatusRef.current,
        appState: context.appStateRef.current,
        screen: "MapScreen",
      });
    };
  }, [contextRef, restore]));

  useEffect(() => {
    const requestId = route?.params?.activeRunOpenRequestId;
    if (!requestId || notificationRequestRef.current === requestId) return;
    notificationRequestRef.current = requestId;
    recordNotificationOpen({
      requestId,
      screen: "MapScreen",
      fromRunNotification: Boolean(route?.params?.fromRunNotification),
    });
    recordRunEvent("RUN_NOTIFICATION_OPEN_RESTORE_STARTED", {
      requestId,
      screen: "MapScreen",
      fromRunNotification: Boolean(route?.params?.fromRunNotification),
      fromDeepLink: Boolean(route?.params?.fromDeepLink),
    }, { category: LOG_CATEGORIES.NOTIFICATION });
    restore({
      closeBlockingOverlays: true,
      forceSyncControls: true,
      recovered: false,
      reason: route?.params?.fromRunNotification
        ? "notification_open"
        : route?.params?.fromDeepLink ? "deep_link_open" : "active_run_open",
    }).catch(() => {});
    navigation?.setParams?.({
      activeRunOpenRequestId: undefined,
      fromRunNotification: undefined,
      fromDeepLink: undefined,
    });
  }, [
    navigation,
    restore,
    route?.params?.activeRunOpenRequestId,
    route?.params?.fromDeepLink,
    route?.params?.fromRunNotification,
  ]);

  return { recovering, restore };
}
