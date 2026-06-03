import { createTrackingSession } from "../tracking/trackingPathService.js";
import { buildSummaryRenderPath } from "../tracking/trackingRenderPath.js";
import { calculatePathDistanceMeters } from "../tracking/trackingMath.js";
import { summarizeGpsQuality } from "./gpsQuality.js";
import { normalizeTrackSegments, sanitizeRunPath } from "./trackSegments.js";

export const ACTIVE_RUN_STORAGE_KEY = "wayper:activeRun:v2";

export const ACTIVE_RUN_STATUS = {
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  FINISHING: "FINISHING",
  FINISHED: "FINISHED",
  CANCELLED: "CANCELLED",
};

const DEFAULT_NOTIFICATION_BODY = "Sua corrida esta sendo salva mesmo com a tela bloqueada.";

export function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function createRunId(now = Date.now(), random = Math.random()) {
  return `${now.toString(36)}_${String(random).slice(2, 10)}`;
}

export function toTimestampMs(value, fallback = Date.now()) {
  if (value == null || value === "") return fallback;
  if (Number.isFinite(Number(value))) return Number(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeStatus(status) {
  const raw = String(status || "").toUpperCase();
  if (raw === "ACTIVE") return ACTIVE_RUN_STATUS.RUNNING;
  if (raw === "COMPLETED") return ACTIVE_RUN_STATUS.FINISHED;
  return Object.values(ACTIVE_RUN_STATUS).includes(raw) ? raw : ACTIVE_RUN_STATUS.RUNNING;
}

function normalizeSegments(segments = []) {
  const sourceSegments = Array.isArray(segments) ? segments : [];
  return normalizeTrackSegments(sourceSegments).map((segment, index) => {
    const source = sourceSegments[index] || {};
    const hasExplicitEnd = source.endedAt != null || source.endReason != null;
    return {
      ...segment,
      index: Number.isFinite(Number(segment.index)) ? Number(segment.index) : index,
      endedAt: hasExplicitEnd ? (source.endedAt ?? source.endTimestamp ?? segment.endedAt) : null,
      endTimestamp: hasExplicitEnd ? (source.endTimestamp ?? source.endedAt ?? segment.endTimestamp) : (source.endTimestamp ?? segment.endTimestamp),
    };
  });
}

function sumSegmentsDurationMs(segments = [], options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const status = normalizeStatus(options.status);
  const sourceSegments = Array.isArray(segments) ? segments : [];
  return normalizeSegments(sourceSegments).reduce((total, segment, index, all) => {
    const source = sourceSegments[index] || {};
    const start = toTimestampMs(segment.startedAt ?? segment.startTimestamp, null);
    if (start == null) return total;
    const isLast = index === all.length - 1;
    const hasExplicitEnd = source.endedAt != null || source.endReason != null;
    const runningLast = status === ACTIVE_RUN_STATUS.RUNNING && isLast && !hasExplicitEnd;
    const endValue = runningLast ? nowMs : source.endedAt ?? source.endTimestamp ?? segment.endedAt ?? segment.endTimestamp;
    const end = toTimestampMs(endValue, runningLast ? nowMs : start);
    return total + Math.max(0, end - start);
  }, 0);
}

export function calculateActiveRunDurationMs(snapshot = {}, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const status = normalizeStatus(snapshot.status);
  const segments = normalizeSegments(snapshot.segments || snapshot.routeSegments || []);
  const segmentDuration = sumSegmentsDurationMs(segments, { nowMs, status });
  if (segmentDuration > 0) return segmentDuration;

  const startedAtMs = toTimestampMs(snapshot.startedAtMs ?? snapshot.startedAt, nowMs);
  const finishedAtMs =
    status === ACTIVE_RUN_STATUS.FINISHED
      ? toTimestampMs(snapshot.finishedAtMs ?? snapshot.finishedAt ?? snapshot.endedAt, nowMs)
      : nowMs;
  const pausedMs = Number(snapshot.pausedDurationMs || 0);
  return Math.max(0, finishedAtMs - startedAtMs - pausedMs);
}

export function calculateActiveRunDurationSeconds(snapshot = {}, options = {}) {
  return Math.max(0, Math.round(calculateActiveRunDurationMs(snapshot, options) / 1000));
}

export function calculatePaceSecondsPerKm(durationSeconds = 0, distanceMeters = 0) {
  const distanceKm = Number(distanceMeters || 0) / 1000;
  if (distanceKm <= 0) return 0;
  return Number(durationSeconds || 0) / distanceKm;
}

export function createSnapshotFromTrackingSession(session, base = {}, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const runId = base.activeRunId || base.id || createRunId(nowMs);
  const status = normalizeStatus(options.status || base.status || ACTIVE_RUN_STATUS.RUNNING);
  const state = session?.getState?.() || {};
  const trustedPath = sanitizeRunPath(state.trustedPath || state.filteredPoints || base.points || base.path || []);
  const rawPath = sanitizeRunPath(state.rawPath || state.rawPoints || base.rawPoints || trustedPath);
  const segments = normalizeSegments(state.segments || base.segments || []);
  const currentLocation = state.currentPosition || trustedPath[trustedPath.length - 1] || base.currentLocation || null;
  const distance = Number(state.stats?.distanceMeters ?? state.distanceMeters ?? base.distanceMeters ?? base.distance ?? 0) ||
    calculatePathDistanceMeters(trustedPath);
  const durationSeconds = calculateActiveRunDurationSeconds(
    {
      ...base,
      status,
      segments,
      startedAtMs: base.startedAtMs,
      finishedAtMs: options.finishedAtMs,
    },
    { nowMs }
  );
  const pace = calculatePaceSecondsPerKm(durationSeconds, distance);
  const gpsQualitySummary = state.gpsQualitySummary || state.pathQuality || summarizeGpsQuality({
    rawPoints: rawPath,
    filteredPoints: trustedPath,
    segments,
  });

  return {
    activeRunId: runId,
    id: runId,
    userId: base.userId || "offline",
    mode: base.mode || "free",
    startedAtMs: toTimestampMs(base.startedAtMs ?? base.startedAt, nowMs),
    startedAt: base.startedAt || nowIso(toTimestampMs(base.startedAtMs ?? base.startedAt, nowMs)),
    finishedAtMs: options.finishedAtMs || base.finishedAtMs || null,
    finishedAt: options.finishedAt || base.finishedAt || null,
    lastUpdatedAtMs: nowMs,
    lastUpdatedAt: nowIso(nowMs),
    status,
    points: trustedPath,
    path: trustedPath,
    trustedPath,
    filteredPoints: trustedPath,
    rawPath,
    rawPoints: rawPath,
    segments,
    routeSegments: segments,
    liveRenderPath: sanitizeRunPath(state.liveRenderPath || base.liveRenderPath || trustedPath),
    displayPoints: sanitizeRunPath(state.displayPoints || state.liveRenderPath || base.displayPoints || trustedPath),
    currentLocation,
    distance,
    distanceMeters: distance,
    duration: durationSeconds,
    durationSeconds,
    durationMs: durationSeconds * 1000,
    pace,
    paceSecondsPerKm: pace,
    pendingSync: true,
    synced: false,
    source: options.source || base.source || "foreground",
    pathQuality: state.pathQuality || base.pathQuality || gpsQualitySummary,
    gpsQualitySummary,
    lowConfidenceSegments: state.lowConfidenceSegments || base.lowConfidenceSegments || [],
    smoothingVersion: state.smoothingVersion || base.smoothingVersion || "wayper_tracking_v2",
    filterVersion: state.filterVersion || base.filterVersion || "wayper_gps_filter_v2",
    notificationBody: base.notificationBody || DEFAULT_NOTIFICATION_BODY,
    meta: {
      ...(base.meta || {}),
      recovered: Boolean(base.meta?.recovered || options.recovered),
    },
  };
}

export function normalizeActiveRunSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const status = normalizeStatus(snapshot.status);
  const trustedPath = sanitizeRunPath(snapshot.points || snapshot.trustedPath || snapshot.filteredPoints || snapshot.path || []);
  const rawPath = sanitizeRunPath(snapshot.rawPoints || snapshot.rawPath || trustedPath);
  const segments = normalizeSegments(snapshot.segments || snapshot.routeSegments || []);
  const startedAtMs = toTimestampMs(snapshot.startedAtMs ?? snapshot.startedAt, Date.now());
  const runId = snapshot.activeRunId || snapshot.id || createRunId(startedAtMs);
  const finishedAtMs = snapshot.finishedAtMs || snapshot.finishedAt || snapshot.endedAt
    ? toTimestampMs(snapshot.finishedAtMs ?? snapshot.finishedAt ?? snapshot.endedAt, null)
    : null;
  const distance = Number(snapshot.distanceMeters ?? snapshot.distance ?? calculatePathDistanceMeters(trustedPath)) || 0;
  const durationSeconds = calculateActiveRunDurationSeconds({
    ...snapshot,
    status,
    segments,
    startedAtMs,
    finishedAtMs,
  });
  const pace = calculatePaceSecondsPerKm(durationSeconds, distance);

  return {
    ...snapshot,
    activeRunId: runId,
    id: runId,
    userId: snapshot.userId || "offline",
    mode: snapshot.mode || "free",
    startedAtMs,
    startedAt: snapshot.startedAt || nowIso(startedAtMs),
    finishedAtMs,
    finishedAt: snapshot.finishedAt || (finishedAtMs ? nowIso(finishedAtMs) : null),
    lastUpdatedAtMs: toTimestampMs(snapshot.lastUpdatedAtMs ?? snapshot.lastUpdatedAt, Date.now()),
    lastUpdatedAt: snapshot.lastUpdatedAt || nowIso(toTimestampMs(snapshot.lastUpdatedAtMs ?? snapshot.lastUpdatedAt, Date.now())),
    status,
    points: trustedPath,
    path: trustedPath,
    trustedPath,
    filteredPoints: sanitizeRunPath(snapshot.filteredPoints || trustedPath),
    rawPath,
    rawPoints: rawPath,
    segments,
    routeSegments: segments,
    currentLocation: snapshot.currentLocation || trustedPath[trustedPath.length - 1] || null,
    distance,
    distanceMeters: distance,
    duration: durationSeconds,
    durationSeconds,
    durationMs: durationSeconds * 1000,
    pace,
    paceSecondsPerKm: pace,
    pendingSync: snapshot.pendingSync !== false,
    synced: false,
    source: snapshot.source || "foreground",
    notificationBody: snapshot.notificationBody || DEFAULT_NOTIFICATION_BODY,
    meta: snapshot.meta || {},
  };
}

export function createTrackingSessionFromSnapshot(snapshot = {}) {
  const normalized = normalizeActiveRunSnapshot(snapshot);
  return createTrackingSession({
    mode: normalized?.mode || "run",
    startedAt: normalized?.startedAtMs || Date.now(),
    snapshot: normalized,
  });
}

export function buildRunDataFromActiveSnapshot(snapshot = {}, overrides = {}) {
  const normalized = normalizeActiveRunSnapshot(snapshot);
  const path = sanitizeRunPath(normalized?.trustedPath || []);
  const renderPath = sanitizeRunPath(
    normalized?.renderPath ||
      normalized?.summaryRenderPath ||
      normalized?.displayPath ||
      (path.length > 1 ? buildSummaryRenderPath(path) : path)
  );
  const durationSeconds = Number(overrides.durationSeconds ?? normalized.durationSeconds ?? 0) || 0;
  const distanceMeters = Number(overrides.distanceMeters ?? normalized.distanceMeters ?? normalized.distance ?? 0) || 0;
  const finishedAt = overrides.finishedAt || normalized.finishedAt || nowIso();
  const avgSpeed = distanceMeters && durationSeconds
    ? Number(((distanceMeters / 1000) / (durationSeconds / 3600)).toFixed(2))
    : 0;

  return {
    id: overrides.id || normalized.activeRunId,
    activeRunId: normalized.activeRunId,
    userId: normalized.userId,
    mode: overrides.mode || normalized.mode || "free",
    status: overrides.status || "completed",
    date: finishedAt,
    startedAt: normalized.startedAt,
    endedAt: finishedAt,
    path,
    trustedPath: path,
    filteredPoints: path,
    rawPath: sanitizeRunPath(normalized.rawPath || normalized.rawPoints || path),
    rawPoints: sanitizeRunPath(normalized.rawPath || normalized.rawPoints || path),
    segments: normalizeSegments(normalized.segments || []),
    routeSegments: normalizeSegments(normalized.routeSegments || normalized.segments || []),
    liveRenderPath: sanitizeRunPath(normalized.liveRenderPath || []),
    renderPath,
    displayPath: renderPath,
    displayPoints: renderPath,
    distance: distanceMeters,
    distanceMeters,
    duration: durationSeconds,
    durationSeconds,
    avgSpeed,
    maxSpeed: Number(overrides.maxSpeed ?? normalized.maxSpeed ?? 0) || 0,
    pace: calculatePaceSecondsPerKm(durationSeconds, distanceMeters),
    pendingSync: true,
    synced: false,
    pathQuality: normalized.pathQuality || null,
    gpsQualitySummary: normalized.gpsQualitySummary || normalized.pathQuality || null,
    lowConfidenceSegments: normalized.lowConfidenceSegments || [],
    smoothingVersion: normalized.smoothingVersion || "wayper_tracking_v2",
    filterVersion: normalized.filterVersion || "wayper_gps_filter_v2",
    ...clone(overrides.extra || {}),
  };
}

export default {
  ACTIVE_RUN_STATUS,
  ACTIVE_RUN_STORAGE_KEY,
  buildRunDataFromActiveSnapshot,
  calculateActiveRunDurationMs,
  calculateActiveRunDurationSeconds,
  calculatePaceSecondsPerKm,
  createRunId,
  createSnapshotFromTrackingSession,
  createTrackingSessionFromSnapshot,
  normalizeActiveRunSnapshot,
  nowIso,
  toTimestampMs,
};
