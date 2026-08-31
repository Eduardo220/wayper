import { useCallback } from "react";
import { Alert } from "react-native";
import { auth } from "../firebaseConfig";
import runDeferredTaskQueueRepository from "../repositories/runDeferredTaskQueueRepository.js";
import { save as saveTerritory } from "../repositories/territoryRepository";
import { buildSummaryRenderPath, sanitizeRunPath } from "../services/runTracking";
import { sanitizeTrackingSegments } from "../services/run/runFinalizationData.js";
import { RUN_FINALIZATION_PERSISTENCE_DEPENDENCIES } from "../services/run/runFinalizationDependencies.js";
import {
  enqueuePostRunProcessing,
  persistMinimumFinishedRun,
} from "../services/run/runFinalizationService.js";
import { recordRunEvent } from "../services/diagnostics/runDiagnosticsService.js";

const sanitizePath = sanitizeRunPath;

const defer = (task, onError) => Promise.resolve().then(task).catch(onError);

export function normalizeSummaryRun(payload = {}, current = {}) {
  const trustedPath = sanitizePath(
    payload.trustedPath || payload.path || payload.coords || current.trustedPath || current.path || []
  );
  const renderPath = sanitizePath(
    payload.renderPath || payload.displayPath || current.renderPath || current.displayPath ||
      (trustedPath.length > 1 ? buildSummaryRenderPath(trustedPath) : trustedPath)
  );
  const rawPath = sanitizePath(payload.rawPoints || payload.rawPath || current.rawPoints || current.rawPath || []);
  return {
    ...payload,
    segments: sanitizeTrackingSegments(payload.segments || current.segments || []),
    routeSegments: sanitizeTrackingSegments(
      payload.routeSegments || payload.segments || current.routeSegments || current.segments || []
    ),
    path: trustedPath,
    trustedPath,
    filteredPoints: trustedPath,
    rawPath,
    rawPoints: rawPath,
    liveRenderPath: sanitizePath(payload.liveRenderPath || current.liveRenderPath || []),
    renderPath,
    displayPath: renderPath,
    displayPoints: renderPath,
    pathQuality: payload.pathQuality || current.pathQuality || null,
    gpsQualitySummary: payload.gpsQualitySummary || current.gpsQualitySummary ||
      payload.pathQuality || current.pathQuality || null,
    lowConfidenceSegments: payload.lowConfidenceSegments || current.lowConfidenceSegments || [],
    smoothingVersion: payload.smoothingVersion || current.smoothingVersion || "wayper_tracking_v2",
    filterVersion: payload.filterVersion || current.filterVersion ||
      payload.pathQuality?.filterVersion || "wayper_gps_filter_v2",
    synced: false,
    syncStatus: "PENDING",
    offlineStatus: "PENDING_SYNC",
    localRunId: payload.localRunId || current.localRunId || payload.id || current.id,
    schemaVersion: 1,
  };
}

export function buildSummaryTerritoryPatch(run, current, territories = []) {
  if (run.mode !== "zones" || !run.zoneId || !run.color) return null;
  return {
    ...(territories.find((item) => String(item.id) === String(run.zoneId)) || {}),
    id: run.zoneId,
    geometry: run.geometry || run.zoneGeometry || current?.geometry || null,
    routeGeometry: run.routeGeometry || current?.routeGeometry || null,
    areaM2: Number(run.area || current?.area || 0),
    color: run.color,
    strokeColor: run.strokeColor || run.color,
    fillOpacity: Number(run.fillOpacity ?? 0.24),
    updatedAt: new Date().toISOString(),
    pendingSync: true,
    synced: false,
  };
}

const mergeSavedRun = (saved, previous = []) => {
  const seen = new Set();
  return [saved, ...previous].filter((item) => {
    if (!item) return false;
    const key = item.zoneId
      ? `zone:${item.zoneId}`
      : `run:${item.localRunId || item.remoteRunId || item.id || item.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export default function useRunSummarySave(options) {
  const {
    currentRunData,
    territories,
    patchTerritory,
    setCompletedZonePreview,
    setCurrentRunData,
    setLastSavedRun,
    setRunsList,
    setShowRunModal,
    setShowSavedModal,
  } = options;

  return useCallback(async (payload) => {
    try {
      const normalized = normalizeSummaryRun(payload, currentRunData);
      const territoryPatch = buildSummaryTerritoryPatch(normalized, currentRunData, territories);
      const minimumSaveResult = await persistMinimumFinishedRun(normalized, {
        ...RUN_FINALIZATION_PERSISTENCE_DEPENDENCIES,
        userId: auth.currentUser?.uid || normalized.userId || "offline",
        sessionId: normalized.localRunId || normalized.id,
        source: "summary_modal_save",
        screen: "MapScreen",
        forceWrite: true,
      });
      const saved = minimumSaveResult.savedLocalRun;
      setRunsList((previous) => mergeSavedRun(saved, Array.isArray(previous) ? previous : []));
      setCurrentRunData(saved);
      setLastSavedRun(saved);
      setShowSavedModal(true);

      if (territoryPatch?.geometry) {
        patchTerritory(normalized.zoneId, territoryPatch);
        setCompletedZonePreview((previous) => (Array.isArray(previous) ? previous : []).map((zone) =>
          String(zone.id) === String(normalized.zoneId)
            ? { ...zone, color: normalized.color, strokeColor: normalized.strokeColor || normalized.color,
              fillOpacity: normalized.fillOpacity ?? 0.24 }
            : zone
        ));
        defer(() => saveTerritory(territoryPatch, {
          preserveVersion: false,
          scheduleSync: true,
        }), (error) => recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
          runId: saved.id || saved.localRunId || null,
          stage: "summary_modal_territory_update",
          error,
          level: "warn",
          screen: "MapScreen",
        }));
      }

      const user = auth.currentUser || {};
      defer(async () => {
        const result = await enqueuePostRunProcessing(saved, {
          queueRepository: runDeferredTaskQueueRepository,
          userId: user.uid || "offline",
          userName: user.displayName || user.email?.split("@")?.[0] || "Atleta Wayper",
          userAvatar: user.photoURL || null,
          includeTerritory: String(saved.mode || "").toLowerCase() === "zones",
          source: "summary_modal_save",
          screen: "MapScreen",
        });
        if (!result.ok) throw result.error;
      }, (error) => recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
        runId: saved.id || saved.localRunId || null,
        stage: "summary_modal_deferred_task_queue_enqueue",
        error,
        level: "warn",
        screen: "MapScreen",
      }));

      setShowRunModal(false);
      return saved;
    } catch (error) {
      recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
        runId: payload?.id || currentRunData?.id || null,
        stage: "summary_modal_local_save",
        error,
        recoveryPending: true,
        level: "warn",
        screen: "MapScreen",
      });
      Alert.alert(
        "Corrida preservada",
        "Não foi possível confirmar o salvamento. O rascunho recuperável foi mantido; tente salvar novamente."
      );
      throw error;
    }
  }, [
    currentRunData,
    patchTerritory,
    setCompletedZonePreview,
    setCurrentRunData,
    setLastSavedRun,
    setRunsList,
    setShowRunModal,
    setShowSavedModal,
    territories,
  ]);
}
