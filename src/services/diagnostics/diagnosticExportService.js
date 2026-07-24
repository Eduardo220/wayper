import JSZip from "jszip";
import * as FileSystem from "expo-file-system/legacy";
import { sanitizeLogContext } from "../../utils/logger.js";
import {
  captureException,
  traceAsync,
} from "../monitoring/sentryService.js";
import activeRunRuntimeService from "../runTracking/activeRunRuntimeService.js";
import {
  getDiagnosticNdjson,
  getDiagnosticStorageHealth,
  getLastDiagnosticRunId,
  getRecentDiagnosticRunIds,
} from "./logStorageService.js";
import { exportDiagnosticsBundle } from "./runDiagnosticsService.js";

export const DIAGNOSTIC_EXPORT_SCOPE = Object.freeze({
  LAST_RUN: "last_run",
  ACTIVE_RUN: "active_run",
  RECENT: "recent",
});

function safeFilenamePart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

function lightActiveRunSnapshot(runtime = {}) {
  return sanitizeLogContext({
    activeRunId: runtime.activeRunId || runtime.runId || null,
    localRunId: runtime.localRunId || null,
    status: runtime.status || null,
    startedAt: runtime.startedAt || null,
    updatedAt: runtime.updatedAt || null,
    lastPersistedAt: runtime.lastPersistedAt || null,
    elapsedMs: runtime.elapsedMs || 0,
    totalPausedMs: runtime.totalPausedMs || 0,
    distanceMeters: runtime.distanceMeters || 0,
    acceptedPointsCount: runtime.acceptedPointsCount || 0,
    rejectedPointsCount: runtime.rejectedPointsCount || 0,
    routeChunksCount: runtime.routeChunksCount || 0,
    lastRawPointReceivedAt: runtime.lastRawPointReceivedAt || null,
    foregroundWatcherStatus: runtime.foregroundWatcherStatus || null,
    backgroundTaskStatus: runtime.backgroundTaskStatus || null,
    notificationStatus: runtime.notificationStatus || null,
    appState: runtime.appState || null,
    screenFocusState: runtime.screenFocusState || null,
    recoveryReason: runtime.recoveryReason || null,
    reconciliationStatus: runtime.reconciliationStatus || null,
    storageHealth: runtime.storageHealth || null,
    pendingFlushCount: runtime.pendingFlushCount || 0,
    pendingSync: runtime.pendingSync || false,
  });
}

async function resolveExportContext(scope) {
  const runtime = await activeRunRuntimeService
    .getActiveRunRuntimeSnapshot?.("diagnostics_archive")
    .catch(() => ({}));
  const isLive = ["STARTING", "RUNNING", "PAUSED", "RECOVERING", "ERROR_RECOVERABLE"]
    .includes(String(runtime?.status || "").toUpperCase());
  if (scope === DIAGNOSTIC_EXPORT_SCOPE.ACTIVE_RUN) {
    const activeRunId = isLive ? (runtime?.activeRunId || runtime?.runId || null) : null;
    if (!activeRunId) throw new Error("no_active_run_for_diagnostics");
    return {
      runtime: runtime || {},
      runId: activeRunId,
      includeAllRecent: false,
    };
  }
  if (scope === DIAGNOSTIC_EXPORT_SCOPE.RECENT) {
    return {
      runtime: runtime || {},
      runId: null,
      includeAllRecent: true,
    };
  }
  const activeRunId = isLive ? (runtime?.activeRunId || runtime?.runId || null) : null;
  const recentRunIds = await getRecentDiagnosticRunIds();
  const lastRunId = recentRunIds.find((runId) => String(runId) !== String(activeRunId || "")) || null;
  if (!lastRunId) throw new Error("no_previous_run_diagnostics");
  return {
    runtime: runtime || {},
    runId: lastRunId || await getLastDiagnosticRunId(),
    includeAllRecent: false,
  };
}

function addJson(zip, filename, value) {
  zip.file(filename, JSON.stringify(sanitizeLogContext(value || {}), null, 2));
}

export function buildActiveRunLightDiagnosticsPayload(options = {}) {
  const runtime = options.runtime || {};
  const emergencyContext = options.emergencyContext || {};
  const storage = options.storage || {};
  const runId =
    options.runId ||
    emergencyContext.runId ||
    runtime.activeRunId ||
    runtime.runId ||
    runtime.localRunId ||
    null;

  return sanitizeLogContext({
    format: "wayper-active-run-light-diagnostics",
    version: 1,
    createdAt: new Date().toISOString(),
    scope: DIAGNOSTIC_EXPORT_SCOPE.ACTIVE_RUN,
    runId,
    trigger: options.trigger || "active_run",
    light: true,
    fullExportDeferred: true,
    reason: options.reason || "active_run_non_blocking_export",
    message: "Pacote leve gerado durante corrida ativa. Export ZIP completo deve ser feito fora da MapScreen.",
    runtime: lightActiveRunSnapshot(runtime),
    emergency: emergencyContext,
    storage,
    counters: {
      rawPointsCount:
        emergencyContext.pathCounts?.rawPointsCount ||
        runtime.rawPointsCount ||
        runtime.rawGpsPointsReceived ||
        0,
      acceptedPointsCount:
        emergencyContext.pathCounts?.trustedPointsCount ||
        runtime.acceptedPointsCount ||
        runtime.acceptedGpsPoints ||
        0,
      renderPointsCount:
        emergencyContext.pathCounts?.renderPointsCount ||
        runtime.displayPointsCount ||
        0,
      segmentsCount:
        emergencyContext.pathCounts?.segmentsCount ||
        runtime.segmentsCount ||
        runtime.routeSegmentsCount ||
        0,
      routeChunksCount:
        emergencyContext.pathCounts?.routeChunksCount ||
        runtime.routeChunksCount ||
        runtime.routeChunksIndex?.chunks?.length ||
        0,
    },
  });
}

export async function createActiveRunLightDiagnosticsArtifact(options = {}) {
  let context = null;
  try {
    context = await resolveExportContext(DIAGNOSTIC_EXPORT_SCOPE.ACTIVE_RUN);
  } catch (error) {
    const fallbackRunId =
      options.runId ||
      options.emergencyContext?.runId ||
      options.emergencyContext?.localRunId ||
      null;
    if (!fallbackRunId) throw error;
    context = {
      runtime: {},
      runId: fallbackRunId,
      includeAllRecent: false,
    };
  }

  const diagnosticStorage = await getDiagnosticStorageHealth().catch((error) => ({
    ok: false,
    error: error?.message || String(error),
  }));
  const payload = buildActiveRunLightDiagnosticsPayload({
    ...options,
    runtime: context.runtime || {},
    runId: context.runId,
    storage: diagnosticStorage,
  });
  const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!baseDir) throw new Error("diagnostic_export_directory_unavailable");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `wayper-active-run-light-diagnostics-${safeFilenamePart(context.runId)}-${timestamp}.json`;
  const uri = `${baseDir}${filename}`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2));

  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return {
    uri,
    filename,
    size: Number(info?.size || 0),
    scope: DIAGNOSTIC_EXPORT_SCOPE.ACTIVE_RUN,
    runId: context.runId,
    mimeType: "application/json",
    light: true,
    fullExportDeferred: true,
    payload,
  };
}

async function createDiagnosticsArchiveInternal(options = {}) {
  const scope = options.scope || DIAGNOSTIC_EXPORT_SCOPE.LAST_RUN;
  const context = await resolveExportContext(scope);
  const [bundle, ndjsonFiles, diagnosticStorage] = await Promise.all([
    exportDiagnosticsBundle({
      limit: scope === DIAGNOSTIC_EXPORT_SCOPE.RECENT ? 5000 : 2500,
      runId: context.runId,
    }),
    getDiagnosticNdjson({
      runId: context.runId,
      includeAllRecent: context.includeAllRecent,
    }),
    getDiagnosticStorageHealth(),
  ]);

  const zip = new JSZip();
  addJson(zip, "wayper-last-run-diagnostics.json", bundle);
  Object.entries(ndjsonFiles).forEach(([filename, contents]) => {
    zip.file(filename, contents || "");
  });
  addJson(zip, "routeChunks-metadata.json", bundle.routeChunks || {});
  addJson(zip, "activeRun-snapshot-light.json", lightActiveRunSnapshot(context.runtime));
  addJson(zip, "storageHealth.json", {
    diagnostics: diagnosticStorage,
    activeRun: bundle.storage?.canonical?.storageHealth || context.runtime?.storageHealth || null,
    canonical: bundle.storage?.canonical || null,
  });
  addJson(zip, "nativeNotificationState.json", bundle.nativeNotificationState || {});
  addJson(zip, "backgroundTaskStatus.json", {
    status: bundle.backgroundTask,
    events: bundle.backgroundTaskEvents || [],
    cancelledOrRestarted: bundle.taskCancelledOrRestartedEvents || [],
  });
  addJson(zip, "foregroundWatcherStatus.json", {
    status: bundle.foregroundWatcher,
  });
  addJson(zip, "runtime-state.json", {
    appState: bundle.appState,
    screenFocusState: bundle.screenFocusState,
    notificationStatus: bundle.notification,
    lastDeepLinkReceived: bundle.lastDeepLinkReceived,
    lastNotificationActionReceived: bundle.lastNotificationActionReceived,
  });
  addJson(zip, "gpsFilterReport.json", bundle.gpsFilterReport || {});
  addJson(zip, "emergencyRunDiagnostics.json", bundle.emergencyRunDiagnostics || {});
  addJson(zip, "uiInteractionEvents.json", {
    events: bundle.uiInteractionEvents || [],
    drawerMenuAttempts: bundle.drawerMenuAttempts || {},
    stallCounters: bundle.stallCounters || {},
  });
  addJson(zip, "localDiagnostics-summary.json", bundle.localDiagnostics || {});
  addJson(zip, "reports/app-build-device-metadata.json", bundle.localDiagnostics?.metadata || bundle.metadata || {});
  addJson(zip, "reports/gps-report.json", bundle.localDiagnostics?.gpsTracking || bundle.gpsFilterReport || {});
  addJson(zip, "reports/sync-report.json", bundle.syncReport || {});
  addJson(zip, "reports/permissions-report.json", bundle.permissionsReport || {});
  addJson(zip, "reports/storage-report.json", bundle.storageReport || {});
  addJson(zip, "reports/notification-background-report.json", bundle.notificationBackgroundReport || {});
  addJson(zip, "reports/share-report.json", bundle.shareReport || {});
  addJson(zip, "reports/stories-feed-report.json", bundle.storiesFeedReport || {});
  addJson(zip, "reports/territory-report.json", bundle.territoryReport || {});
  addJson(zip, "reports/profile-ranking-xp-report.json", bundle.profileRankingXpReport || {});
  addJson(zip, "manifest.json", {
    format: "wayper-diagnostics-archive",
    version: 1,
    createdAt: new Date().toISOString(),
    scope,
    runId: context.runId,
    preciseCoordinatesIncluded: bundle.metadata?.preciseLocationLogsEnabled === true,
    files: Object.keys(zip.files),
  });

  const base64 = await zip.generateAsync({
    type: "base64",
    compression: "DEFLATE",
    compressionOptions: { level: 2 },
  });
  const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!baseDir) throw new Error("diagnostic_export_directory_unavailable");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `wayper-diagnostics-${safeFilenamePart(scope)}-${timestamp}.zip`;
  const uri = `${baseDir}${filename}`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return {
    uri,
    filename,
    size: Number(info?.size || 0),
    scope,
    runId: context.runId,
    bundle,
  };
}

export async function createDiagnosticsArchive(options = {}) {
  const scope = options.scope || DIAGNOSTIC_EXPORT_SCOPE.LAST_RUN;
  return traceAsync(
    "Export diagnostics",
    "wayper.diagnostics.export",
    { scope },
    async () => {
      try {
        return await createDiagnosticsArchiveInternal(options);
      } catch (error) {
        captureException(error, {
          category: "DIAGNOSTICS",
          event: "DIAGNOSTICS_EXPORT_FAILED",
          scope,
        });
        throw error;
      }
    }
  );
}

export default {
  DIAGNOSTIC_EXPORT_SCOPE,
  buildActiveRunLightDiagnosticsPayload,
  createActiveRunLightDiagnosticsArtifact,
  createDiagnosticsArchive,
};
