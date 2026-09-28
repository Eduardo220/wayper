import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import * as Sharing from "expo-sharing";
import { getTrackingRuntimeStatus } from "../services/runTracking/activeRunTrackingService.js";
import { isForegroundWatcherActive } from "../services/runTracking/activeRunForegroundWatcher.js";
import { ACTIVE_RUN_STATUS } from "../services/runTracking";
import { createActiveRunLightDiagnosticsArtifact } from "../services/diagnostics/diagnosticExportService.js";
import {
  recordEmergencyRunDiagnosticsSnapshot,
  recordRunEvent,
} from "../services/diagnostics/runDiagnosticsService.js";

const SNAPSHOT_INTERVAL_MS = 30000;
const EXPORT_TIMEOUT_MS = 5000;
const SHARE_TIMEOUT_MS = 15000;

const timeoutError = (code, timeoutMs) => Object.assign(new Error(code), { code, timeoutMs });
const withTimeout = (task, timeoutMs, code) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(timeoutError(code, timeoutMs)), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(task), timeout]).finally(() => clearTimeout(timeoutId));
};

const runStatus = (status) => {
  if (status === "active") return ACTIVE_RUN_STATUS.RUNNING;
  if (status === "paused") return ACTIVE_RUN_STATUS.PAUSED;
  return status || null;
};

export default function useEmergencyRunDiagnostics(contextRef) {
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);
  const tokenRef = useRef(0);
  const lastSnapshotAtRef = useRef(0);

  const buildContext = useCallback((event, extra = {}) => {
    const refs = contextRef.current;
    const runtime = getTrackingRuntimeStatus?.() || {};
    return {
      event,
      runId: refs.runId.current,
      status: runStatus(refs.status.current),
      elapsedMs: (refs.elapsed.current || 0) * 1000,
      distanceMeters: refs.distance.current || 0,
      runtime,
      appState: refs.appState.current,
      notificationStatus: runtime.notificationStatus || null,
      watcherStatus: runtime.foregroundWatcherStatus || runtime.watcherStatus ||
        (isForegroundWatcherActive() ? "foreground_active" : "stopped"),
      backgroundTaskStatus: runtime.backgroundTaskStatus || runtime.backgroundTaskProbe?.status || null,
      timerStatus: refs.timer.current
        ? "running"
        : refs.status.current === "paused" ? "paused" : "stopped",
      lastUiTickAt: refs.lastUiTick.current,
      lastLocationReceivedAt: refs.lastLocationReceived.current || runtime.lastRawPointReceivedAt || null,
      lastLocationAcceptedAt: refs.lastLocationAccepted.current || runtime.lastAcceptedPointAt || null,
      lastRenderPathUpdatedAt: refs.lastRenderPathUpdated.current,
      pathCounts: {
        rawPointsCount: refs.rawPath.current?.length || runtime.rawPointsCount || 0,
        trustedPointsCount: refs.trustedPath.current?.length || runtime.acceptedPointsCount || 0,
        renderPointsCount: refs.renderPath.current?.length || runtime.displayPointsCount || 0,
        segmentsCount: refs.segments.current?.length || runtime.segmentsCount || 0,
        routeChunksCount: runtime.routeChunksCount || runtime.routeChunksIndex?.chunks?.length || 0,
      },
      discardedPointReasons: refs.discardedReasons.current,
      lastError: refs.lastError.current,
      stallCounters: {
        ui: refs.uiStalls.current,
        timer: refs.timerStalls.current,
        watcher: refs.watcherRestarts.current,
      },
      screen: "MapScreen",
      ...extra,
    };
  }, [contextRef]);

  const recordSnapshot = useCallback((event, extra = {}, options = {}) => {
    const refs = contextRef.current;
    if (!refs.runId.current && !refs.running.current && refs.status.current !== "paused" &&
      options.allowWithoutRun !== true) return null;
    const now = Date.now();
    const minIntervalMs = Number(options.minIntervalMs ?? SNAPSHOT_INTERVAL_MS);
    if (!options.force && minIntervalMs > 0 && now - lastSnapshotAtRef.current < minIntervalMs) {
      return null;
    }
    lastSnapshotAtRef.current = now;
    return recordEmergencyRunDiagnosticsSnapshot(
      buildContext(event, extra),
      { forcePersist: true }
    );
  }, [buildContext, contextRef]);

  const release = useCallback((token = null) => {
    if (token == null || tokenRef.current === token) {
      inFlightRef.current = false;
      if (contextRef.current.mounted.current) setLoading(false);
    }
  }, [contextRef]);

  const cancelForFinish = useCallback(() => {
    if (!inFlightRef.current) return false;
    tokenRef.current += 1;
    release();
    return true;
  }, [release]);

  const exportDiagnostics = useCallback(async (trigger = "run_panel_button") => {
    if (inFlightRef.current) return;
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    inFlightRef.current = true;
    setLoading(true);
    const startedAtMs = Date.now();
    const refs = contextRef.current;
    const status = runStatus(refs.status.current);
    recordRunEvent("RUN_EMERGENCY_DIAGNOSTICS_EXPORT_STARTED", {
      runId: refs.runId.current,
      status,
      trigger,
      screen: "MapScreen",
      exportType: "active_run_light",
      timeoutMs: EXPORT_TIMEOUT_MS,
    });
    recordSnapshot("export_started", { trigger }, { force: true });
    try {
      const archive = await withTimeout(() => createActiveRunLightDiagnosticsArtifact({
        trigger,
        emergencyContext: buildContext("export_started", { trigger }),
        reason: "active_run_button_light_export",
      }), EXPORT_TIMEOUT_MS, "diagnostic_light_export_timeout");
      const durationMs = Date.now() - startedAtMs;
      release(token);
      if (refs.finishInFlight.current || tokenRef.current !== token) {
        recordRunEvent("RUN_DIAGNOSTIC_EXPORT_CANCELLED_FOR_FINISH", {
          runId: refs.runId.current,
          status,
          trigger,
          filename: archive.filename,
          size: archive.size,
          durationMs,
          screen: "MapScreen",
        });
        return;
      }
      const sharingAvailable = await withTimeout(
        () => Sharing.isAvailableAsync(),
        1200,
        "diagnostic_share_probe_timeout"
      ).catch(() => false);
      let shared = false;
      if (sharingAvailable) {
        await withTimeout(() => Sharing.shareAsync(archive.uri, {
          mimeType: archive.mimeType || "application/json",
          dialogTitle: "Exportar diagnostico Wayper",
        }), SHARE_TIMEOUT_MS, "diagnostic_share_timeout").then(() => {
          shared = true;
        }).catch(() => Alert.alert(
          "Diagnostico salvo",
          `Pacote leve salvo em ${archive.filename || archive.uri}. O compartilhamento demorou, mas a corrida continua ativa.`
        ));
      } else {
        Alert.alert(
          "Diagnostico gerado",
          `Pacote leve salvo em ${archive.filename || archive.uri}. Compartilhamento indisponivel.`
        );
      }
      recordRunEvent("RUN_EMERGENCY_DIAGNOSTICS_EXPORT_SUCCESS", {
        runId: refs.runId.current,
        status,
        trigger,
        uri: archive.uri,
        filename: archive.filename,
        size: archive.size,
        sharingAvailable,
        shared,
        light: true,
        durationMs,
        screen: "MapScreen",
      });
      recordSnapshot("export_success", { trigger }, { force: true });
    } catch (error) {
      refs.lastError.current = {
        message: error?.message || String(error),
        code: error?.code || null,
        at: new Date().toISOString(),
      };
      const timeout = error?.code === "diagnostic_light_export_timeout";
      recordRunEvent(timeout ? "RUN_DIAGNOSTIC_EXPORT_TIMEOUT" : "RUN_EMERGENCY_DIAGNOSTICS_EXPORT_FAILED", {
        runId: refs.runId.current,
        status,
        trigger,
        error,
        screen: "MapScreen",
      });
      recordSnapshot("export_failed", { trigger }, { force: true });
      Alert.alert(
        timeout ? "Diagnostico adiado" : "Falha no diagnostico",
        "A corrida continua ativa. Tente novamente ou exporte o ZIP completo em Diagnostico."
      );
    } finally {
      release(token);
    }
  }, [buildContext, contextRef, recordSnapshot, release]);

  const onPress = useCallback(() => exportDiagnostics("run_panel_button"), [exportDiagnostics]);
  const onLongPress = useCallback(() => {
    const refs = contextRef.current;
    recordRunEvent("RUN_EMERGENCY_DIAGNOSTICS_LONG_PRESS", {
      runId: refs.runId.current,
      status: runStatus(refs.status.current),
      screen: "MapScreen",
    });
    exportDiagnostics("run_panel_long_press");
  }, [contextRef, exportDiagnostics]);

  return { loading, recordSnapshot, cancelForFinish, onPress, onLongPress };
}
