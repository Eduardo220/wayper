import { useCallback } from "react";
import { Alert } from "react-native";
import { auth } from "../firebaseConfig";
import runDeferredTaskQueueRepository from "../repositories/runDeferredTaskQueueRepository.js";
import { WayperTheme } from "../theme/wayperTheme";
import { debugTracking } from "../services/runTracking";
import {
  enqueuePostRunProcessing,
  freezeActiveRunForFinalization,
  persistMinimumFinishedRun,
} from "../services/run/runFinalizationService.js";
import { buildFinishedRunData } from "../services/run/runFinalizationData.js";
import {
  RUN_FINALIZATION_FREEZE_DEPENDENCIES,
  RUN_FINALIZATION_PERSISTENCE_DEPENDENCIES,
} from "../services/run/runFinalizationDependencies.js";
import { recordRunEvent, recordRunSnapshotEvent } from "../services/diagnostics/runDiagnosticsService.js";
import recoverFinishFailure from "./runFinishFailureRecovery.js";

const TIMEOUT_MS = 2500;
const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const timeoutError = (code) => Object.assign(new Error(code), { code, timeoutMs: TIMEOUT_MS });
const withTimeout = (task, code) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(timeoutError(code)), TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve().then(task), timeout]).finally(() => clearTimeout(timeoutId));
};
const defer = (task, onError) => Promise.resolve().then(task).catch(onError);

const mergeSaved = (saved, previous = []) => {
  const seen = new Set();
  return [saved, ...previous].filter((item) => {
    if (!item) return false;
    const key = item.zoneId ? `zone:${item.zoneId}` : `run:${item.id || item.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

async function releaseFinishedRun({ context, runData, savedLocalRun, activeMode, runId }) {
  await withTimeout(context.fadeOutRoute, "finish_ui_release_animation_timeout").catch((error) => {
    recordRunEvent("RUN_FINISH_TIMEOUT_FALLBACK", {
      runId,
      stage: "ui_release_animation",
      error,
      timeoutMs: TIMEOUT_MS,
      screen: "MapScreen",
      level: "warn",
    });
  });
  context.resetRunVisuals();
  context.setCompletedZonePreview(
    runData.mode === "zones" && runData.zoneCoords.length >= 3
      ? [{
          coords: runData.zoneCoords,
          geometry: runData.geometry || null,
          area: runData.area,
          id: runData.zoneId || "completed-zone",
          color: runData.color || WayperTheme.colors.primary,
          strokeColor: runData.strokeColor || runData.color || WayperTheme.colors.primary,
          fillOpacity: runData.fillOpacity ?? 0.24,
        }]
      : []
  );
  const initialRun = savedLocalRun?.id === runData.id ? savedLocalRun : runData;
  context.setCurrentRunData(initialRun);
  if (savedLocalRun?.id === runData.id) {
    context.setRunsList((previous) => mergeSaved(savedLocalRun, Array.isArray(previous) ? previous : []));
  }
  context.setShowRunModal(true);
  recordRunEvent("RUN_FINISH_UI_RELEASED", {
    runId,
    localRunId: initialRun.localRunId || initialRun.id || null,
    savedLocal: Boolean(savedLocalRun?.id === runData.id),
    hasDeferredTerritory: activeMode === "zones",
    screen: "MapScreen",
  });
}

function enqueuePostRun(savedLocalRun, activeMode, runId) {
  if (!savedLocalRun) return;
  defer(async () => {
    const user = auth.currentUser || {};
    const result = await enqueuePostRunProcessing(savedLocalRun, {
      queueRepository: runDeferredTaskQueueRepository,
      userId: user.uid || "offline",
      userName: user.displayName || user.email?.split("@")?.[0] || "Atleta Wayper",
      userAvatar: user.photoURL || null,
      includeTerritory: activeMode === "zones",
      source: "finish_ui_released",
      screen: "MapScreen",
    });
    if (!result.ok) throw result.error;
  }, (error) => recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
    runId,
    stage: "deferred_task_queue_enqueue",
    error,
    level: "warn",
    screen: "MapScreen",
  }));
}

async function finishActiveRun(context, opts, backgroundStopPromise) {
  const requestedFinishedAtMs = Date.now();
  const freezeResult = await freezeActiveRunForFinalization({
    ...RUN_FINALIZATION_FREEZE_DEPENDENCIES,
    runId: context.currentRunIdRef.current,
    finishedAtMs: requestedFinishedAtMs,
    reason: "finish_pressed",
    source: "MapScreen",
    screen: "MapScreen",
  });
  const stoppedRunSessionId = context.currentRunIdRef.current;
  const runId = stoppedRunSessionId || uid();
  const activeMode = context.modeRef.current || context.mode || "free";
  const { runData, finalTiming } = buildFinishedRunData({
    runId,
    mode: activeMode,
    snapshot: freezeResult.snapshot,
    trackingSession: context.trackingSessionRef.current,
    finishedAtMs: requestedFinishedAtMs,
    uiDurationSeconds: context.timeSecRef.current || context.timeSec,
    lastAcceptedLocation: context.lastAcceptedLocationRef.current,
    fallbackLocation: context.location || context.defaultLocation,
    fallbackPath: context.savedPathRef.current,
    liveRenderPath: context.displayPathRef.current,
    fallbackDistanceMeters: context.distanceRef.current,
  });
  const path = runData.trustedPath;
  recordRunEvent("RUN_FINISH_FINAL_VALUES", {
    runId,
    finishedAt: runData.finishedAt,
    finishedAtMs: finalTiming.finishedAtMs ?? requestedFinishedAtMs,
    elapsedMs: runData.durationSeconds * 1000,
    distanceMeters: runData.distanceMeters,
    acceptedPointsCount: path.length,
    rawPointsCount: runData.rawPath.length,
    routeSegmentsCount: runData.routeSegments.length,
    screen: "MapScreen",
  });
  if (activeMode !== "zones") context.setCaptureResult(null);
  let savedLocalRun = null;
  try {
    const result = await persistMinimumFinishedRun(runData, {
      ...RUN_FINALIZATION_PERSISTENCE_DEPENDENCIES,
      userId: auth.currentUser?.uid || "offline",
      sessionId: stoppedRunSessionId || runId,
      source: "MapScreen",
      screen: "MapScreen",
    });
    savedLocalRun = result.savedLocalRun;
  } catch {
    Alert.alert(
      "Corrida preservada",
      "Não foi possível confirmar o salvamento mínimo. O rascunho recuperável foi mantido; use Salvar para tentar novamente."
    );
  }
  await releaseFinishedRun({ context, runData, savedLocalRun, activeMode, runId });
  enqueuePostRun(savedLocalRun, activeMode, runId);
  debugTracking("session_stopped", {
    runSessionId: stoppedRunSessionId,
    savedPoints: path.length,
    rawPoints: runData.rawPath.length,
    segmentCount: runData.segments.length,
    distance: runData.distanceMeters,
    durationSeconds: runData.durationSeconds,
  });
  const event = savedLocalRun?.id === runData.id ? "FINISH_SUCCESS" : "RUN_FINISH_ERROR_RECOVERABLE";
  recordRunSnapshotEvent(event, savedLocalRun || runData, {
    source: "MapScreen",
    recoveryPending: !savedLocalRun,
    screen: "MapScreen",
  });
  if (savedLocalRun?.id === runData.id) {
    recordRunSnapshotEvent("FINISH_COMPLETED", savedLocalRun, { source: "MapScreen", screen: "MapScreen" });
  }
  return backgroundStopPromise;
}

async function executeStopRun(context, opts = {}) {
  let finishLockAcquired = false;
  let backgroundStopPromise = null;
  try {
    recordRunEvent("FINISH_PRESSED", {
      runId: context.currentRunIdRef.current,
      status: context.runStatusRef.current,
      running: context.running || context.runningRef.current,
      force: Boolean(opts.force),
      fromRecovery: Boolean(opts.fromRecovery),
      screen: "MapScreen",
    });
    context.recordEmergencyDiagnosticsSnapshot("finish_requested", {
      force: Boolean(opts.force),
      fromRecovery: Boolean(opts.fromRecovery),
    }, { force: true });
    if (context.finishInFlightRef.current) {
      recordRunEvent("BUTTON_PRESS_IGNORED_DUE_TO_LOCK", {
        action: "finish_run",
        runId: context.currentRunIdRef.current,
        reason: "finish_already_in_flight",
        screen: "MapScreen",
        level: "warn",
      });
      return;
    }
    if (!context.running && !context.runningRef.current && !opts.force) return;
    context.finishInFlightRef.current = true;
    finishLockAcquired = true;
    context.isFinishingRunRef.current = true;
    context.setIsFinishingRun(true);
    context.cancelEmergencyDiagnosticsForFinish();
    context.runningRef.current = false;
    context.runStatusRef.current = "finishing";
    context.setRunning(false);
    context.setPaused(false);
    context.stopWatcherAndPolling();
    context.stopElapsedTimer();
    backgroundStopPromise = Promise.resolve().then(context.stopBackgroundLocationService);
    defer(() => withTimeout(() => backgroundStopPromise, "finish_background_stop_timeout"),
      (error) => recordRunEvent("RUN_FINISH_BACKGROUND_STOP_FAILED", {
        runId: context.currentRunIdRef.current,
        error,
        timeoutMs: TIMEOUT_MS,
        screen: "MapScreen",
        level: "warn",
      }));
    await finishActiveRun(context, opts, backgroundStopPromise);
  } catch (error) {
    recordRunEvent("FINISH_FAILED", {
      runId: context.currentRunIdRef.current,
      status: context.runStatusRef.current,
      error,
      screen: "MapScreen",
    });
    try {
      await recoverFinishFailure(context, backgroundStopPromise);
    } catch (restoreError) {
      recordRunEvent("RUN_FINISH_FAILURE_RESTORE_FAILED", {
        runId: context.currentRunIdRef.current,
        error: restoreError,
        level: "error",
        screen: "MapScreen",
      });
    }
  } finally {
    if (finishLockAcquired) {
      recordRunEvent("FINISH_LOCK_RELEASED", {
        runId: context.currentRunIdRef.current,
        status: context.runStatusRef.current,
        screen: "MapScreen",
      });
      context.finishInFlightRef.current = false;
      context.isFinishingRunRef.current = false;
      if (context.mountedRef.current) context.setIsFinishingRun(false);
    }
  }
}

export default function useRunFinalization(contextRef) {
  return useCallback((options = {}) => executeStopRun(contextRef.current, options), [contextRef]);
}
