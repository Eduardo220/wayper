import {
  ACTIVE_RUN_SCHEMA_VERSION,
  ACTIVE_RUN_STATUS as OFFLINE_RUN_STATUS,
  clearActiveRun,
  loadActiveRun,
  shouldRestoreActiveRun,
  toAppRunMode,
} from "../runOfflineStorageService.js";
import {
  ACTIVE_RUN_STATUS as TRACKING_RUN_STATUS,
  buildRunDataFromActiveSnapshot,
} from "../runTracking/activeRunState.js";
import { buildSummaryRenderPath, sanitizeRunPath } from "../runTracking/index.js";

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
  if (raw === "finished" || raw === "completed") return RUN_RECOVERY_STATUS.FINISHED;
  if (raw === "pending_sync" || raw === "sync_failed" || raw === "syncing") return RUN_RECOVERY_STATUS.PENDING_SYNC;

  const upper = String(status || "").toUpperCase();
  if (upper === TRACKING_RUN_STATUS.RUNNING || upper === OFFLINE_RUN_STATUS.RUNNING) return RUN_RECOVERY_STATUS.RUNNING;
  if (upper === TRACKING_RUN_STATUS.PAUSED || upper === OFFLINE_RUN_STATUS.PAUSED) return RUN_RECOVERY_STATUS.PAUSED;
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

function getRunStartedAt(run = {}) {
  return run.startedAt || run.startedAtMs || run.date || run.finalRunData?.startedAt || run.finalRunData?.date || null;
}

function getRunUpdatedAt(run = {}) {
  return run.updatedAt || run.lastUpdatedAt || run.lastUpdatedAtMs || run.endedAt || run.finishedAt || run.date || null;
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
    userId: getRunUserId(run) || options.userId || "offline",
    status: validation.status,
    mode,
    startedAt,
    updatedAt,
    durationSeconds,
    distanceMeters,
    lastPoint: run.currentLocation || run.lastValidPoint || points[points.length - 1] || null,
    pointsCount: points.length,
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

export async function findRecoverableRunForUser(userId, options = {}) {
  const activeSnapshot = options.activeSnapshot === undefined
    ? await getActiveRunSnapshot()
    : options.activeSnapshot;
  const activeCandidate = activeSnapshot
    ? createRecoveryCandidate(RUN_RECOVERY_SOURCE.TRACKING, activeSnapshot, { userId })
    : null;

  if (activeCandidate?.recoverable) return activeCandidate;

  let offlineRun = options.offlineRun;
  if (offlineRun === undefined) {
    try {
      offlineRun = await loadActiveRun();
    } catch {
      offlineRun = null;
    }
  }

  if (!shouldRestoreActiveRun(offlineRun)) return null;
  const offlineCandidate = createRecoveryCandidate(RUN_RECOVERY_SOURCE.OFFLINE, offlineRun, { userId });
  return offlineCandidate?.recoverable ? offlineCandidate : null;
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

export function buildRunDataFromRecoveredRun(candidate = {}, overrides = {}) {
  const raw = candidate.raw || {};
  if (candidate.source === RUN_RECOVERY_SOURCE.TRACKING) {
    return buildRunDataFromActiveSnapshot(raw, {
      status: "completed",
      ...overrides,
    });
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
  buildRecoverySummary,
  buildRunDataFromRecoveredRun,
  createRecoveryCandidate,
  discardRecoveredRun,
  findRecoverableRunForUser,
  isFinishedRecovery,
  normalizeRecoveryStatus,
  validateRecoverableRun,
};
