import { createTrackingSession } from "../tracking/trackingPathService.js";
import { buildLiveRenderPath, buildSummaryRenderPath } from "../tracking/trackingRenderPath.js";
import { calculatePathDistanceMeters } from "../tracking/trackingMath.js";
import { summarizeGpsQuality } from "./gpsQuality.js";
import { normalizeTrackSegments, sanitizeRunPath } from "./trackSegments.js";

export const ACTIVE_RUN_STORAGE_KEY = "wayper:activeRun:v2";
export const ACTIVE_RUN_SCHEMA_VERSION = 2;

export const ACTIVE_RUN_STATUS = {
  IDLE: "IDLE",
  STARTING: "STARTING",
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  RECOVERING: "RECOVERING",
  STOPPING: "STOPPING",
  FINISHING: "FINISHING",
  FINISHED: "FINISHED",
  ERROR_RECOVERABLE: "ERROR_RECOVERABLE",
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

function pointKey(point = {}) {
  const id = point.id || point.pointId || point.locationId;
  const timestamp = getPointTimestampMs(point);
  const latitude = Number(point.latitude ?? point.lat);
  const longitude = Number(point.longitude ?? point.lng ?? point.lon);
  if (timestamp != null && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return [
      timestamp,
      latitude.toFixed(7),
      longitude.toFixed(7),
    ].join(":");
  }
  if (id) return `id:${id}`;
  return [
    point.timestamp ?? point.time ?? point.t ?? "",
    Number.isFinite(latitude) ? latitude.toFixed(7) : "",
    Number.isFinite(longitude) ? longitude.toFixed(7) : "",
  ].join(":");
}

function toOptionalTimestampMs(value) {
  if (value == null || value === "") return null;
  if (Number.isFinite(Number(value))) return Number(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getPointTimestampMs(point = {}) {
  return toOptionalTimestampMs(point.timestamp ?? point.time ?? point.t ?? point.createdAt ?? null);
}

function latestTimestampFromPath(path = []) {
  return sanitizeRunPath(path).reduce((latest, point) => {
    const timestamp = getPointTimestampMs(point);
    return timestamp != null ? Math.max(latest, timestamp) : latest;
  }, 0);
}

function getLatestLocationAtMs(snapshot = {}, segments = []) {
  return Math.max(
    latestTimestampFromPath(snapshot.trustedPath || snapshot.filteredPoints || snapshot.points || snapshot.path || []),
    latestTimestampFromPath(snapshot.rawPath || snapshot.rawPoints || []),
    latestTimestampFromPath(snapshot.liveRenderPath || snapshot.displayPoints || []),
    latestTimestampFromPath(flattenSegmentsPath(segments, "trustedPath")),
    latestTimestampFromPath(flattenSegmentsPath(segments, "rawPath")),
    toOptionalTimestampMs(snapshot.currentLocation?.timestamp) || 0,
    toOptionalTimestampMs(snapshot.lastValidPoint?.timestamp) || 0,
    toOptionalTimestampMs(snapshot.lastLocationAt) || 0
  ) || null;
}

function getStoredDurationMs(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") return 0;
  const durationMs = Number(snapshot.durationMs ?? snapshot.elapsedMs);
  if (Number.isFinite(durationMs) && durationMs > 0) return durationMs;
  const durationSeconds = Number(snapshot.durationSeconds ?? snapshot.duration);
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) return durationSeconds * 1000;
  return 0;
}

function getCanonicalPausedDurationMs(snapshot = {}) {
  const values = [
    snapshot.pausedDurationMs,
    snapshot.totalPausedMs,
    snapshot.totalPausedTime,
  ]
    .filter((value) => value != null && value !== "")
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return values.length > 0 ? Math.max(...values) : null;
}

function isCanonicalDurationSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const version = Math.max(
    Number(snapshot.version || 0),
    Number(snapshot.schemaVersion || 0),
    Number(snapshot.formatVersion || 0)
  );
  return (
    Number.isFinite(version) &&
    version >= ACTIVE_RUN_SCHEMA_VERSION &&
    toOptionalTimestampMs(snapshot.startedAtMs ?? snapshot.startedAt) != null &&
    getCanonicalPausedDurationMs(snapshot) != null
  );
}

function getExplicitLatestLocationAtMs(snapshot = {}) {
  return Math.max(
    toOptionalTimestampMs(snapshot.currentLocation?.timestamp) || 0,
    toOptionalTimestampMs(snapshot.lastValidPoint?.timestamp) || 0,
    toOptionalTimestampMs(snapshot.lastRawPoint?.timestamp) || 0,
    toOptionalTimestampMs(snapshot.lastPoint?.timestamp) || 0,
    toOptionalTimestampMs(snapshot.lastLocationAt) || 0
  ) || null;
}

function getExplicitLastUpdatedAtMs(snapshot = {}) {
  return toOptionalTimestampMs(
    snapshot.lastUpdatedAtMs ??
    snapshot.lastUpdatedAt ??
    snapshot.updatedAt
  );
}

function getValidatedDurationObservationAtMs(
  snapshot = {},
  startedAtMs = 0,
  pausedMs = 0
) {
  const observedAtMs = getExplicitLastUpdatedAtMs(snapshot);
  if (observedAtMs == null || observedAtMs < startedAtMs) return null;
  const storedDurationMs = getStoredDurationMs(snapshot);
  const observedDurationMs = Math.max(
    0,
    observedAtMs - startedAtMs - pausedMs
  );
  return Math.abs(storedDurationMs - observedDurationMs) <= 1000
    ? observedAtMs
    : null;
}

function getExplicitFinishedAtMs(snapshot = {}) {
  return toOptionalTimestampMs(
    snapshot.finishedAtMs ??
    snapshot.finishedAt ??
    snapshot.endedAt
  );
}

function getExplicitPausedAtMs(snapshot = {}) {
  return toOptionalTimestampMs(
    snapshot.pausedAtMs ??
    snapshot.pausedAt ??
    snapshot.pauseStartedAt
  );
}

function getExplicitPausedDurationMs(snapshot = {}) {
  const pausedMs = getCanonicalPausedDurationMs(snapshot);
  return pausedMs != null && pausedMs > 0 ? pausedMs : null;
}

function dedupeRunPath(path = []) {
  const seen = new Set();
  const output = [];
  for (const point of sanitizeRunPath(path)) {
    const key = pointKey(point);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(point);
  }
  return output;
}

function mergeRunPaths(existingPath = [], incomingPath = []) {
  const output = [];
  const seen = new Set();
  for (const point of [...sanitizeRunPath(existingPath), ...sanitizeRunPath(incomingPath)]) {
    const key = pointKey(point);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(point);
  }
  return output;
}

function firstNonEmptyPath(...paths) {
  for (const path of paths) {
    const clean = dedupeRunPath(path);
    if (clean.length > 0) return clean;
  }
  return [];
}

function flattenSegmentsPath(segments = [], key = "trustedPath") {
  return dedupeRunPath(
    (Array.isArray(segments) ? segments : []).flatMap((segment, index) => {
      const segmentIndex = Number.isFinite(Number(segment?.index ?? segment?.segmentId))
        ? Number(segment.index ?? segment.segmentId)
        : index;
      const path = segment?.[key] || segment?.filteredPoints || segment?.path || [];
      return sanitizeRunPath(path).map((point) => ({
        ...point,
        segmentId: Number.isFinite(Number(point.segmentId)) ? Number(point.segmentId) : segmentIndex,
      }));
    })
  );
}

function countSegmentPoints(segments = [], key = "trustedPath") {
  return (Array.isArray(segments) ? segments : []).reduce((total, segment) => {
    return total + sanitizeRunPath(segment?.[key] || segment?.filteredPoints || segment?.path || []).length;
  }, 0);
}

function withSegmentId(path = [], segmentIndex = 0) {
  return dedupeRunPath(path).map((point) => ({
    ...point,
    segmentId: Number.isFinite(Number(point.segmentId)) ? Number(point.segmentId) : segmentIndex,
  }));
}

function buildSegmentsFromFlatPaths({
  trustedPath = [],
  rawPath = [],
  liveRenderPath = [],
  summaryRenderPath = [],
  startedAtMs = Date.now(),
} = {}) {
  const source = dedupeRunPath(trustedPath.length > 0 ? trustedPath : rawPath.length > 0 ? rawPath : liveRenderPath);
  if (source.length === 0) return [];

  const segmentMap = new Map();
  const ensureSegment = (segmentIndex, firstPoint = null) => {
    if (!segmentMap.has(segmentIndex)) {
      const startedAt = firstPoint?.timestamp ?? startedAtMs;
      segmentMap.set(segmentIndex, {
        id: `segment_${segmentIndex}`,
        index: segmentIndex,
        reason: segmentIndex === 0 ? "active" : "resume",
        startedAt,
        startTimestamp: startedAt,
        endedAt: null,
        endTimestamp: null,
        endReason: null,
        rawPath: [],
        rawPoints: [],
        trustedPath: [],
        filteredPoints: [],
        liveRenderPath: [],
        summaryRenderPath: [],
        displayPoints: [],
      });
    }
    return segmentMap.get(segmentIndex);
  };

  const addToSegment = (point, key) => {
    const segmentIndex = Number.isFinite(Number(point?.segmentId ?? point?.segmentIndex))
      ? Number(point.segmentId ?? point.segmentIndex)
      : 0;
    const segment = ensureSegment(segmentIndex, point);
    const normalized = {
      ...point,
      segmentId: segmentIndex,
    };
    segment[key].push(normalized);
  };

  for (const point of rawPath.length > 0 ? dedupeRunPath(rawPath) : source) addToSegment(point, "rawPath");
  for (const point of trustedPath.length > 0 ? dedupeRunPath(trustedPath) : source) addToSegment(point, "trustedPath");
  for (const point of liveRenderPath.length > 0 ? dedupeRunPath(liveRenderPath) : source) addToSegment(point, "liveRenderPath");
  for (const point of summaryRenderPath.length > 0 ? dedupeRunPath(summaryRenderPath) : source) addToSegment(point, "summaryRenderPath");

  return Array.from(segmentMap.values())
    .sort((a, b) => a.index - b.index)
    .map((segment) => {
      const trusted = withSegmentId(segment.trustedPath, segment.index);
      const raw = withSegmentId(segment.rawPath.length > 0 ? segment.rawPath : trusted, segment.index);
      const live = withSegmentId(segment.liveRenderPath.length > 0 ? segment.liveRenderPath : trusted, segment.index);
      const summary = withSegmentId(segment.summaryRenderPath.length > 0 ? segment.summaryRenderPath : trusted, segment.index);
      return {
        ...segment,
        rawPath: raw,
        rawPoints: raw,
        trustedPath: trusted,
        filteredPoints: trusted,
        liveRenderPath: live,
        summaryRenderPath: summary,
        displayPoints: summary,
      };
    });
}

function mergeSegmentsPreservingGeometry(existingSegments = [], incomingSegments = [], mergedTrustedPath = [], mergedRawPath = []) {
  const existing = normalizeSegments(existingSegments);
  const incoming = normalizeSegments(incomingSegments);
  const existingPoints = countSegmentPoints(existing);
  const incomingPoints = countSegmentPoints(incoming);
  const mergedPoints = dedupeRunPath(mergedTrustedPath).length;

  if (incomingPoints > 0 && incomingPoints >= existingPoints && incomingPoints >= mergedPoints) {
    return incoming;
  }

  if (incoming.length === 0 && existing.length > 0 && existingPoints > 0) {
    return existing;
  }

  const base = existing.length > 0 ? clone(existing) : [];
  if (base.length === 0) {
    return buildSegmentsFromFlatPaths({
      trustedPath: mergedTrustedPath,
      rawPath: mergedRawPath,
    });
  }

  const trustedKeys = new Set(flattenSegmentsPath(base, "trustedPath").map(pointKey));
  const rawKeys = new Set(flattenSegmentsPath(base, "rawPath").map(pointKey));
  let lastOpenIndex = -1;
  for (let index = base.length - 1; index >= 0; index -= 1) {
    if (!base[index]?.endedAt) {
      lastOpenIndex = index;
      break;
    }
  }
  const fallbackIndex = lastOpenIndex >= 0 ? lastOpenIndex : base.length - 1;
  const target = base[fallbackIndex] || base[base.length - 1];
  const targetIndex = Number.isFinite(Number(target?.index)) ? Number(target.index) : fallbackIndex;

  for (const point of dedupeRunPath(mergedRawPath)) {
    const key = pointKey(point);
    if (rawKeys.has(key)) continue;
    rawKeys.add(key);
    const normalized = {
      ...point,
      segmentId: Number.isFinite(Number(point.segmentId)) ? Number(point.segmentId) : targetIndex,
    };
    target.rawPath.push(normalized);
    target.rawPoints = target.rawPath;
  }

  for (const point of dedupeRunPath(mergedTrustedPath)) {
    const key = pointKey(point);
    if (trustedKeys.has(key)) continue;
    trustedKeys.add(key);
    const normalized = {
      ...point,
      segmentId: Number.isFinite(Number(point.segmentId)) ? Number(point.segmentId) : targetIndex,
    };
    target.trustedPath.push(normalized);
    target.filteredPoints = target.trustedPath;
    target.liveRenderPath = target.trustedPath;
    target.displayPoints = target.trustedPath;
    target.summaryRenderPath = target.trustedPath;
  }

  return normalizeSegments(base);
}

function normalizeStatus(status) {
  const raw = String(status || "").toUpperCase();
  if (raw === "IDLE") return ACTIVE_RUN_STATUS.IDLE;
  if (raw === "STARTING") return ACTIVE_RUN_STATUS.STARTING;
  if (raw === "ACTIVE") return ACTIVE_RUN_STATUS.RUNNING;
  if (raw === "RECOVERY" || raw === "RECOVERING") return ACTIVE_RUN_STATUS.RECOVERING;
  if (raw === "STOPPING" || raw === "SAVING") return ACTIVE_RUN_STATUS.STOPPING;
  if (raw === "COMPLETED") return ACTIVE_RUN_STATUS.FINISHED;
  if (raw === "ERROR" || raw === "ERROR_RECOVERABLE") return ACTIVE_RUN_STATUS.ERROR_RECOVERABLE;
  return Object.values(ACTIVE_RUN_STATUS).includes(raw) ? raw : ACTIVE_RUN_STATUS.RUNNING;
}

function isOpenRunningSegmentEnd(segment = {}, status = null, index = 0, all = []) {
  if (status !== ACTIVE_RUN_STATUS.RUNNING) return false;
  if (index !== all.length - 1) return false;
  if (segment.endReason != null) return false;
  const reason = String(segment.reason || "").toLowerCase();
  return !reason || reason === "active" || reason === "resume" || reason === "gps_gap";
}

function hasInvalidRunningSegmentEnd(segments = [], status = null) {
  if (status !== ACTIVE_RUN_STATUS.RUNNING) return false;
  const source = Array.isArray(segments) ? segments : [];
  const last = source[source.length - 1];
  if (!last) return false;
  if (last.endReason != null) return false;
  const reason = String(last.reason || "").toLowerCase();
  const looksOpen = !reason || reason === "active" || reason === "resume" || reason === "gps_gap";
  return looksOpen && (last.endedAt != null || last.endTimestamp != null);
}

function normalizeSegments(segments = [], options = {}) {
  const sourceSegments = Array.isArray(segments) ? segments : [];
  const hasStatus = options.status != null;
  const status = hasStatus ? normalizeStatus(options.status) : null;
  const normalizedSegments = normalizeTrackSegments(sourceSegments);
  return normalizedSegments.map((segment, index) => {
    const source = sourceSegments[index] || {};
    const clearOpenEnd = isOpenRunningSegmentEnd(source, status, index, normalizedSegments);
    const hasExplicitEnd = !clearOpenEnd && (source.endedAt != null || source.endReason != null);
    const segmentIndex = Number.isFinite(Number(segment.index)) ? Number(segment.index) : index;
    const rawPath = withSegmentId(segment.rawPath || segment.rawPoints || [], segmentIndex);
    const trustedPath = withSegmentId(segment.trustedPath || segment.filteredPoints || segment.path || [], segmentIndex);
    const liveRenderPath = withSegmentId(segment.liveRenderPath || segment.displayPoints || trustedPath, segmentIndex);
    const summaryRenderPath = withSegmentId(segment.summaryRenderPath || segment.displayPoints || trustedPath, segmentIndex);
    return {
      ...segment,
      index: segmentIndex,
      rawPath,
      rawPoints: rawPath,
      trustedPath,
      filteredPoints: trustedPath,
      liveRenderPath,
      summaryRenderPath,
      displayPoints: summaryRenderPath,
      endedAt: hasExplicitEnd ? (source.endedAt ?? source.endTimestamp ?? segment.endedAt) : null,
      endTimestamp: hasExplicitEnd ? (source.endTimestamp ?? source.endedAt ?? segment.endTimestamp) : null,
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

function getSegmentStartMs(segment = {}) {
  return toOptionalTimestampMs(segment.startedAt ?? segment.startTimestamp);
}

function getSegmentEndMs(segment = {}) {
  return toOptionalTimestampMs(segment.endedAt ?? segment.endTimestamp);
}

function derivePausedDurationMs(snapshot = {}, segments = []) {
  const explicit = getExplicitPausedDurationMs(snapshot);

  const sorted = normalizeSegments(segments)
    .map((segment) => ({
      start: getSegmentStartMs(segment),
      end: getSegmentEndMs(segment),
    }))
    .filter((segment) => segment.start != null)
    .sort((a, b) => a.start - b.start);

  let pausedMs = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const previousEnd = sorted[index - 1].end;
    const nextStart = sorted[index].start;
    if (previousEnd != null && nextStart != null && nextStart > previousEnd) {
      pausedMs += nextStart - previousEnd;
    }
  }
  return Math.max(explicit || 0, pausedMs);
}

function getPausedAtMs(snapshot = {}, segments = [], nowMs = Date.now()) {
  const explicit = toOptionalTimestampMs(snapshot.pausedAt ?? snapshot.pausedAtMs);
  if (explicit != null) return explicit;
  const ends = normalizeSegments(segments)
    .map(getSegmentEndMs)
    .filter((value) => value != null);
  return ends.length > 0 ? Math.max(...ends) : nowMs;
}

function calculateStartedAtElapsedMs(snapshot = {}, segments = [], options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const status = normalizeStatus(snapshot.status);
  const startedAtMs = toTimestampMs(snapshot.startedAtMs ?? snapshot.startedAt, nowMs);
  const pausedMs = derivePausedDurationMs(snapshot, segments);
  const storedDurationMs = getStoredDurationMs(snapshot);
  const latestLocationAtMs = getLatestLocationAtMs(snapshot, segments);
  const lastUpdatedAtMs = getExplicitLastUpdatedAtMs(snapshot);
  const durationObservedAtMs = getValidatedDurationObservationAtMs(
    snapshot,
    startedAtMs,
    pausedMs
  );
  const hasPauseTimeline =
    status === ACTIVE_RUN_STATUS.PAUSED ||
    pausedMs > 0 ||
    segments.length > 1;

  if (status === ACTIVE_RUN_STATUS.PAUSED) {
    const pausedAtMs = getPausedAtMs(snapshot, segments, null);
    if (pausedAtMs != null) {
      return Math.max(0, pausedAtMs - startedAtMs - pausedMs);
    }
    const lastLocationElapsedMs = latestLocationAtMs
      ? Math.max(0, latestLocationAtMs - startedAtMs - pausedMs)
      : 0;
    return Math.max(storedDurationMs, lastLocationElapsedMs);
  }

  if (status === ACTIVE_RUN_STATUS.FINISHED) {
    const finishedAtMs = toTimestampMs(
      snapshot.finishedAtMs ?? snapshot.finishedAt ?? snapshot.endedAt,
      latestLocationAtMs || nowMs
    );
    const derivedElapsedMs = Math.max(0, finishedAtMs - startedAtMs - pausedMs);
    return hasPauseTimeline ? derivedElapsedMs : Math.max(storedDurationMs, derivedElapsedMs);
  }

  if (
    status === ACTIVE_RUN_STATUS.FINISHING ||
    status === ACTIVE_RUN_STATUS.STOPPING ||
    status === ACTIVE_RUN_STATUS.CANCELLED
  ) {
    const terminalAtMs =
      getExplicitFinishedAtMs(snapshot) ??
      toOptionalTimestampMs(snapshot.stoppingAtMs) ??
      lastUpdatedAtMs;
    if (terminalAtMs == null) return null;
    const derivedElapsedMs = Math.max(0, terminalAtMs - startedAtMs - pausedMs);
    return hasPauseTimeline ? derivedElapsedMs : Math.max(storedDurationMs, derivedElapsedMs);
  }

  if (status === ACTIVE_RUN_STATUS.RUNNING || status === ACTIVE_RUN_STATUS.RECOVERING || status === ACTIVE_RUN_STATUS.ERROR_RECOVERABLE) {
    const runningEndMs = options.useLastLocationAtForRunning && latestLocationAtMs
      ? latestLocationAtMs
      : Math.max(nowMs, latestLocationAtMs || 0, durationObservedAtMs || 0);
    const derivedElapsedMs = Math.max(0, runningEndMs - startedAtMs - pausedMs);
    return hasPauseTimeline ? derivedElapsedMs : Math.max(storedDurationMs, derivedElapsedMs);
  }

  return null;
}

// Canonical v2 snapshots persist their complete timing timeline as scalars.
// Keep this path geometry-blind because the active UI asks for it every second.
function calculateCanonicalActiveRunDurationMs(snapshot = {}, options = {}) {
  if (!isCanonicalDurationSnapshot(snapshot)) return null;

  const nowMs = Number(options.nowMs || Date.now());
  const status = normalizeStatus(snapshot.status);
  const startedAtMs = toOptionalTimestampMs(snapshot.startedAtMs ?? snapshot.startedAt);
  const pausedMs = getCanonicalPausedDurationMs(snapshot);
  const latestLocationAtMs = getExplicitLatestLocationAtMs(snapshot);
  const lastUpdatedAtMs = getExplicitLastUpdatedAtMs(snapshot);
  const durationObservedAtMs = getValidatedDurationObservationAtMs(
    snapshot,
    startedAtMs,
    pausedMs
  );
  const finishedAtMs = getExplicitFinishedAtMs(snapshot);
  const pausedAtMs = getExplicitPausedAtMs(snapshot);
  let endMs = null;

  if (
    status === ACTIVE_RUN_STATUS.PAUSED ||
    (
      (status === ACTIVE_RUN_STATUS.RECOVERING ||
        status === ACTIVE_RUN_STATUS.ERROR_RECOVERABLE) &&
      finishedAtMs == null &&
      pausedAtMs != null
    )
  ) {
    endMs = pausedAtMs;
    if (endMs == null) return null;
  } else if (
    status === ACTIVE_RUN_STATUS.FINISHING ||
    status === ACTIVE_RUN_STATUS.FINISHED ||
    (
      (status === ACTIVE_RUN_STATUS.RECOVERING ||
        status === ACTIVE_RUN_STATUS.ERROR_RECOVERABLE) &&
      finishedAtMs != null
    )
  ) {
    if (finishedAtMs == null) return null;
    endMs = finishedAtMs;
  } else if (
    status === ACTIVE_RUN_STATUS.STOPPING ||
    status === ACTIVE_RUN_STATUS.CANCELLED
  ) {
    endMs =
      finishedAtMs ??
      toOptionalTimestampMs(snapshot.stoppingAtMs) ??
      lastUpdatedAtMs;
    if (endMs == null) return null;
  } else if (
    status === ACTIVE_RUN_STATUS.RUNNING ||
    status === ACTIVE_RUN_STATUS.RECOVERING ||
    status === ACTIVE_RUN_STATUS.ERROR_RECOVERABLE
  ) {
    if (options.useLastLocationAtForRunning) {
      if (latestLocationAtMs == null) return null;
      endMs = latestLocationAtMs;
    } else {
      endMs = Math.max(nowMs, latestLocationAtMs || 0, durationObservedAtMs || 0);
    }
  } else {
    return null;
  }

  const derivedDurationMs = Math.max(0, endMs - startedAtMs - pausedMs);
  return derivedDurationMs;
}

export function calculateActiveRunDurationMs(snapshot = {}, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const canonicalDurationMs = calculateCanonicalActiveRunDurationMs(snapshot, {
    ...options,
    nowMs,
  });
  if (canonicalDurationMs != null) return canonicalDurationMs;

  const status = normalizeStatus(snapshot.status);
  const segments = normalizeSegments(snapshot.segments || snapshot.routeSegments || [], { status });
  const startedAtElapsed = calculateStartedAtElapsedMs(snapshot, segments, { ...options, nowMs });
  if (startedAtElapsed != null) return startedAtElapsed;

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
  let segments = normalizeSegments(state.segments || base.segments || [], { status });
  let trustedPath = dedupeRunPath(state.trustedPath || state.filteredPoints || base.points || base.trustedPath || base.path || []);
  if (trustedPath.length === 0 && segments.length > 0) trustedPath = flattenSegmentsPath(segments, "trustedPath");
  let rawPath = dedupeRunPath(state.rawPath || state.rawPoints || base.rawPoints || base.rawPath || trustedPath);
  if (rawPath.length === 0 && segments.length > 0) rawPath = flattenSegmentsPath(segments, "rawPath");
  if (rawPath.length < trustedPath.length) rawPath = mergeRunPaths(rawPath, trustedPath);
  if (segments.length === 0 && (trustedPath.length > 0 || rawPath.length > 0)) {
    segments = buildSegmentsFromFlatPaths({
      trustedPath,
      rawPath,
      liveRenderPath: state.liveRenderPath || base.liveRenderPath || trustedPath,
      summaryRenderPath: base.summaryRenderPath || base.renderPath || base.displayPoints || trustedPath,
      startedAtMs: base.startedAtMs || nowMs,
    });
    segments = normalizeSegments(segments, { status });
  }
  const currentLocation = state.currentPosition || trustedPath[trustedPath.length - 1] || base.currentLocation || null;
  const lastRawPoint = rawPath[rawPath.length - 1] || currentLocation;
  const baseDistance = Number(base.distanceMeters ?? base.distance ?? 0) || 0;
  const measuredDistance = Number(state.stats?.distanceMeters ?? state.distanceMeters ?? 0) ||
    calculatePathDistanceMeters(trustedPath);
  const distance = status === ACTIVE_RUN_STATUS.RUNNING
    ? Math.max(baseDistance, measuredDistance)
    : (measuredDistance || baseDistance);
  const pausedDurationMs = derivePausedDurationMs({ ...base, status }, segments);
  const durationSeconds = calculateActiveRunDurationSeconds(
    {
      ...base,
      status,
      segments,
      startedAtMs: base.startedAtMs,
      finishedAtMs: options.finishedAtMs,
      lastUpdatedAtMs: nowMs,
      pausedDurationMs,
      totalPausedMs: pausedDurationMs,
      totalPausedTime: pausedDurationMs,
      currentLocation,
      lastValidPoint: currentLocation,
      lastRawPoint,
    },
    { nowMs }
  );
  const pace = calculatePaceSecondsPerKm(durationSeconds, distance);
  const gpsQualitySummary = state.gpsQualitySummary || state.pathQuality || summarizeGpsQuality({
    rawPoints: rawPath,
    filteredPoints: trustedPath,
    segments,
  });
  const pausedAtMs = status === ACTIVE_RUN_STATUS.PAUSED
    ? getPausedAtMs(base, segments, null) ?? nowMs
    : (
        status === ACTIVE_RUN_STATUS.RECOVERING ||
        status === ACTIVE_RUN_STATUS.ERROR_RECOVERABLE
      ) && getExplicitFinishedAtMs(base) == null
        ? getExplicitPausedAtMs(base)
        : null;
  const finishedAtMs = options.finishedAtMs || base.finishedAtMs || null;
  const finishedAt = options.finishedAt || base.finishedAt || null;

  return {
    version: ACTIVE_RUN_SCHEMA_VERSION,
    schemaVersion: ACTIVE_RUN_SCHEMA_VERSION,
    formatVersion: ACTIVE_RUN_SCHEMA_VERSION,
    activeRunId: runId,
    runId,
    id: runId,
    userId: base.userId || "offline",
    mode: base.mode || "free",
    startedAtMs: toTimestampMs(base.startedAtMs ?? base.startedAt, nowMs),
    startedAt: base.startedAt || nowIso(toTimestampMs(base.startedAtMs ?? base.startedAt, nowMs)),
    finishedAtMs,
    finishedAt,
    endedAt: finishedAt,
    lastUpdatedAtMs: nowMs,
    lastUpdatedAt: nowIso(nowMs),
    updatedAt: nowIso(nowMs),
    status,
    points: trustedPath,
    path: trustedPath,
    trustedPath,
    filteredPoints: trustedPath,
    rawPath,
    rawPoints: rawPath,
    segments,
    routeSegments: segments,
    liveRenderPath: firstNonEmptyPath(state.liveRenderPath, base.liveRenderPath, trustedPath),
    displayPoints: firstNonEmptyPath(state.displayPoints, state.liveRenderPath, base.displayPoints, trustedPath),
    currentLocation,
    lastPoint: lastRawPoint,
    lastRawPoint,
    lastValidPoint: currentLocation,
    distance,
    distanceMeters: distance,
    duration: durationSeconds,
    durationSeconds,
    durationMs: durationSeconds * 1000,
    pausedDurationMs,
    totalPausedMs: pausedDurationMs,
    totalPausedTime: pausedDurationMs,
    pausedAtMs,
    pausedAt: pausedAtMs ? nowIso(pausedAtMs) : null,
    pauseStartedAt: pausedAtMs ? nowIso(pausedAtMs) : null,
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
    lastError: base.lastError || null,
    recoveryPending: Boolean(
      base.recoveryPending ||
      status === ACTIVE_RUN_STATUS.RECOVERING ||
      status === ACTIVE_RUN_STATUS.ERROR_RECOVERABLE
    ),
    meta: {
      ...(base.meta || {}),
      recovered: Boolean(base.meta?.recovered || options.recovered),
    },
  };
}

export function normalizeActiveRunSnapshot(snapshot = {}, options = {}) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const nowMs = Number(options.nowMs || Date.now());
  const status = normalizeStatus(snapshot.status);
  const startedAtMs = toTimestampMs(snapshot.startedAtMs ?? snapshot.startedAt, nowMs);
  const runId = snapshot.activeRunId || snapshot.id || createRunId(startedAtMs);
  const sourceSegments = snapshot.segments || snapshot.routeSegments || [];
  const activeSegmentEndCleared = hasInvalidRunningSegmentEnd(sourceSegments, status);
  let segments = normalizeSegments(sourceSegments, { status });
  let trustedPath = dedupeRunPath(snapshot.points || snapshot.trustedPath || snapshot.filteredPoints || snapshot.path || []);
  if (trustedPath.length === 0 && segments.length > 0) trustedPath = flattenSegmentsPath(segments, "trustedPath");
  let rawPath = dedupeRunPath(snapshot.rawPoints || snapshot.rawPath || trustedPath);
  if (rawPath.length === 0 && segments.length > 0) rawPath = flattenSegmentsPath(segments, "rawPath");
  if (rawPath.length < trustedPath.length) rawPath = mergeRunPaths(rawPath, trustedPath);
  const liveRenderPath = firstNonEmptyPath(
    snapshot.liveRenderPath,
    snapshot.displayPoints,
    flattenSegmentsPath(segments, "liveRenderPath"),
    trustedPath
  );
  const displayPoints = firstNonEmptyPath(snapshot.displayPoints, liveRenderPath, trustedPath);
  if (segments.length === 0 && (trustedPath.length > 0 || rawPath.length > 0 || liveRenderPath.length > 0)) {
    segments = buildSegmentsFromFlatPaths({
      trustedPath,
      rawPath,
      liveRenderPath,
      summaryRenderPath: snapshot.summaryRenderPath || snapshot.renderPath || snapshot.displayPath || displayPoints,
      startedAtMs,
    });
    segments = normalizeSegments(segments, { status });
  }
  const finishedAtMs = snapshot.finishedAtMs || snapshot.finishedAt || snapshot.endedAt
    ? toTimestampMs(snapshot.finishedAtMs ?? snapshot.finishedAt ?? snapshot.endedAt, null)
    : null;
  const distance = Number(snapshot.distanceMeters ?? snapshot.distance ?? calculatePathDistanceMeters(trustedPath)) || 0;
  const pausedDurationMs = derivePausedDurationMs(snapshot, segments);
  const durationSeconds = calculateActiveRunDurationSeconds({
    ...snapshot,
    status,
    segments,
    startedAtMs,
    finishedAtMs,
    pausedDurationMs,
    totalPausedMs: pausedDurationMs,
    totalPausedTime: pausedDurationMs,
  }, { nowMs });
  const pace = calculatePaceSecondsPerKm(durationSeconds, distance);
  const lastUpdatedAtMs = toTimestampMs(snapshot.lastUpdatedAtMs ?? snapshot.lastUpdatedAt, nowMs);
  const pausedAtMs = status === ACTIVE_RUN_STATUS.PAUSED
    ? getPausedAtMs(snapshot, segments, null) ??
      (startedAtMs + durationSeconds * 1000 + pausedDurationMs)
    : (
        status === ACTIVE_RUN_STATUS.RECOVERING ||
        status === ACTIVE_RUN_STATUS.ERROR_RECOVERABLE
      ) && getExplicitFinishedAtMs(snapshot) == null
        ? getExplicitPausedAtMs(snapshot)
        : null;
  const currentLocation = snapshot.currentLocation || snapshot.lastValidPoint || trustedPath[trustedPath.length - 1] || null;
  const lastRawPoint = snapshot.lastRawPoint || snapshot.lastPoint || rawPath[rawPath.length - 1] || currentLocation;

  return {
    ...snapshot,
    version: Number(snapshot.version || snapshot.schemaVersion || ACTIVE_RUN_SCHEMA_VERSION),
    schemaVersion: Number(snapshot.schemaVersion || snapshot.version || ACTIVE_RUN_SCHEMA_VERSION),
    formatVersion: Number(snapshot.formatVersion || snapshot.schemaVersion || snapshot.version || ACTIVE_RUN_SCHEMA_VERSION),
    activeRunId: runId,
    runId,
    id: runId,
    userId: snapshot.userId || "offline",
    mode: snapshot.mode || "free",
    startedAtMs,
    startedAt: snapshot.startedAt || nowIso(startedAtMs),
    finishedAtMs,
    finishedAt: snapshot.finishedAt || (finishedAtMs ? nowIso(finishedAtMs) : null),
    endedAt: snapshot.endedAt || snapshot.finishedAt || (finishedAtMs ? nowIso(finishedAtMs) : null),
    lastUpdatedAtMs,
    lastUpdatedAt: snapshot.lastUpdatedAt || nowIso(lastUpdatedAtMs),
    updatedAt: snapshot.updatedAt || snapshot.lastUpdatedAt || nowIso(lastUpdatedAtMs),
    status,
    points: trustedPath,
    path: trustedPath,
    trustedPath,
    filteredPoints: sanitizeRunPath(snapshot.filteredPoints || trustedPath),
    rawPath,
    rawPoints: rawPath,
    segments,
    routeSegments: segments,
    liveRenderPath,
    displayPoints,
    currentLocation,
    lastPoint: lastRawPoint,
    lastRawPoint,
    lastValidPoint: currentLocation,
    distance,
    distanceMeters: distance,
    duration: durationSeconds,
    durationSeconds,
    durationMs: durationSeconds * 1000,
    pausedDurationMs,
    totalPausedMs: pausedDurationMs,
    totalPausedTime: pausedDurationMs,
    pausedAtMs,
    pausedAt: pausedAtMs ? nowIso(pausedAtMs) : null,
    pauseStartedAt: pausedAtMs ? nowIso(pausedAtMs) : null,
    pace,
    paceSecondsPerKm: pace,
    pendingSync: snapshot.pendingSync !== false,
    synced: false,
    source: snapshot.source || "foreground",
    notificationBody: snapshot.notificationBody || DEFAULT_NOTIFICATION_BODY,
    lastError: snapshot.lastError || null,
    recoveryPending: Boolean(
      snapshot.recoveryPending ||
      status === ACTIVE_RUN_STATUS.RECOVERING ||
      status === ACTIVE_RUN_STATUS.ERROR_RECOVERABLE
    ),
    meta: {
      ...(snapshot.meta || {}),
      activeSegmentEndCleared: Boolean(snapshot.meta?.activeSegmentEndCleared || activeSegmentEndCleared),
      activeSegmentNormalized: Boolean(snapshot.meta?.activeSegmentNormalized || activeSegmentEndCleared),
    },
  };
}

function hasCanonicalResumeProof(existing = {}, incoming = {}) {
  if (
    normalizeStatus(existing.status) !== ACTIVE_RUN_STATUS.PAUSED ||
    normalizeStatus(incoming.status) !== ACTIVE_RUN_STATUS.RUNNING
  ) {
    return false;
  }
  const pausedAtMs = getExplicitPausedAtMs(existing);
  if (pausedAtMs == null) return false;

  const existingPausedMs = derivePausedDurationMs(
    existing,
    existing.segments || []
  );
  const incomingPausedMs = derivePausedDurationMs(
    incoming,
    incoming.segments || []
  );
  const resumedSegmentStarts = normalizeSegments(incoming.segments || [])
    .filter((segment) => String(segment.reason || "")
      .toLowerCase()
      .includes("resume"))
    .map(getSegmentStartMs)
    .filter((value) => value != null && value >= pausedAtMs);
  const inferredResumeAtMs = incomingPausedMs > existingPausedMs
    ? pausedAtMs + (incomingPausedMs - existingPausedMs)
    : null;
  const resumedAtMs = resumedSegmentStarts.length > 0
    ? Math.min(...resumedSegmentStarts)
    : inferredResumeAtMs;
  const incomingUpdatedAtMs = getExplicitLastUpdatedAtMs(incoming);
  if (
    resumedAtMs == null ||
    incomingUpdatedAtMs == null ||
    incomingUpdatedAtMs < resumedAtMs
  ) {
    return false;
  }

  const requiredPausedMs = existingPausedMs + Math.max(
    0,
    resumedAtMs - pausedAtMs
  );
  return incomingPausedMs >= requiredPausedMs;
}

export function mergeActiveRunSnapshots(existingSnapshot = null, incomingSnapshot = null, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const previousStoredElapsedMs = getStoredDurationMs(existingSnapshot);
  const incomingStoredElapsedMs = getStoredDurationMs(incomingSnapshot);
  const existing = normalizeActiveRunSnapshot(existingSnapshot, { nowMs });
  const incoming = normalizeActiveRunSnapshot(incomingSnapshot, { nowMs });
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (existing.activeRunId !== incoming.activeRunId && options.replaceExisting === true) return incoming;
  if (existing.activeRunId !== incoming.activeRunId) return existing;

  const status = normalizeStatus(incoming.status || existing.status);
  const nextPausedDurationMs = Math.max(
    derivePausedDurationMs(existing, existing.segments),
    derivePausedDurationMs(incoming, incoming.segments)
  );
  const trustedPathMergeInput = [...(existing.trustedPath || existing.path || []), ...(incoming.trustedPath || incoming.path || [])];
  const rawPathMergeInput = [...(existing.rawPath || existing.rawPoints || []), ...(incoming.rawPath || incoming.rawPoints || [])];
  const mergedTrustedPath = mergeRunPaths(existing.trustedPath || existing.path || [], incoming.trustedPath || incoming.path || []);
  let mergedRawPath = mergeRunPaths(existing.rawPath || existing.rawPoints || mergedTrustedPath, incoming.rawPath || incoming.rawPoints || []);
  if (mergedRawPath.length < mergedTrustedPath.length) mergedRawPath = mergeRunPaths(mergedRawPath, mergedTrustedPath);
  const dedupedTrustedPointsCount = Math.max(0, sanitizeRunPath(trustedPathMergeInput).length - mergedTrustedPath.length);
  const dedupedRawPointsCount = Math.max(0, sanitizeRunPath(rawPathMergeInput).length - mergedRawPath.length);
  const incomingHasEmptyGeometry =
    countSegmentPoints(incoming.segments) === 0 &&
    sanitizeRunPath(incoming.trustedPath || incoming.path || []).length === 0 &&
    countSegmentPoints(existing.segments) > 0;
  const segments = incomingHasEmptyGeometry
    ? existing.segments
    : mergeSegmentsPreservingGeometry(existing.segments, incoming.segments, mergedTrustedPath, mergedRawPath);
  const previousDistance = Number(existing.distanceMeters ?? existing.distance ?? 0) || 0;
  const incomingDistance = Number(incoming.distanceMeters ?? incoming.distance ?? 0) || 0;
  const mergedDistance = calculatePathDistanceMeters(mergedTrustedPath);
  const nextDistance = status === ACTIVE_RUN_STATUS.RUNNING
    ? Math.max(previousDistance, incomingDistance, mergedDistance)
    : Math.max(incomingDistance, mergedDistance);
  const liveRenderPath = firstNonEmptyPath(
    (incoming.liveRenderPath?.length || 0) >= (existing.liveRenderPath?.length || 0)
      ? incoming.liveRenderPath
      : existing.liveRenderPath,
    existing.liveRenderPath,
    incoming.liveRenderPath,
    mergedTrustedPath
  );
  const displayPoints = firstNonEmptyPath(
    (incoming.displayPoints?.length || 0) >= (existing.displayPoints?.length || 0)
      ? incoming.displayPoints
      : existing.displayPoints,
    existing.displayPoints,
    incoming.displayPoints,
    liveRenderPath
  );
  const existingUpdatedAtMs = toTimestampMs(existing.lastUpdatedAtMs ?? existing.lastUpdatedAt ?? existing.updatedAt, 0);
  const incomingUpdatedAtMs = toTimestampMs(incoming.lastUpdatedAtMs ?? incoming.lastUpdatedAt ?? incoming.updatedAt, 0);
  const latestPointAtMs = Math.max(
    getLatestLocationAtMs(existing, existing.segments) || 0,
    getLatestLocationAtMs(incoming, incoming.segments) || 0,
    latestTimestampFromPath(mergedTrustedPath)
  );
  const nextUpdatedAtMs = Math.max(existingUpdatedAtMs, incomingUpdatedAtMs, latestPointAtMs, nowMs);
  const existingPointsCount = sanitizeRunPath(existing.trustedPath || existing.path || []).length;
  const incomingPointsCount = sanitizeRunPath(incoming.trustedPath || incoming.path || []).length;
  const staleSnapshotIgnored = Boolean(
    isLiveStatus(status) &&
    existingUpdatedAtMs > 0 &&
    incomingUpdatedAtMs > 0 &&
    incomingUpdatedAtMs < existingUpdatedAtMs &&
    incomingPointsCount <= existingPointsCount &&
      incomingDistance <= previousDistance
  );
  const resumeWithoutPauseAccumulationBlocked = Boolean(
    normalizeStatus(existing.status) === ACTIVE_RUN_STATUS.PAUSED &&
    status === ACTIVE_RUN_STATUS.RUNNING &&
    !hasCanonicalResumeProof(existing, incoming)
  );
  const resolvedStatus = resumeWithoutPauseAccumulationBlocked
    ? ACTIVE_RUN_STATUS.PAUSED
    : status;
  const previousElapsedMs = calculateActiveRunDurationMs(existing, { nowMs });
  const incomingElapsedMs = calculateActiveRunDurationMs(incoming, { nowMs });
  const elapsedPreserved = Boolean(
    isLiveStatus(status) &&
    (
      (incomingElapsedMs > 0 && previousElapsedMs > 0 && incomingElapsedMs < previousElapsedMs) ||
      (incomingStoredElapsedMs > 0 && previousStoredElapsedMs > 0 && incomingStoredElapsedMs < previousStoredElapsedMs)
    )
  );
  const scalarBase = staleSnapshotIgnored || resumeWithoutPauseAccumulationBlocked
    ? { ...incoming, ...existing }
    : { ...existing, ...incoming };

  return normalizeActiveRunSnapshot({
    ...scalarBase,
    status: resolvedStatus,
    pausedDurationMs: nextPausedDurationMs,
    totalPausedMs: nextPausedDurationMs,
    totalPausedTime: nextPausedDurationMs,
    lastUpdatedAtMs: nextUpdatedAtMs,
    lastUpdatedAt: nowIso(nextUpdatedAtMs),
    updatedAt: nowIso(nextUpdatedAtMs),
    points: mergedTrustedPath,
    path: mergedTrustedPath,
    trustedPath: mergedTrustedPath,
    filteredPoints: mergedTrustedPath,
    rawPath: mergedRawPath,
    rawPoints: mergedRawPath,
    segments,
    routeSegments: segments,
    liveRenderPath: liveRenderPath.length > 0 ? liveRenderPath : buildLiveRenderPath(mergedTrustedPath),
    displayPoints: displayPoints.length > 0 ? displayPoints : liveRenderPath,
    currentLocation: incoming.currentLocation || mergedTrustedPath[mergedTrustedPath.length - 1] || existing.currentLocation || null,
    distance: nextDistance,
    distanceMeters: nextDistance,
    meta: {
      ...(existing.meta || {}),
      ...(incoming.meta || {}),
      ignoredEmptyGeometryOverwrite: Boolean(
        incomingHasEmptyGeometry ||
        existing.meta?.ignoredEmptyGeometryOverwrite ||
        incoming.meta?.ignoredEmptyGeometryOverwrite
      ),
      distancePreserved: Boolean(
        existing.meta?.distancePreserved ||
        incoming.meta?.distancePreserved ||
        (
          status === ACTIVE_RUN_STATUS.RUNNING &&
          (incomingDistance < previousDistance || mergedDistance < previousDistance)
        )
      ),
      elapsedPreserved,
      staleSnapshotIgnored,
      staleSnapshotBlocked: staleSnapshotIgnored,
      resumeWithoutPauseAccumulationBlocked,
      dedupedPoints: Boolean(
        existing.meta?.dedupedPoints ||
        incoming.meta?.dedupedPoints ||
        dedupedTrustedPointsCount > 0 ||
        dedupedRawPointsCount > 0
      ),
      dedupedTrustedPointsCount: Math.max(
        Number(existing.meta?.dedupedTrustedPointsCount || 0),
        Number(incoming.meta?.dedupedTrustedPointsCount || 0),
        dedupedTrustedPointsCount
      ),
      dedupedRawPointsCount: Math.max(
        Number(existing.meta?.dedupedRawPointsCount || 0),
        Number(incoming.meta?.dedupedRawPointsCount || 0),
        dedupedRawPointsCount
      ),
    },
  }, { nowMs });
}

function isLiveStatus(status) {
  return [
    ACTIVE_RUN_STATUS.RUNNING,
    ACTIVE_RUN_STATUS.PAUSED,
    ACTIVE_RUN_STATUS.RECOVERING,
    ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
  ].includes(normalizeStatus(status));
}

export function reconcileRunState({
  currentState = null,
  incomingState = null,
  routeChunks = null,
  gpsPoints = null,
  now = Date.now(),
  reason = "runtime",
} = {}) {
  const logs = [];
  const gpsTrustedPath = sanitizeRunPath(gpsPoints || []);
  const chunkTrustedPath = sanitizeRunPath(routeChunks?.trustedPath || routeChunks?.points || []);
  const chunkRawPath = sanitizeRunPath(routeChunks?.rawPath || routeChunks?.rawPoints || chunkTrustedPath);
  const externalTrustedPath = mergeRunPaths(chunkTrustedPath, gpsTrustedPath);
  const externalRawPath = mergeRunPaths(chunkRawPath, gpsTrustedPath);
  const incomingTrustedPath = incomingState
    ? mergeRunPaths(
        firstNonEmptyPath(incomingState.trustedPath, incomingState.points, incomingState.path),
        externalTrustedPath
      )
    : externalTrustedPath;
  const incomingRawPath = incomingState
    ? mergeRunPaths(
        firstNonEmptyPath(incomingState.rawPath, incomingState.rawPoints, incomingTrustedPath),
        externalRawPath
      )
    : externalRawPath;
  const incomingWithExternalGeometry = incomingState
    ? {
        ...incomingState,
        trustedPath: incomingTrustedPath,
        points: incomingTrustedPath,
        path: incomingTrustedPath,
        rawPath: incomingRawPath,
        rawPoints: incomingRawPath,
        routeChunksIndex: incomingState.routeChunksIndex || routeChunks?.routeChunksIndex || routeChunks || null,
      }
    : incomingState;

  const nowMs = Number(now) || Date.now();
  const current = normalizeActiveRunSnapshot(currentState, { nowMs });
  const incoming = normalizeActiveRunSnapshot(incomingWithExternalGeometry, { nowMs });
  const state = current?.activeRunId && incoming?.activeRunId
    ? mergeActiveRunSnapshots(currentState, incomingWithExternalGeometry, { nowMs, reason })
    : (incoming || current);

  if (!state) return { state: null, logs };

  if (state.meta?.activeSegmentEndCleared) {
    logs.push({ event: "ACTIVE_SEGMENT_STALE_END_CLEARED", reason });
    logs.push({ event: "ACTIVE_SEGMENT_NORMALIZED", reason });
  }
  if (state.meta?.staleSnapshotIgnored) {
    logs.push({ event: "ACTIVE_RUN_STALE_SNAPSHOT_BLOCKED", reason });
    logs.push({ event: "RECOVERY_STALE_STATE_IGNORED", reason });
  }
  if (state.meta?.resumeWithoutPauseAccumulationBlocked) {
    logs.push({ event: "ACTIVE_RUN_UNPROVEN_RESUME_BLOCKED", reason });
  }
  if (state.meta?.elapsedPreserved) {
    logs.push({ event: "ACTIVE_RUN_ELAPSED_REGRESSION_BLOCKED", reason });
  }
  if (state.meta?.distancePreserved) {
    logs.push({ event: "ACTIVE_RUN_DISTANCE_REGRESSION_BLOCKED", reason });
  }
  if (state.meta?.dedupedPoints) {
    logs.push({
      event: "RUN_POINTS_DEDUPED",
      reason,
      dedupedTrustedPointsCount: Number(state.meta?.dedupedTrustedPointsCount || 0),
      dedupedRawPointsCount: Number(state.meta?.dedupedRawPointsCount || 0),
    });
  }
  if (logs.length > 0) {
    logs.push({ event: "RECOVERY_STATE_RECALCULATED", reason });
  }

  return {
    state,
    logs,
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
  ACTIVE_RUN_SCHEMA_VERSION,
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
  mergeActiveRunSnapshots,
  nowIso,
  toTimestampMs,
};
