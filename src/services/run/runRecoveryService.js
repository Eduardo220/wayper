import {
  ACTIVE_RUN_SCHEMA_VERSION,
  ACTIVE_RUN_STATUS as OFFLINE_RUN_STATUS,
  ACTIVE_RUN_SYNC_STATUS,
  clearActiveRun,
  finishActiveRun as persistOfflineFinishedRun,
  loadActiveRun,
  shouldRecoverOfflineRun,
  shouldRestoreActiveRun,
  toAppRunMode,
} from "../runOfflineStorageService.js";
import {
  ACTIVE_RUN_STATUS as TRACKING_RUN_STATUS,
  buildRunDataFromActiveSnapshot,
  normalizeActiveRunSnapshot,
} from "../runTracking/activeRunState.js";
import { buildSummaryRenderPath, sanitizeRunPath } from "../runTracking/index.js";
import logger, { LOG_CATEGORIES } from "../../utils/logger.js";
import {
  recordRunEvent,
  recordRunSnapshotEvent,
} from "../diagnostics/runDiagnosticsService.js";

export const RUN_RECOVERY_SOURCE = {
  TRACKING: "tracking",
  OFFLINE: "offline",
};

export const RUN_RECOVERY_STATUS = {
  RUNNING: "running",
  PAUSED: "paused",
  FINISHED: "finished",
  PENDING_SYNC: "pending_sync",
  DISCARDED: "discarded",
};

const FINISHED_STATUSES = new Set([
  RUN_RECOVERY_STATUS.FINISHED,
  RUN_RECOVERY_STATUS.PENDING_SYNC,
  "sync_failed",
]);

const LOG_PREFIX = "[Wayper RunRecovery]";

function logRecovery(event, payload = {}) {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  logger.debug(LOG_CATEGORIES.RUN_RECOVERY, `${LOG_PREFIX} ${event}`, payload);
}

function toTimestampMs(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  const timestamp = toTimestampMs(value);
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeRecoveryStatus(status) {
  const raw = String(status || "").toLowerCase();
  if (raw === "running" || raw === "active") return RUN_RECOVERY_STATUS.RUNNING;
  if (raw === "paused") return RUN_RECOVERY_STATUS.PAUSED;
  if (raw === "finishing" || raw === "finalizing") return RUN_RECOVERY_STATUS.FINISHED;
  if (raw === "finished" || raw === "completed") return RUN_RECOVERY_STATUS.FINISHED;
  if (raw === "pending_sync" || raw === "sync_failed" || raw === "syncing") return RUN_RECOVERY_STATUS.PENDING_SYNC;

  const upper = String(status || "").toUpperCase();
  if (upper === TRACKING_RUN_STATUS.RUNNING || upper === OFFLINE_RUN_STATUS.RUNNING) return RUN_RECOVERY_STATUS.RUNNING;
  if (upper === TRACKING_RUN_STATUS.PAUSED || upper === OFFLINE_RUN_STATUS.PAUSED) return RUN_RECOVERY_STATUS.PAUSED;
  if (upper === TRACKING_RUN_STATUS.FINISHING) return RUN_RECOVERY_STATUS.FINISHED;
  if (upper === TRACKING_RUN_STATUS.FINISHED || upper === OFFLINE_RUN_STATUS.FINISHED) return RUN_RECOVERY_STATUS.FINISHED;
  if (upper === OFFLINE_RUN_STATUS.PENDING_SYNC || upper === OFFLINE_RUN_STATUS.SYNC_FAILED) return RUN_RECOVERY_STATUS.PENDING_SYNC;

  return RUN_RECOVERY_STATUS.RUNNING;
}

function getRunId(run = {}) {
  return run.activeRunId || run.localRunId || run.id || null;
}

function getRunUserId(run = {}) {
  return run.userId || run.uid || run.ownerId || null;
}

function getRunPoints(run = {}) {
  return sanitizeRunPath(
    run.trustedPath ||
      run.filteredPoints ||
      run.points ||
      run.path ||
      run.finalRunData?.trustedPath ||
      run.finalRunData?.path ||
      []
  );
}

function getRunRawPoints(run = {}) {
  return sanitizeRunPath(
    run.rawPath ||
      run.rawPoints ||
      run.finalRunData?.rawPath ||
      run.finalRunData?.rawPoints ||
      getRunPoints(run)
  );
}

function getRunRenderPath(run = {}) {
  const path = getRunPoints(run);
  return sanitizeRunPath(
    run.renderPath ||
      run.summaryRenderPath ||
      run.displayPath ||
      run.displayPoints ||
      run.finalRunData?.renderPath ||
      run.finalRunData?.displayPath ||
      (path.length > 1 ? buildSummaryRenderPath(path) : path)
  );
}

function getRunSegments(run = {}) {
  const segments =
    run.segments ||
    run.routeSegments ||
    run.finalRunData?.segments ||
    run.finalRunData?.routeSegments ||
    [];
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const points = getRunPoints(run);
  const rawPoints = getRunRawPoints(run);
  return segments.map((segment = {}, index) => {
    const segmentIndex = Number.isFinite(Number(segment.index ?? segment.segmentIndex ?? segment.segmentId))
      ? Number(segment.index ?? segment.segmentIndex ?? segment.segmentId)
      : index;
    const trustedPath = sanitizeRunPath(segment.trustedPath || segment.filteredPoints || segment.path || points.filter((point) => {
      const pointSegment = Number(point.segmentId ?? point.segmentIndex ?? 0);
      return pointSegment === segmentIndex;
    }));
    const rawPath = sanitizeRunPath(segment.rawPath || segment.rawPoints || rawPoints.filter((point) => {
      const pointSegment = Number(point.segmentId ?? point.segmentIndex ?? 0);
      return pointSegment === segmentIndex;
    }) || trustedPath);
    return {
      ...segment,
      index: segmentIndex,
      trustedPath,
      filteredPoints: trustedPath,
      rawPath,
      rawPoints: rawPath,
      displayPoints: sanitizeRunPath(segment.displayPoints || segment.summaryRenderPath || segment.renderPath || trustedPath),
    };
  });
}

function getRunStartedAt(run = {}) {
  return run.startedAt || run.startedAtMs || run.date || run.finalRunData?.startedAt || run.finalRunData?.date || null;
}

function getRunUpdatedAt(run = {}) {
  return (
    run.checkpointAtMs ||
    run.checkpointAt ||
    run.updatedAtMs ||
    run.updatedAt ||
    run.lastUpdatedAtMs ||
    run.lastUpdatedAt ||
    run.endedAt ||
    run.finishedAt ||
    run.date ||
    run.finalRunData?.updatedAt ||
    run.finalRunData?.endedAt ||
    run.finalRunData?.date ||
    null
  );
}

function getRunFinishedAt(run = {}) {
  return run.finishedAt || run.finishedAtMs || run.endedAt || run.finalRunData?.endedAt || run.finalRunData?.date || null;
}

function getRunDistanceMeters(run = {}) {
  return toFiniteNumber(run.distanceMeters ?? run.distance ?? run.finalRunData?.distanceMeters ?? run.finalRunData?.distance, 0);
}

function getRunDurationSeconds(run = {}) {
  const seconds = toFiniteNumber(run.durationSeconds ?? run.duration ?? run.finalRunData?.durationSeconds ?? run.finalRunData?.duration, null);
  if (seconds != null) return seconds;
  return Math.round(toFiniteNumber(run.durationMs ?? run.finalRunData?.durationMs, 0) / 1000);
}

function hasRecoverablePayload(run = {}) {
  const status = normalizeRecoveryStatus(run.status);
  if (
    (status === RUN_RECOVERY_STATUS.RUNNING || status === RUN_RECOVERY_STATUS.PAUSED) &&
    toTimestampMs(getRunStartedAt(run))
  ) {
    return true;
  }

  const points = getRunPoints(run);
  if (points.length > 0) return true;
  if (getRunDistanceMeters(run) > 0) return true;
  return getRunDurationSeconds(run) >= 5;
}

function isSchemaCompatible(run = {}, source) {
  if (source === RUN_RECOVERY_SOURCE.TRACKING) return true;
  const version = Number(run.schemaVersion || 1);
  return Number.isFinite(version) && version > 0 && version <= ACTIVE_RUN_SCHEMA_VERSION;
}

function userMatches(run = {}, userId) {
  const runUserId = getRunUserId(run);
  if (!runUserId || runUserId === "offline") return true;
  if (!userId || userId === "offline") return false;
  return String(runUserId) === String(userId);
}

export function validateRecoverableRun(run = {}, options = {}) {
  const source = options.source || RUN_RECOVERY_SOURCE.OFFLINE;
  const reasons = [];
  const status = normalizeRecoveryStatus(run.status);

  if (!getRunId(run)) reasons.push("missing_run_id");
  if (!userMatches(run, options.userId)) reasons.push("user_mismatch");
  if (!toTimestampMs(getRunStartedAt(run))) reasons.push("invalid_started_at");
  if (!hasRecoverablePayload(run)) reasons.push("empty_payload");
  if (!isSchemaCompatible(run, source)) reasons.push("schema_incompatible");
  if (String(run.status || "").toUpperCase() === TRACKING_RUN_STATUS.CANCELLED) reasons.push("cancelled");
  if (![
    RUN_RECOVERY_STATUS.RUNNING,
    RUN_RECOVERY_STATUS.PAUSED,
    RUN_RECOVERY_STATUS.FINISHED,
    RUN_RECOVERY_STATUS.PENDING_SYNC,
  ].includes(status)) {
    reasons.push("unsupported_status");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    status,
  };
}

export function createRecoveryCandidate(source, run = {}, options = {}) {
  const validation = validateRecoverableRun(run, { ...options, source });
  if (!validation.ok) {
    return {
      source,
      raw: run,
      validation,
      recoverable: false,
    };
  }

  const points = getRunPoints(run);
  const startedAt = toIso(getRunStartedAt(run));
  const updatedAt = toIso(getRunUpdatedAt(run)) || startedAt;
  const durationSeconds = getRunDurationSeconds(run);
  const distanceMeters = getRunDistanceMeters(run);
  const mode = toAppRunMode(run.mode || run.finalRunData?.mode || "free");

  return {
    source,
    raw: run,
    recoverable: true,
    validation,
    id: String(getRunId(run)),
    activeRunId: run.activeRunId || run.id || null,
    localRunId: run.localRunId || run.activeRunId || run.id || null,
    remoteRunId: run.remoteRunId || run.finalRunData?.remoteRunId || null,
    userId: getRunUserId(run) || options.userId || "offline",
    status: validation.status,
    mode,
    startedAt,
    updatedAt,
    finishedAt: toIso(getRunFinishedAt(run)),
    durationSeconds,
    distanceMeters,
    lastPoint: run.currentLocation || run.lastValidPoint || points[points.length - 1] || null,
    pointsCount: points.length,
    segmentsCount: getRunSegments(run).length,
    syncStatus: run.syncStatus || run.finalRunData?.syncStatus || null,
    offlineStatus: run.offlineStatus || run.status || null,
    pendingSync: run.pendingSync !== false || validation.status === RUN_RECOVERY_STATUS.PENDING_SYNC,
  };
}

async function getActiveRunSnapshot() {
  try {
    const module = await import("../runTracking/activeRunTrackingService.js");
    const service = module.default || module;
    return service.getActiveRunSnapshot?.() || null;
  } catch {
    return null;
  }
}

async function getTrackingService() {
  const module = await import("../runTracking/activeRunTrackingService.js");
  return module.default || module;
}

function candidateUpdatedAtMs(candidate = {}) {
  return toTimestampMs(candidate.updatedAt) || toTimestampMs(getRunUpdatedAt(candidate.raw || {})) || 0;
}

function candidateFinishedAtMs(candidate = {}) {
  return toTimestampMs(candidate.finishedAt) || toTimestampMs(getRunFinishedAt(candidate.raw || {})) || 0;
}

function hasFinishedMarker(candidate = {}) {
  return isFinishedRecovery(candidate) || Boolean(candidateFinishedAtMs(candidate));
}

function hasLiveStatus(candidate = {}) {
  return isLiveRecovery(candidate);
}

function sameLogicalRun(a = {}, b = {}) {
  const idsA = [a.id, a.activeRunId, a.localRunId].filter(Boolean).map(String);
  const idsB = [b.id, b.activeRunId, b.localRunId].filter(Boolean).map(String);
  return idsA.some((id) => idsB.includes(id));
}

function candidateCompletenessScore(candidate = {}) {
  const raw = candidate.raw || {};
  let score = 0;
  if (candidate.localRunId || raw.localRunId) score += 20;
  if (candidate.pointsCount > 0) score += Math.min(candidate.pointsCount, 200);
  if (candidate.segmentsCount > 0) score += Math.min(candidate.segmentsCount * 8, 80);
  if (candidate.distanceMeters > 0) score += 20;
  if (candidate.durationSeconds > 0) score += 20;
  if (!hasFinishedMarker(candidate)) score += 15;
  if (candidate.source === RUN_RECOVERY_SOURCE.TRACKING) score += 5;
  return score;
}

function compareRecoveryCandidates(a = {}, b = {}) {
  const aFinished = hasFinishedMarker(a);
  const bFinished = hasFinishedMarker(b);
  if (sameLogicalRun(a, b) && aFinished !== bFinished) {
    return aFinished ? -1 : 1;
  }

  const aLive = hasLiveStatus(a);
  const bLive = hasLiveStatus(b);
  if (aLive !== bLive) return aLive ? -1 : 1;

  const timeDiff = candidateUpdatedAtMs(b) - candidateUpdatedAtMs(a);
  if (Math.abs(timeDiff) > 1000) return timeDiff;

  const scoreDiff = candidateCompletenessScore(b) - candidateCompletenessScore(a);
  if (scoreDiff !== 0) return scoreDiff;

  if (a.source !== b.source) {
    return a.source === RUN_RECOVERY_SOURCE.TRACKING ? -1 : 1;
  }

  return String(a.id || "").localeCompare(String(b.id || ""));
}

// Regra deterministica de conflito:
// 1. candidatos invalidos/corrompidos sao descartados;
// 2. se o mesmo run aparece como finalizado e vivo, o finalizado vence para nao ressuscitar corrida ja encerrada;
// 3. entre corridas vivas, vence o checkpoint mais recente; em empate, vence o payload mais completo;
// 4. em empate real, o snapshot canonico (`wayper:activeRun:v2`) vence o legado;
// 5. candidato legado vivo so e aplicado depois de migrar para o snapshot canonico.
export function resolveRecoveryConflict(candidates = [], options = {}) {
  const valid = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate) continue;
    if (candidate.recoverable) {
      valid.push(candidate);
      continue;
    }
    logRecovery("recovery_candidate_discarded", {
      source: candidate.source,
      reasons: candidate.validation?.reasons || ["not_recoverable"],
    });
    recordRunEvent("RECOVERY_FAILED", {
      source: candidate.source,
      reasons: candidate.validation?.reasons || ["not_recoverable"],
      level: "warn",
    });
  }

  if (valid.length === 0) return null;
  const sorted = [...valid].sort(compareRecoveryCandidates);
  const selected = sorted[0] || null;

  if (valid.length > 1 && selected) {
    logRecovery("recovery_conflict_resolved", {
      selectedSource: selected.source,
      selectedRunId: selected.id,
      selectedStatus: selected.status,
      alternatives: valid.slice(1).map((candidate) => ({
        source: candidate.source,
        id: candidate.id,
        status: candidate.status,
        updatedAt: candidate.updatedAt,
      })),
      reason: options.reason || "deterministic_resolution",
    });
    recordRunEvent("RECOVERY_MERGED_STATE", {
      runId: selected.id,
      source: selected.source,
      status: selected.status,
      alternativesCount: valid.length - 1,
      reason: options.reason || "deterministic_resolution",
    });
  }

  return selected;
}

export function buildActiveSnapshotFromOfflineRun(offlineRun = {}, options = {}) {
  const candidateStatus = normalizeRecoveryStatus(options.status || offlineRun.status);
  if (isFinishedRecovery({ status: candidateStatus })) return null;

  const startedAtMs = toTimestampMs(getRunStartedAt(offlineRun)) || Date.now();
  const updatedAtMs = toTimestampMs(getRunUpdatedAt(offlineRun)) || Date.now();
  const status =
    options.forceRunning === true
      ? TRACKING_RUN_STATUS.RUNNING
      : candidateStatus === RUN_RECOVERY_STATUS.PAUSED
        ? TRACKING_RUN_STATUS.PAUSED
        : TRACKING_RUN_STATUS.RUNNING;
  const path = getRunPoints(offlineRun);
  const rawPath = getRunRawPoints(offlineRun);
  const renderPath = getRunRenderPath(offlineRun);
  const runId = String(offlineRun.localRunId || offlineRun.activeRunId || offlineRun.id || `local_${startedAtMs}`);

  return normalizeActiveRunSnapshot({
    activeRunId: runId,
    id: runId,
    localRunId: offlineRun.localRunId || runId,
    remoteRunId: offlineRun.remoteRunId || offlineRun.finalRunData?.remoteRunId || null,
    userId: offlineRun.userId || options.userId || "offline",
    mode: toAppRunMode(offlineRun.mode || offlineRun.finalRunData?.mode || "free"),
    status,
    startedAtMs,
    startedAt: toIso(startedAtMs),
    lastUpdatedAtMs: updatedAtMs,
    lastUpdatedAt: toIso(updatedAtMs),
    path,
    trustedPath: path,
    filteredPoints: path,
    rawPath,
    rawPoints: rawPath,
    segments: getRunSegments(offlineRun),
    routeSegments: getRunSegments(offlineRun),
    liveRenderPath: sanitizeRunPath(offlineRun.liveRenderPath || renderPath),
    displayPoints: renderPath,
    renderPath,
    distance: getRunDistanceMeters(offlineRun),
    distanceMeters: getRunDistanceMeters(offlineRun),
    duration: getRunDurationSeconds(offlineRun),
    durationSeconds: getRunDurationSeconds(offlineRun),
    syncStatus: offlineRun.syncStatus || ACTIVE_RUN_SYNC_STATUS.LOCAL_ONLY,
    offlineStatus: offlineRun.status || null,
    pendingSync: true,
    synced: false,
    source: "legacy_offline_recovery",
    meta: {
      ...(offlineRun.meta || {}),
      migratedFromLegacySnapshot: true,
      legacyUpdatedAt: toIso(getRunUpdatedAt(offlineRun)),
    },
  });
}

export async function findRecoverableRunForUser(userId, options = {}) {
  recordRunEvent("RECOVERY_STARTED", {
    userId: userId || "offline",
    reason: options.reason || "find_recoverable_run",
  });
  const activeSnapshot = options.activeSnapshot === undefined
    ? await getActiveRunSnapshot()
    : options.activeSnapshot;
  const activeCandidate = activeSnapshot
    ? createRecoveryCandidate(RUN_RECOVERY_SOURCE.TRACKING, activeSnapshot, { userId })
    : null;

  let offlineRun = options.offlineRun;
  if (offlineRun === undefined) {
    try {
      offlineRun = await loadActiveRun();
    } catch {
      offlineRun = null;
    }
  }

  const offlineCandidate = shouldRecoverOfflineRun(offlineRun)
    ? createRecoveryCandidate(RUN_RECOVERY_SOURCE.OFFLINE, offlineRun, { userId })
    : offlineRun
      ? {
          source: RUN_RECOVERY_SOURCE.OFFLINE,
          raw: offlineRun,
          recoverable: false,
          validation: {
            ok: false,
            reasons: [shouldRestoreActiveRun(offlineRun) ? "not_recoverable" : "not_active_or_pending"],
          },
        }
      : null;

  return resolveRecoveryConflict([activeCandidate, offlineCandidate], {
    userId,
    reason: options.reason || "find_recoverable_run",
  });
}

export async function hydrateRecoverableRunCandidate(candidate = {}, options = {}) {
  if (!candidate?.recoverable || isFinishedRecovery(candidate)) {
    logRecovery("recovery_hydration_discarded", {
      source: candidate?.source,
      id: candidate?.id,
      status: candidate?.status,
      reason: "not_live",
    });
    recordRunEvent("RECOVERY_FAILED", {
      runId: candidate?.id,
      localRunId: candidate?.localRunId,
      source: candidate?.source,
      status: candidate?.status,
      reason: "not_live",
      level: "warn",
    });
    return null;
  }

  try {
    const service = await getTrackingService();

    if (candidate.source === RUN_RECOVERY_SOURCE.TRACKING) {
      const restored = await service.restoreActiveRun?.({
        restartTracking: options.restartTracking !== false,
      });
      const snapshot = restored || candidate.raw || null;
      logRecovery("canonical_recovery_applied", {
        activeRunId: snapshot?.activeRunId,
        status: snapshot?.status,
        points: snapshot?.trustedPath?.length || snapshot?.path?.length || 0,
      });
      recordRunSnapshotEvent("RECOVERY_COMPLETED", snapshot, {
        source: RUN_RECOVERY_SOURCE.TRACKING,
      });
      return {
        candidate,
        snapshot,
        source: RUN_RECOVERY_SOURCE.TRACKING,
      };
    }

    const snapshot = buildActiveSnapshotFromOfflineRun(candidate.raw, {
      userId: options.userId || candidate.userId,
      forceRunning: options.forceRunning,
    });
    if (!snapshot?.activeRunId) {
      logRecovery("legacy_recovery_discarded", {
        id: candidate.id,
        status: candidate.status,
        reason: "cannot_build_canonical_snapshot",
      });
      recordRunEvent("RECOVERY_FAILED", {
        runId: candidate.id,
        localRunId: candidate.localRunId,
        source: candidate.source,
        reason: "cannot_build_canonical_snapshot",
      });
      return null;
    }

    const hydrated = await service.hydrateActiveRunSnapshot?.(snapshot, {
      replaceExisting: true,
      restartTracking: options.restartTracking !== false,
      recovered: true,
      event: "legacy_run_hydrated",
    });

    logRecovery("legacy_recovery_migrated", {
      localRunId: candidate.localRunId || candidate.id,
      activeRunId: hydrated?.activeRunId,
      status: hydrated?.status,
      points: hydrated?.trustedPath?.length || 0,
      segments: hydrated?.segments?.length || 0,
    });
    recordRunSnapshotEvent("RECOVERY_COMPLETED", hydrated || snapshot, {
      source: RUN_RECOVERY_SOURCE.TRACKING,
      migratedFrom: RUN_RECOVERY_SOURCE.OFFLINE,
    });

    return {
      candidate: createRecoveryCandidate(RUN_RECOVERY_SOURCE.TRACKING, hydrated || snapshot, {
        userId: options.userId || candidate.userId,
      }),
      snapshot: hydrated || snapshot,
      source: RUN_RECOVERY_SOURCE.TRACKING,
      migratedFrom: RUN_RECOVERY_SOURCE.OFFLINE,
    };
  } catch (error) {
    logRecovery("recovery_hydration_failed", {
      source: candidate.source,
      id: candidate.id,
      error: error?.message || String(error),
    });
    recordRunEvent("RECOVERY_FAILED", {
      runId: candidate.id,
      localRunId: candidate.localRunId,
      source: candidate.source,
      error,
    });
    return null;
  }
}

export async function persistFinishedRunDraft(runData = {}, options = {}) {
  try {
    const saved = await persistOfflineFinishedRun(runData, options);
    logRecovery("finished_run_draft_persisted", {
      localRunId: saved?.localRunId,
      status: saved?.status,
      syncStatus: saved?.syncStatus,
    });
    recordRunSnapshotEvent("RUN_SAVED_LOCAL", saved, {
      source: "recovery_finished_draft",
    });
    return saved;
  } catch (error) {
    logRecovery("finished_run_draft_failed", {
      runId: runData?.id || runData?.localRunId,
      error: error?.message || String(error),
    });
    recordRunEvent("FINISH_FAILED", {
      runId: runData?.id || runData?.localRunId,
      source: "recovery_finished_draft",
      error,
    });
    throw error;
  }
}

export async function markRecoveredRunLocallySaved(options = {}) {
  try {
    const service = await getTrackingService();
    const expectedRunId = options.expectedRunId || options.runId || options.localRunId || null;
    const canonicalCleared = await service.markActiveRunLocallySaved?.({
      expectedRunId,
      reason: options.reason || "local_run_saved",
    });
    if (canonicalCleared === false) {
      const error = new Error("canonical active run cleanup was not confirmed");
      error.code = "ACTIVE_RUN_CLEANUP_NOT_CONFIRMED";
      throw error;
    }
    const legacyCleared = await clearActiveRun({
      expectedRunId,
      reason: options.reason || "local_run_saved",
    });
    if (legacyCleared === false) {
      const error = new Error("legacy active run cleanup was not confirmed");
      error.code = "ACTIVE_RUN_CLEANUP_NOT_CONFIRMED";
      throw error;
    }
    logRecovery("active_run_state_cleared_after_local_save", {
      reason: options.reason || "local_run_saved",
    });
    recordRunEvent("RUN_SAVED_LOCAL", {
      reason: options.reason || "local_run_saved",
      source: "recovery_cleanup",
    });
    return { ok: true };
  } catch (error) {
    logRecovery("active_run_state_clear_failed", {
      reason: options.reason || "local_run_saved",
      error: error?.message || String(error),
    });
    recordRunEvent("ACTIVE_RUN_SAVE_FAILED", {
      reason: options.reason || "local_run_saved",
      source: "recovery_cleanup",
      error,
    });
    return { ok: false, error };
  }
}

export function buildRecoverySummary(candidate = {}) {
  return {
    id: candidate.id || null,
    status: candidate.status || RUN_RECOVERY_STATUS.RUNNING,
    mode: candidate.mode || "free",
    distanceMeters: toFiniteNumber(candidate.distanceMeters, 0),
    durationSeconds: toFiniteNumber(candidate.durationSeconds, 0),
    startedAt: candidate.startedAt || null,
    updatedAt: candidate.updatedAt || null,
    lastPoint: candidate.lastPoint || null,
    pointsCount: toFiniteNumber(candidate.pointsCount, 0),
    pendingSync: Boolean(candidate.pendingSync),
    source: candidate.source || RUN_RECOVERY_SOURCE.OFFLINE,
  };
}

export function isFinishedRecovery(candidate = {}) {
  return FINISHED_STATUSES.has(candidate.status);
}

export function isLiveRecovery(candidate = {}) {
  return candidate.status === RUN_RECOVERY_STATUS.RUNNING || candidate.status === RUN_RECOVERY_STATUS.PAUSED;
}

export function buildRunDataFromRecoveredRun(candidate = {}, overrides = {}) {
  const raw = candidate.raw || {};
  if (candidate.source === RUN_RECOVERY_SOURCE.TRACKING) {
    const runData = buildRunDataFromActiveSnapshot(raw, {
      status: "completed",
      ...overrides,
    });
    return {
      ...runData,
      localRunId: raw.localRunId || candidate.localRunId || runData.localRunId || runData.id,
      remoteRunId: raw.remoteRunId || candidate.remoteRunId || runData.remoteRunId || null,
      syncStatus: overrides.syncStatus || "PENDING",
      offlineStatus: overrides.offlineStatus || "PENDING_SYNC",
    };
  }

  const finalRunData = raw.finalRunData || {};
  const points = getRunPoints(raw);
  const path = sanitizeRunPath(finalRunData.trustedPath || finalRunData.path || points);
  const renderPath = sanitizeRunPath(
    finalRunData.renderPath ||
      finalRunData.displayPath ||
      (path.length > 1 ? buildSummaryRenderPath(path) : path)
  );
  const endedAt = raw.endedAt || finalRunData.endedAt || raw.updatedAt || new Date().toISOString();
  const durationSeconds = getRunDurationSeconds(raw);

  return {
    ...finalRunData,
    ...overrides,
    id: overrides.id || finalRunData.id || raw.localRunId || candidate.id,
    localRunId: raw.localRunId || candidate.id,
    userId: raw.userId || candidate.userId || "offline",
    mode: overrides.mode || finalRunData.mode || candidate.mode || toAppRunMode(raw.mode),
    path,
    trustedPath: path,
    filteredPoints: path,
    rawPath: sanitizeRunPath(finalRunData.rawPath || finalRunData.rawPoints || raw.rawPoints || path),
    rawPoints: sanitizeRunPath(finalRunData.rawPoints || finalRunData.rawPath || raw.rawPoints || path),
    renderPath,
    displayPath: renderPath,
    displayPoints: renderPath,
    segments: finalRunData.segments || finalRunData.routeSegments || raw.segments || [],
    routeSegments: finalRunData.routeSegments || finalRunData.segments || raw.segments || [],
    distance: getRunDistanceMeters(raw),
    distanceMeters: getRunDistanceMeters(raw),
    duration: durationSeconds,
    durationSeconds,
    date: finalRunData.date || endedAt,
    startedAt: finalRunData.startedAt || raw.startedAt || candidate.startedAt || null,
    endedAt,
    status: "completed",
    synced: false,
    pendingSync: true,
    syncStatus: overrides.syncStatus || "PENDING",
    offlineStatus: overrides.offlineStatus || "PENDING_SYNC",
  };
}

export async function discardRecoveredRun(candidate = {}) {
  try {
    if (candidate.source === RUN_RECOVERY_SOURCE.TRACKING) {
      const module = await import("../runTracking/activeRunTrackingService.js");
      const service = module.default || module;
      await service.cancelActiveRun?.({ reason: "discard_recovery" });
    }
    if (!candidate.source || candidate.source === RUN_RECOVERY_SOURCE.OFFLINE) {
      await clearActiveRun();
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export default {
  RUN_RECOVERY_SOURCE,
  RUN_RECOVERY_STATUS,
  buildActiveSnapshotFromOfflineRun,
  buildRecoverySummary,
  buildRunDataFromRecoveredRun,
  createRecoveryCandidate,
  discardRecoveredRun,
  findRecoverableRunForUser,
  hydrateRecoverableRunCandidate,
  isFinishedRecovery,
  isLiveRecovery,
  markRecoveredRunLocallySaved,
  normalizeRecoveryStatus,
  persistFinishedRunDraft,
  resolveRecoveryConflict,
  validateRecoverableRun,
};
