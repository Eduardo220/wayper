import { Alert } from "react-native";
import { auth } from "../firebaseConfig";
import { ACTIVE_RUN_STATUS } from "../services/runTracking";
import { findRecoverableRunForUser } from "../services/run/runRecoveryService.js";
import { recordRunEvent, recordRunSnapshotEvent } from "../services/diagnostics/runDiagnosticsService.js";

const TIMEOUT_MS = 2500;
const withTimeout = (task, code) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(Object.assign(new Error(code), { code })), TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve().then(task), timeout]).finally(() => clearTimeout(timeoutId));
};
const defer = (task, onError) => Promise.resolve().then(task).catch(onError);

export default async function recoverFinishFailure(context, backgroundStopPromise) {
  const { activeRunTrackingService, currentRunIdRef, runStatusRef } = context;
  let snapshot = null;
  try {
    snapshot = await withTimeout(
      () => activeRunTrackingService.getActiveRunSnapshot?.(),
      "finish_failure_snapshot_timeout"
    );
  } catch (error) {
    recordRunEvent("RUN_FINISH_FAILURE_SNAPSHOT_READ_FAILED", {
      runId: currentRunIdRef.current,
      error,
      timeoutMs: TIMEOUT_MS,
      level: "warn",
      screen: "MapScreen",
    });
  }

  const status = String(snapshot?.status || "").toUpperCase();
  const live = [
    ACTIVE_RUN_STATUS.STARTING,
    ACTIVE_RUN_STATUS.RUNNING,
    ACTIVE_RUN_STATUS.PAUSED,
    ACTIVE_RUN_STATUS.RECOVERING,
    ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
  ].includes(status);
  let recoveryPresented = false;

  if (snapshot?.activeRunId && live) {
    let backgroundStopTimedOut = false;
    if (status === ACTIVE_RUN_STATUS.RUNNING && backgroundStopPromise) {
      try {
        await withTimeout(() => backgroundStopPromise, "finish_failure_background_stop_timeout");
      } catch (error) {
        backgroundStopTimedOut = true;
        recordRunEvent("RUN_FINISH_FAILURE_BACKGROUND_STOP_TIMEOUT", {
          runId: snapshot.activeRunId,
          error,
          timeoutMs: TIMEOUT_MS,
          level: "warn",
          screen: "MapScreen",
        });
      }
    }
    try {
      context.applyActiveRunSnapshotToUi(snapshot, {
        recovered: true,
        forceSyncControls: true,
        source: "finish_failure_restore",
      });
      if (backgroundStopTimedOut) {
        defer(async () => {
          await backgroundStopPromise;
          const latest = await withTimeout(
            () => activeRunTrackingService.getActiveRunSnapshot?.(),
            "finish_failure_late_stop_snapshot_timeout"
          );
          if (latest?.activeRunId === snapshot.activeRunId &&
            String(latest.status || "").toUpperCase() === ACTIVE_RUN_STATUS.RUNNING) {
            await Promise.all([context.startLocationWatcher(), context.startBackgroundLocationService()]);
          }
        }, (error) => recordRunEvent("RUN_FINISH_FAILURE_RESTORE_BACKGROUND_FAILED", {
          runId: snapshot.activeRunId,
          error,
          level: "warn",
          screen: "MapScreen",
        }));
      }
      recordRunSnapshotEvent("RUN_FINISH_FAILURE_STATE_RESTORED", snapshot, {
        source: "MapScreen",
        screen: "MapScreen",
      });
      recoveryPresented = true;
    } catch (error) {
      recordRunEvent("RUN_FINISH_FAILURE_LIVE_RESTORE_FAILED", {
        runId: snapshot.activeRunId,
        error,
        level: "warn",
        screen: "MapScreen",
      });
    }
  }

  if (!recoveryPresented) {
    try {
      const candidate = await withTimeout(() => findRecoverableRunForUser(
        auth.currentUser?.uid || snapshot?.userId || "offline",
        { activeSnapshot: snapshot || null, reason: "finish_failure_terminal_recovery" }
      ), "finish_failure_recovery_timeout");
      if (candidate?.recoverable) {
        context.recoveryUiRef.current.showCandidate?.(candidate);
        recoveryPresented = true;
        recordRunSnapshotEvent("RUN_FINISH_FAILURE_RECOVERY_PRESENTED", snapshot || candidate.raw || candidate, {
          source: candidate.source || "MapScreen",
          screen: "MapScreen",
        });
      }
    } catch (error) {
      recordRunEvent("RUN_FINISH_FAILURE_RECOVERY_LOOKUP_FAILED", {
        runId: snapshot?.activeRunId || currentRunIdRef.current,
        error,
        timeoutMs: TIMEOUT_MS,
        level: "warn",
        screen: "MapScreen",
      });
    }
  }

  if (!recoveryPresented) {
    recordRunEvent("RUN_FINISH_FAILURE_RECOVERY_UNAVAILABLE", {
      runId: snapshot?.activeRunId || currentRunIdRef.current,
      status: status || runStatusRef.current,
      level: "error",
      screen: "MapScreen",
    });
    Alert.alert(
      "Finalização interrompida",
      "Não foi possível restaurar a corrida automaticamente. Reabra o Wayper para executar a recuperação antes de iniciar outra atividade."
    );
  }
}
