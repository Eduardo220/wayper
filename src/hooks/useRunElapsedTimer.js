import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { getCurrentDurationSeconds } from "../services/runTracking/activeRunTrackingService.js";
import { isForegroundWatcherActive } from "../services/runTracking/activeRunForegroundWatcher.js";
import { setRuntimeSurfaceState } from "../services/runTracking/activeRunRuntimeService.js";
import { recordRunEvent } from "../services/diagnostics/runDiagnosticsService.js";

const STALL_MS = 2500;

export default function useRunElapsedTimer(contextRef, startLocationWatcher) {
  const startElapsedTimer = useCallback(() => {
    const context = contextRef.current;
    if (context.timerRef.current) clearInterval(context.timerRef.current);
    const update = () => {
      const now = Date.now();
      const previous = context.lastUiTickAtRef.current
        ? Date.parse(context.lastUiTickAtRef.current)
        : null;
      if (context.runningRef.current && context.runStatusRef.current === "active" &&
        Number.isFinite(previous) && now - previous > STALL_MS) {
        context.timerStallCountRef.current += 1;
        recordRunEvent("RUN_UI_TIMER_STALL", {
          runId: context.currentRunIdRef.current,
          status: context.runStatusRef.current,
          elapsedSinceLastTickMs: now - previous,
          thresholdMs: STALL_MS,
          stallCount: context.timerStallCountRef.current,
          screen: "MapScreen",
        });
        context.recordSnapshot("timer_stall", { elapsedSinceLastTickMs: now - previous }, { force: true });
      }
      context.lastUiTickAtRef.current = new Date(now).toISOString();
      setRuntimeSurfaceState({ lastUiTickAt: context.lastUiTickAtRef.current, timerStatus: "running" });
      const next = getCurrentDurationSeconds?.() || context.timeSecRef.current || 0;
      context.timeSecRef.current = next;
      context.setTimeSec(next);
    };
    update();
    context.timerRef.current = setInterval(update, 1000);
  }, [contextRef]);

  const stopElapsedTimer = useCallback(() => {
    const context = contextRef.current;
    if (context.timerRef.current) clearInterval(context.timerRef.current);
    context.timerRef.current = null;
    setRuntimeSurfaceState({
      lastUiTickAt: context.lastUiTickAtRef.current,
      timerStatus: context.runStatusRef.current === "paused" ? "paused" : "stopped",
    });
  }, [contextRef]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      const context = contextRef.current;
      if (next !== "active" || !context.currentRunIdRef.current ||
        context.runStatusRef.current !== "active") return;
      const timerWasStopped = !context.timerRef.current;
      const watcherWasStopped = !isForegroundWatcherActive();
      if (timerWasStopped) startElapsedTimer();
      if (watcherWasStopped) startLocationWatcher().catch((error) => {
        context.lastRunDiagnosticErrorRef.current = {
          message: error?.message || String(error),
          code: error?.code || null,
          at: new Date().toISOString(),
        };
      });
      if (timerWasStopped || watcherWasStopped) {
        recordRunEvent("RUN_APP_ACTIVE_REARMED", {
          runId: context.currentRunIdRef.current,
          timerWasStopped,
          watcherWasStopped,
          appState: next,
          screen: "MapScreen",
        });
        context.recordSnapshot("app_state_active_rearmed", {
          timerWasStopped,
          watcherWasStopped,
        }, { force: true });
      }
    });
    return () => subscription?.remove?.();
  }, [contextRef, startElapsedTimer, startLocationWatcher]);

  return { startElapsedTimer, stopElapsedTimer };
}
