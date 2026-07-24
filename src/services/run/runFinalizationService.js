import {
  recordRunEvent,
  recordRunSnapshotEvent,
} from "../diagnostics/runDiagnosticsService.js";

export const RUN_MINIMUM_SAVE_SCHEMA_VERSION = 1;
export const EXPEDITION_PROCESSING_SCHEMA_VERSION = 1;

export const RUN_FINALIZATION_TIMEOUTS = Object.freeze({
  CHECKPOINT_MS: 2000,
  SNAPSHOT_MS: 2500,
  LOCAL_SAVE_MS: 3500,
  DRAFT_SAVE_MS: 1500,
  CLEANUP_MS: 1500,
  QUEUE_MS: 8000,
});

const inFlightMinimumSaves = new Map();

function nowIso(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}

function makeFinalizationError(code, options = {}) {
  const error = new Error(options.message || code);
  error.code = code;
  error.stage = options.stage || null;
  error.recoverable = options.recoverable !== false;
  error.cause = options.cause || null;
  return error;
}

function withTimeout(task, timeoutMs, code) {
  let timeoutId = null;
  const operation = typeof task === "function" ? Promise.resolve().then(task) : Promise.resolve(task);
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = makeFinalizationError(code, { stage: code, recoverable: true });
      error.timeoutMs = timeoutMs;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function resolveRunId(run = {}) {
  const value = run || {};
  return String(value.id || value.localRunId || value.runId || value.remoteRunId || "").trim();
}

function getIdentitySet(run = {}) {
  const value = run || {};
  return new Set([
    value.id,
    value.localRunId,
    value.runId,
    value.remoteRunId,
    value.legacyId,
  ].filter(Boolean).map(String));
}

function hasSharedIdentity(left = {}, right = {}) {
  const leftIds = getIdentitySet(left);
  return [...getIdentitySet(right)].some((id) => leftIds.has(id));
}

function isFinishedLocalRun(run = {}) {
  const value = run || {};
  const status = String(value.status || "").toLowerCase();
  return Boolean(
    resolveRunId(value) &&
    (status === "completed" || status === "finished") &&
    (value.finishedAt || value.endedAt || value.date)
  );
}

export function buildMinimumSavedRun(runData = {}, options = {}) {
  const runId = resolveRunId(runData);
  if (!runId) {
    throw makeFinalizationError("RUN_MINIMUM_SAVE_MISSING_ID", {
      stage: "build_minimum_run",
      recoverable: false,
    });
  }

  const preparedAt = options.preparedAt || nowIso(options.nowMs);
  const finishedAt = runData.finishedAt || runData.endedAt || runData.date || preparedAt;
  const existingProcessing = runData.expeditionProcessing || {};
  const existingStatus = String(
    runData.expeditionProcessingStatus ||
    existingProcessing.status ||
    ""
  ).toLowerCase();
  const keepTerminalProcessing = existingStatus === "ready";
  const processingStatus = keepTerminalProcessing ? "ready" : "pending";

  return {
    ...runData,
    id: runData.id || runId,
    localRunId: runData.localRunId || runData.id || runId,
    finishedAt,
    endedAt: finishedAt,
    date: runData.date || finishedAt,
    status: "completed",
    synced: false,
    pendingSync: true,
    syncStatus: "PENDING",
    offlineStatus: "PENDING_SYNC",
    minimumSavedRunVersion: RUN_MINIMUM_SAVE_SCHEMA_VERSION,
    minimumSavedAt: runData.minimumSavedAt || preparedAt,
    finalizationStatus: "MINIMUM_SAVED",
    expeditionProcessingVersion: EXPEDITION_PROCESSING_SCHEMA_VERSION,
    expeditionProcessingStatus: processingStatus.toUpperCase(),
    expeditionProcessing: {
      ...existingProcessing,
      schemaVersion: EXPEDITION_PROCESSING_SCHEMA_VERSION,
      runId,
      status: processingStatus,
      createdAt: existingProcessing.createdAt || preparedAt,
      updatedAt: preparedAt,
    },
    updatedAt: preparedAt,
  };
}

async function resolveFreezeDependencies(options = {}) {
  const [trackingModule, checkpointModule] = await Promise.all([
    options.trackingService ? null : import("../runTracking/activeRunTrackingService.js"),
    options.flushCheckpoint ? null : import("./runAutoSaveService.js"),
  ]);
  return {
    trackingService: options.trackingService || trackingModule?.default,
    flushCheckpoint: options.flushCheckpoint || checkpointModule?.flushActiveRunCheckpoint,
  };
}

export async function freezeActiveRunForFinalization(options = {}) {
  const finishedAtMs = Number(options.finishedAtMs || Date.now());
  const source = options.source || "runFinalizationService";
  const screen = options.screen || null;
  const runId = options.runId || null;
  const timeouts = { ...RUN_FINALIZATION_TIMEOUTS, ...(options.timeouts || {}) };
  const issues = [];
  const { trackingService, flushCheckpoint } = await resolveFreezeDependencies(options);

  try {
    await withTimeout(
      () => trackingService?.markActiveRunFinishing?.({
        nowMs: finishedAtMs,
        reason: options.reason || "finish_requested",
        source,
      }),
      timeouts.CHECKPOINT_MS,
      "finish_mark_finishing_timeout"
    );
  } catch (error) {
    issues.push({ stage: "mark_finishing", error });
    recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
      runId,
      stage: "mark_finishing",
      error,
      timeoutMs: timeouts.CHECKPOINT_MS,
      source,
      screen,
      level: "warn",
    });
  }

  recordRunEvent("RUN_FINISH_LOCAL_MIN_SAVE_STARTED", {
    runId,
    checkpointAtMs: finishedAtMs,
    source,
    screen,
  });

  try {
    await withTimeout(
      () => flushCheckpoint?.({
        reason: "before_finish",
        checkpointAtMs: finishedAtMs,
      }),
      timeouts.CHECKPOINT_MS,
      "finish_checkpoint_timeout"
    );
  } catch (error) {
    issues.push({ stage: "before_finish_checkpoint", error });
    recordRunEvent("RUN_FINISH_TIMEOUT_FALLBACK", {
      runId,
      stage: "before_finish_checkpoint",
      error,
      timeoutMs: timeouts.CHECKPOINT_MS,
      source,
      screen,
      level: "warn",
    });
  }

  let snapshot = null;
  try {
    snapshot = await withTimeout(
      () => trackingService?.finishActiveRun?.({ finishedAtMs, source }),
      timeouts.SNAPSHOT_MS,
      "finish_active_snapshot_timeout"
    );
  } catch (error) {
    issues.push({ stage: "active_run_finish_snapshot", error });
    recordRunEvent("RUN_FINISH_TIMEOUT_FALLBACK", {
      runId,
      stage: "active_run_finish_snapshot",
      error,
      timeoutMs: timeouts.SNAPSHOT_MS,
      source,
      screen,
      level: "warn",
    });
    try {
      snapshot = await trackingService?.getActiveRunSnapshot?.();
    } catch (snapshotReadError) {
      issues.push({ stage: "read_snapshot_after_finish_failure", error: snapshotReadError });
      recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
        runId,
        stage: "read_snapshot_after_finish_failure",
        error: snapshotReadError,
        source,
        screen,
        level: "error",
      });
    }
  }

  return {
    snapshot,
    finishedAtMs,
    issues,
  };
}

async function resolvePersistenceDependencies(options = {}) {
  const [syncModule, recoveryModule] = await Promise.all([
    options.saveLocalRun && options.findLocalRunById && options.scheduleRunsSync
      ? null
      : import("../../utils/sync.js"),
    options.persistFinishedRunDraft && options.markRecoveredRunLocallySaved
      ? null
      : import("./runRecoveryService.js"),
  ]);
  return {
    saveLocalRun: options.saveLocalRun || syncModule?.saveLocalRun,
    findLocalRunById: options.findLocalRunById || syncModule?.findLocalRunById,
    scheduleRunsSync: options.scheduleRunsSync || syncModule?.scheduleRunsSync,
    persistFinishedRunDraft:
      options.persistFinishedRunDraft || recoveryModule?.persistFinishedRunDraft,
    markRecoveredRunLocallySaved:
      options.markRecoveredRunLocallySaved || recoveryModule?.markRecoveredRunLocallySaved,
  };
}

async function persistMinimumFinishedRunInternal(runData = {}, options = {}) {
  const minimumRun = buildMinimumSavedRun(runData, options);
  const runId = resolveRunId(minimumRun);
  const source = options.source || "runFinalizationService";
  const screen = options.screen || null;
  const timeouts = { ...RUN_FINALIZATION_TIMEOUTS, ...(options.timeouts || {}) };
  const issues = [];
  const dependencies = await resolvePersistenceDependencies(options);

  let existing = null;
  try {
    existing = await dependencies.findLocalRunById?.({
      id: runId,
      localRunId: minimumRun.localRunId,
      runId: minimumRun.runId || runId,
      remoteRunId: minimumRun.remoteRunId || null,
    });
  } catch (error) {
    issues.push({ stage: "find_existing_local_run", error });
  }

  const existingAlreadyConfirmed =
    isFinishedLocalRun(existing) &&
    hasSharedIdentity(existing, minimumRun) &&
    Number(existing.minimumSavedRunVersion || 0) >= RUN_MINIMUM_SAVE_SCHEMA_VERSION;

  let savedLocalRun = existingAlreadyConfirmed ? existing : null;
  let historySaveError = null;
  if (!savedLocalRun) {
    try {
      savedLocalRun = await withTimeout(
        () => dependencies.saveLocalRun?.(minimumRun),
        timeouts.LOCAL_SAVE_MS,
        "finish_local_history_save_timeout"
      );
    } catch (error) {
      historySaveError = error;
      recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
        runId,
        stage: "save_local_run",
        reason: "save_local_failed",
        error,
        source,
        screen,
        level: "warn",
      });
    }
  }

  if (!isFinishedLocalRun(savedLocalRun) || !hasSharedIdentity(savedLocalRun, minimumRun)) {
    const confirmationError = historySaveError || makeFinalizationError(
      "RUN_MINIMUM_SAVE_NOT_CONFIRMED",
      { stage: "save_local_run" }
    );
    recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
      runId,
      stage: "save_local_run",
      reason: historySaveError ? "save_local_failed" : "local_save_not_confirmed",
      returnedRunId: savedLocalRun?.id || null,
      source,
      screen,
      level: "warn",
    });
    try {
      await withTimeout(
        () => dependencies.persistFinishedRunDraft?.(minimumRun, {
          userId: options.userId || minimumRun.userId || "offline",
          status: "FINISHED",
          syncStatus: "LOCAL_ONLY",
        }),
        timeouts.DRAFT_SAVE_MS,
        "finish_draft_save_timeout"
      );
    } catch (error) {
      issues.push({ stage: "finished_draft", error });
      recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
        runId,
        stage: "finished_draft",
        reason: error?.code === "finish_draft_save_timeout"
          ? "finished_draft_timeout"
          : "finished_draft_failed",
        error,
        source,
        screen,
        level: "warn",
      });
    }
    throw makeFinalizationError(
      historySaveError ? "RUN_MINIMUM_SAVE_FAILED" : "RUN_MINIMUM_SAVE_NOT_CONFIRMED",
      {
        stage: "save_local_run",
        cause: confirmationError,
      }
    );
  }

  recordRunSnapshotEvent("RUN_FINISH_SAVED", savedLocalRun, {
    runId,
    sessionId: options.sessionId || runId,
    distanceMeters: Number(savedLocalRun.distanceMeters ?? savedLocalRun.distance ?? 0),
    elapsedMs: Number(savedLocalRun.durationSeconds ?? savedLocalRun.duration ?? 0) * 1000,
    pointsCount: savedLocalRun.trustedPath?.length || savedLocalRun.path?.length || 0,
    segmentsCount: savedLocalRun.segments?.length || savedLocalRun.routeSegments?.length || 0,
    savedLocal: true,
    queuedSync: true,
    source,
    screen,
  });
  recordRunEvent("RUN_FINISH_LOCAL_MIN_SAVE_COMPLETED", {
    runId,
    localRunId: savedLocalRun.localRunId || savedLocalRun.id || null,
    distanceMeters: Number(savedLocalRun.distanceMeters ?? savedLocalRun.distance ?? 0),
    elapsedMs: Number(savedLocalRun.durationSeconds ?? savedLocalRun.duration ?? 0) * 1000,
    queuedSync: true,
    alreadySaved: existingAlreadyConfirmed,
    source,
    screen,
  });

  try {
    dependencies.scheduleRunsSync?.();
    recordRunSnapshotEvent("RUN_SYNC_QUEUED", savedLocalRun, {
      source,
      screen,
    });
  } catch (error) {
    issues.push({ stage: "schedule_sync", error });
  }

  let cleanupResult = null;
  try {
    cleanupResult = await withTimeout(
      () => dependencies.markRecoveredRunLocallySaved?.({
        reason: "finish_local_run_saved",
      }),
      timeouts.CLEANUP_MS,
      "finish_recovery_mark_saved_timeout"
    );
  } catch (error) {
    cleanupResult = { ok: false, error };
  }
  if (cleanupResult?.ok === false) {
    const error = cleanupResult.error || makeFinalizationError(
      "ACTIVE_RUN_CLEANUP_NOT_CONFIRMED",
      { stage: "mark_recovered_locally_saved" }
    );
    issues.push({ stage: "mark_recovered_locally_saved", error });
    recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
      runId,
      stage: "mark_recovered_locally_saved",
      error,
      source,
      screen,
      level: "warn",
    });
  }

  return {
    ok: true,
    runId,
    minimumRun,
    savedLocalRun,
    alreadySaved: existingAlreadyConfirmed,
    cleanupResult,
    issues,
  };
}

export function persistMinimumFinishedRun(runData = {}, options = {}) {
  const runId = resolveRunId(runData);
  if (!runId) return Promise.reject(makeFinalizationError("RUN_MINIMUM_SAVE_MISSING_ID"));
  const existingPromise = inFlightMinimumSaves.get(runId);
  if (existingPromise) return existingPromise;

  const promise = persistMinimumFinishedRunInternal(runData, options)
    .finally(() => {
      if (inFlightMinimumSaves.get(runId) === promise) {
        inFlightMinimumSaves.delete(runId);
      }
    });
  inFlightMinimumSaves.set(runId, promise);
  return promise;
}

export async function enqueuePostRunProcessing(savedRun = {}, options = {}) {
  const runId = resolveRunId(savedRun);
  if (!runId) {
    return {
      ok: false,
      runId: null,
      queued: [],
      error: makeFinalizationError("RUN_PROCESSING_MISSING_ID", {
        stage: "deferred_queue_enqueue",
      }),
    };
  }

  const source = options.source || "runFinalizationService";
  const screen = options.screen || null;
  const timeouts = { ...RUN_FINALIZATION_TIMEOUTS, ...(options.timeouts || {}) };
  const queueRepository = options.queueRepository ||
    (await import("../../repositories/runDeferredTaskQueueRepository.js")).default;

  try {
    const result = await withTimeout(
      () => queueRepository.enqueuePostRun(savedRun, {
        userId: options.userId || savedRun.userId || "offline",
        userName: options.userName || null,
        userAvatar: options.userAvatar || null,
        includeTerritory: options.includeTerritory === true ||
          String(savedRun.mode || "").toLowerCase() === "zones",
        source,
      }),
      timeouts.QUEUE_MS,
      "finish_deferred_queue_enqueue_timeout"
    );
    if (result?.error) throw result.error;
    const queued = Array.isArray(result?.data?.queued) ? result.data.queued : [];
    recordRunEvent("RUN_FINISH_DEFERRED_TASKS_SCHEDULED", {
      runId,
      localRunId: savedRun.localRunId || savedRun.id || null,
      queued: queued.length,
      queueStatus: result?.queueStatus || "queued",
      types: queued.map((task) => task.type),
      source,
      screen,
    });
    return { ok: true, runId, queued, result };
  } catch (error) {
    recordRunEvent("RUN_FINISH_ERROR_RECOVERABLE", {
      runId,
      stage: "deferred_queue_enqueue",
      reason: error?.code === "finish_deferred_queue_enqueue_timeout"
        ? "deferred_queue_enqueue_timeout"
        : "deferred_queue_enqueue_failed",
      error,
      source,
      screen,
      level: "warn",
    });
    return { ok: false, runId, queued: [], error };
  }
}

export function __resetRunFinalizationForTests() {
  inFlightMinimumSaves.clear();
}

export default {
  RUN_MINIMUM_SAVE_SCHEMA_VERSION,
  EXPEDITION_PROCESSING_SCHEMA_VERSION,
  RUN_FINALIZATION_TIMEOUTS,
  buildMinimumSavedRun,
  freezeActiveRunForFinalization,
  persistMinimumFinishedRun,
  enqueuePostRunProcessing,
};
