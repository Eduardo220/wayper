import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { auth } from "../firebaseConfig";
import runDeferredTaskQueueRepository from "../repositories/runDeferredTaskQueueRepository.js";
import {
  buildRunDataFromRecoveredRun,
  discardRecoveredRun,
  findRecoverableRunForUser,
  hydrateRecoverableRunCandidate,
  isFinishedRecovery,
  isLiveRecovery,
} from "../services/run/runRecoveryService.js";
import {
  enqueuePostRunProcessing,
  persistMinimumFinishedRun,
} from "../services/run/runFinalizationService.js";
import { RUN_FINALIZATION_PERSISTENCE_DEPENDENCIES } from "../services/run/runFinalizationDependencies.js";
import { schedulePendingRunsSync } from "../services/run/runSyncQueueService.js";
import { recordRunEvent, recordRunSnapshotEvent } from "../services/diagnostics/runDiagnosticsService.js";

const defer = (task, onError) => Promise.resolve().then(task).catch(onError);

function useRecoveryActions(options) {
  const {
    pending, restoreCandidate, applySnapshot, mountedRef, setCurrentRunData,
    setShowRunModal, stopRun, resetRunVisuals, setActionLoading, setModalVisible, setPending,
  } = options;
  const onContinue = useCallback(async () => {
    if (!pending || isFinishedRecovery(pending)) return;
    setActionLoading(true);
    recordRunEvent("RECOVERY_STARTED", {
      runId: pending.id,
      localRunId: pending.localRunId,
      source: pending.source,
      action: "continue",
      screen: "MapScreen",
    });
    try {
      await restoreCandidate(pending, {
        closeBlockingOverlays: true,
        forceSyncControls: true,
        recovered: true,
      });
      recordRunEvent("RECOVERY_COMPLETED", {
        runId: pending.id,
        localRunId: pending.localRunId,
        source: pending.source,
        action: "continue",
        screen: "MapScreen",
      });
    } catch (error) {
      recordRunEvent("RECOVERY_FAILED", { runId: pending.id, action: "continue", error, screen: "MapScreen" });
      Alert.alert("Recuperacao", "Nao foi possivel continuar a corrida recuperada.");
    } finally {
      setActionLoading(false);
      recordRunEvent("RECOVERY_ACTION_LOADING_RELEASED", {
        runId: pending.id,
        action: "continue",
        screen: "MapScreen",
      });
    }
  }, [pending, restoreCandidate, setActionLoading]);

  const onFinish = useCallback(async () => {
    if (!pending) return;
    setActionLoading(true);
    setModalVisible(false);
    recordRunEvent("FINISH_PRESSED", {
      runId: pending.id,
      localRunId: pending.localRunId,
      source: "recovery_modal",
      status: pending.status,
      screen: "MapScreen",
    });
    try {
      if (isFinishedRecovery(pending)) {
        const result = await persistMinimumFinishedRun(buildRunDataFromRecoveredRun(pending), {
          ...RUN_FINALIZATION_PERSISTENCE_DEPENDENCIES,
          userId: auth.currentUser?.uid || "offline",
          sessionId: pending.localRunId || pending.id,
          source: "recovery_modal_finished",
          screen: "MapScreen",
        });
        const saved = result.savedLocalRun;
        const user = auth.currentUser || {};
        defer(async () => {
          const queued = await enqueuePostRunProcessing(saved, {
            queueRepository: runDeferredTaskQueueRepository,
            userId: user.uid || "offline",
            userName: user.displayName || user.email?.split("@")?.[0] || "Atleta Wayper",
            userAvatar: user.photoURL || null,
            includeTerritory: String(saved.mode || "").toLowerCase() === "zones",
            source: "recovery_finished",
            screen: "MapScreen",
          });
          if (!queued.ok) throw queued.error;
        }, (error) => recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
          runId: pending.id,
          stage: "recovery_deferred_task_queue_enqueue",
          error,
          level: "warn",
          screen: "MapScreen",
        }));
        setCurrentRunData(saved);
        setShowRunModal(true);
        setPending(null);
      } else {
        const hydrated = await hydrateRecoverableRunCandidate(pending, {
          userId: auth.currentUser?.uid || "offline",
          restartTracking: false,
          forceRunning: true,
        });
        applySnapshot(hydrated?.snapshot || pending.raw, { recovered: true });
        await stopRun({ force: true, fromRecovery: true });
        setPending(null);
      }
      recordRunEvent("FINISH_SUCCESS", {
        runId: pending.id,
        localRunId: pending.localRunId,
        source: "recovery_modal_finished",
        screen: "MapScreen",
      });
    } catch (error) {
      if (mountedRef.current) setModalVisible(true);
      recordRunEvent("FINISH_FAILED", { runId: pending.id, source: "recovery_modal", error, screen: "MapScreen" });
      Alert.alert("Recuperacao", "Nao foi possivel finalizar a corrida recuperada.");
    } finally {
      setActionLoading(false);
      recordRunEvent("RECOVERY_ACTION_LOADING_RELEASED", {
        runId: pending.id,
        action: "finish",
        screen: "MapScreen",
      });
    }
  }, [
    applySnapshot,
    mountedRef,
    pending,
    setActionLoading,
    setCurrentRunData,
    setModalVisible,
    setPending,
    setShowRunModal,
    stopRun,
  ]);

  const onDiscard = useCallback(() => {
    if (!pending) return;
    Alert.alert(
      "Descartar corrida?",
      "Essa acao remove apenas o rascunho local recuperavel. Ela nao pode ser desfeita.",
      [{ text: "Cancelar", style: "cancel" }, {
        text: "Descartar",
        style: "destructive",
        onPress: async () => {
          setActionLoading(true);
          try {
            const result = await discardRecoveredRun(pending);
            if (!result?.ok) throw result?.error || new Error("recovered run discard failed");
            setModalVisible(false);
            setPending(null);
            await resetRunVisuals();
          } catch {
            Alert.alert("Recuperacao", "Nao foi possivel descartar a corrida recuperada.");
          } finally {
            setActionLoading(false);
          }
        },
      }]
    );
  }, [pending, resetRunVisuals, setActionLoading, setModalVisible, setPending]);

  return { onContinue, onFinish, onDiscard };
}


export default function useRunRecoveryFlow(options) {
  const {
    loading,
    mountedRef,
    applySnapshot,
    closeBlockingOverlays,
    resetRunVisuals,
    setCurrentRunData,
    setShowRunModal,
    stopRun,
  } = options;
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [pending, setPending] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const restoringRef = useRef(false);
  const detectionAttemptedRef = useRef(false);

  const restoreCandidate = useCallback(async (candidate, restoreOptions = {}) => {
    if (!candidate?.recoverable || isFinishedRecovery(candidate) || restoringRef.current) return false;
    restoringRef.current = true;
    try {
      recordRunEvent("RUN_RESTORE_STARTED", {
        runId: candidate.id || candidate.localRunId || null,
        localRunId: candidate.localRunId || null,
        source: candidate.source || null,
        screen: "MapScreen",
      });
      if (restoreOptions.closeBlockingOverlays !== false) closeBlockingOverlays();
      setModalVisible(false);
      setPending(null);
      const hydrated = await hydrateRecoverableRunCandidate(candidate, {
        userId: auth.currentUser?.uid || "offline",
        restartTracking: restoreOptions.restartTracking !== false,
        forceRunning: restoreOptions.forceRunning,
      });
      const snapshot = hydrated?.snapshot || candidate.raw;
      if (!snapshot?.activeRunId) return false;
      applySnapshot(snapshot, {
        recovered: restoreOptions.recovered !== false,
        forceSyncControls: restoreOptions.forceSyncControls !== false,
      });
      recordRunSnapshotEvent("ACTIVE_RUN_RECOVERED_FROM_STORAGE", snapshot, {
        source: hydrated?.source || candidate.source || "recovery_candidate",
        screen: "MapScreen",
      });
      recordRunSnapshotEvent("RUN_RESTORE_COMPLETED", snapshot, {
        source: hydrated?.source || candidate.source || "recovery_candidate",
        screen: "MapScreen",
      });
      setNoticeVisible(true);
      return true;
    } finally {
      restoringRef.current = false;
    }
  }, [applySnapshot, closeBlockingOverlays]);

  useEffect(() => {
    if (loading || detectionAttemptedRef.current) return undefined;
    detectionAttemptedRef.current = true;
    let cancelled = false;
    Promise.resolve().then(async () => {
      const recovery = await findRecoverableRunForUser(auth.currentUser?.uid || "offline");
      if (cancelled || !recovery?.recoverable) return;
      recordRunEvent("APP_KILLED_OR_COLD_START_DETECTED", {
        runId: recovery.id || recovery.localRunId || null,
        localRunId: recovery.localRunId || null,
        source: recovery.source || null,
        status: recovery.status || null,
        screen: "MapScreen",
      }, { forcePersist: true });
      if (isLiveRecovery(recovery)) {
        await restoreCandidate(recovery, {
          closeBlockingOverlays: false,
          forceSyncControls: true,
          recovered: true,
        });
        return;
      }
      setPending(recovery);
      setModalVisible(true);
      if (isFinishedRecovery(recovery)) defer(() => schedulePendingRunsSync(0));
    }).catch((error) => recordRunEvent("RECOVERY_FAILED", {
      action: "detect",
      error,
      screen: "MapScreen",
    }));
    return () => { cancelled = true; };
  }, [loading, restoreCandidate]);

  const { onContinue, onFinish, onDiscard } = useRecoveryActions({
    pending,
    restoreCandidate,
    applySnapshot,
    mountedRef,
    setCurrentRunData,
    setShowRunModal,
    stopRun,
    resetRunVisuals,
    setActionLoading,
    setModalVisible,
    setPending,
  });
  const showNotice = useCallback((durationMs = 6500) => {
    setNoticeVisible(true);
    setTimeout(() => {
      if (mountedRef.current) setNoticeVisible(false);
    }, durationMs);
  }, [mountedRef]);
  const showCandidate = useCallback((candidate) => {
    setPending(candidate);
    setModalVisible(Boolean(candidate));
  }, []);

  return {
    noticeVisible,
    pending,
    modalVisible,
    actionLoading,
    onContinue,
    onFinish,
    onDiscard,
    showNotice,
    showCandidate,
  };
}
