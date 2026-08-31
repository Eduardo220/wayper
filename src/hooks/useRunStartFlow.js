import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import {
  ensureLocationForRun,
  markPermissionEducationSeen,
  PermissionName,
  requestNotificationPermission,
  shouldShowPermissionEducation,
} from "../services/permissions";
import { recordRunEvent } from "../services/diagnostics/runDiagnosticsService.js";
import {
  RUN_START_COUNTDOWN_SECONDS,
  RUN_START_COUNTDOWN_TICK_MS,
} from "../config/runStartConfig.js";
import startRunExecutor from "./runStartExecutor.js";

async function runPreflight(context) {
  const permission = await ensureLocationForRun();
  if (!context.mountedRef.current) return { ok: false, reason: "unmounted" };
  context.setLocationPermission(permission);
  context.locationPermissionRef.current = permission;
  context.setPermissionDenied(!permission.granted);
  recordRunEvent("LOCATION_PERMISSION_CHECKED", {
    permissionName: "locationForeground",
    status: permission.status,
    granted: Boolean(permission.granted),
    canAskAgain: permission.canAskAgain !== false,
    screen: "MapScreen",
  });
  if (!permission.granted) return { ok: false, reason: "location_permission_denied", permission };
  if (Platform.OS !== "android") return { ok: true, permission };

  try {
    const educate = await shouldShowPermissionEducation(PermissionName.NOTIFICATIONS);
    let notification = null;
    if (educate) {
      await markPermissionEducationSeen(PermissionName.NOTIFICATIONS);
      if (context.mountedRef.current) context.setRunLimitationNotice({
        type: "notification",
        title: "Notificacao da corrida",
        description: "A notificacao persistente ajuda a pausar e retomar pelo Android. A corrida segue no app se voce negar.",
        status: "education",
        canAskAgain: true,
      });
    } else {
      notification = await requestNotificationPermission();
    }
    if (notification && !notification.granted && context.mountedRef.current) {
      context.setRunLimitationNotice({
        type: "notification",
        title: notification.canAskAgain === false ? "Notificacao bloqueada" : "Notificacao desativada",
        description: "A corrida continua preservada, mas os controles fora da tela podem nao aparecer.",
        status: notification.status,
        canAskAgain: notification.canAskAgain !== false,
      });
    }
  } catch (error) {
    recordRunEvent("START_FAILED", {
      marker: "start_failed",
      phase: "notification_permission",
      error,
      level: "warn",
      screen: "MapScreen",
    });
  }
  return { ok: true, permission };
}

export default function useRunStartFlow(contextRef) {
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [counting, setCounting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const startingRef = useRef(false);
  const countdownTimerRef = useRef(null);

  const clearCountdown = useCallback(() => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = null;
  }, []);
  const resetFeedback = useCallback(() => {
    clearCountdown();
    startingRef.current = false;
    if (!contextRef.current.mountedRef.current) return;
    setIsStartingRun(false);
    setCounting(false);
    setCountdown(0);
  }, [clearCountdown, contextRef]);
  const waitCountdown = useCallback((selectedMode, pressedAtMs) => new Promise((resolve) => {
    clearCountdown();
    let remaining = Math.max(0, Number(RUN_START_COUNTDOWN_SECONDS) || 0);
    if (!remaining) {
      recordRunEvent("COUNTDOWN_SKIPPED", { mode: selectedMode, reason: "disabled", screen: "MapScreen" });
      resolve();
      return;
    }
    recordRunEvent("COUNTDOWN_SHOWN", {
      marker: "countdown_shown",
      mode: selectedMode,
      countdownSeconds: remaining,
      feedbackDelayMs: Date.now() - pressedAtMs,
      screen: "MapScreen",
    });
    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (!contextRef.current.mountedRef.current || remaining <= 0) {
        clearCountdown();
        setCountdown(0);
        resolve();
        return;
      }
      setCountdown(remaining);
    }, RUN_START_COUNTDOWN_TICK_MS);
  }), [clearCountdown, contextRef]);

  const startWithCountdown = useCallback(async (selectedMode = "free") => {
    const context = contextRef.current;
    const pressedAtMs = Date.now();
    recordRunEvent("START_BUTTON_PRESSED", {
      marker: "start_button_pressed",
      mode: selectedMode,
      counting,
      running: context.running,
      isStartingRun: startingRef.current,
      screen: "MapScreen",
    });
    const busy = startingRef.current || counting || context.runningRef.current || context.running ||
      context.runtimeRecovering || context.isFinishingRunRef.current || context.isFinishingRun;
    if (busy) {
      recordRunEvent("BUTTON_PRESS_IGNORED_DUE_TO_LOCK", {
        action: "start_run",
        mode: selectedMode,
        reason: "invalid_state",
        screen: "MapScreen",
        level: "warn",
      });
      recordRunEvent("START_FAILED", { marker: "start_failed", mode: selectedMode,
        reason: "invalid_state", level: "warn", screen: "MapScreen" });
      return;
    }
    const cached = context.locationPermissionRef.current;
    if (cached && !cached.granted && context.permissionDenied) {
      context.setRunPermissionNoticeVisible(true);
      recordRunEvent("START_FAILED", { marker: "start_failed", mode: selectedMode,
        reason: "location_permission_required", screen: "MapScreen" });
      return;
    }

    startingRef.current = true;
    setIsStartingRun(true);
    context.setMode(selectedMode);
    context.setRunPermissionNoticeVisible(false);
    setCounting(RUN_START_COUNTDOWN_SECONDS > 0);
    setCountdown(Math.max(0, Number(RUN_START_COUNTDOWN_SECONDS) || 0));
    recordRunEvent("RUN_START_REQUESTED", {
      mode: selectedMode,
      countdownSeconds: RUN_START_COUNTDOWN_SECONDS,
      screen: "MapScreen",
    });
    try {
      const [preflight] = await Promise.all([runPreflight(context), waitCountdown(selectedMode, pressedAtMs)]);
      if (!context.mountedRef.current) return;
      if (!preflight?.ok) {
        resetFeedback();
        if (preflight?.reason === "location_permission_denied") context.setRunPermissionNoticeVisible(true);
        recordRunEvent("START_FAILED", { marker: "start_failed", mode: selectedMode,
          reason: preflight?.reason || "preflight_failed", screen: "MapScreen" });
        return;
      }
      setCounting(false);
      setCountdown(0);
      const result = await startRunExecutor(context, selectedMode, {
        permission: preflight.permission,
        pressedAtMs,
      });
      if (!result?.ok && result?.reason !== "existing_active_run_recovered") {
        recordRunEvent("START_FAILED", { marker: "start_failed", mode: selectedMode,
          reason: result?.reason || "start_run_failed", screen: "MapScreen" });
      }
    } catch (error) {
      resetFeedback();
      recordRunEvent("START_FAILED", { marker: "start_failed", mode: selectedMode,
        reason: "start_preflight_exception", error, screen: "MapScreen" });
      Alert.alert("Erro", "Nao foi possivel iniciar a corrida. Tente novamente.");
    } finally {
      clearCountdown();
      startingRef.current = false;
      if (context.mountedRef.current) setIsStartingRun(false);
    }
  }, [clearCountdown, contextRef, counting, resetFeedback, waitCountdown]);

  useEffect(() => clearCountdown, [clearCountdown]);
  return { isStartingRun, counting, countdown, startWithCountdown };
}
