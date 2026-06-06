import { createTrackingSession } from "../tracking/trackingPathService.js";
import { buildLiveRenderPath, buildSummaryRenderPath } from "../tracking/trackingRenderPath.js";
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

function pointKey(point = {}) {
  const id = point.id || point.pointId || point.locationId;
  if (id) return `id:${id}`;
  const timestamp = point.timestamp ?? point.time ?? point.t ?? "";
  const latitude = Number(point.latitude ?? point.lat);
  const longitude = Number(point.longitude ?? point.lng ?? point.lon);
  return [
    timestamp,
    Number.isFinite(latitude) ? latitude.toFixed(7) : "",
    Number.isFinite(longitude) ? longitude.toFixed(7) : "",
  ].join(":");
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
  if (raw === "ACTIVE") return ACTIVE_RUN_STATUS.RUNNING;
  if (raw === "COMPLETED") return ACTIVE_RUN_STATUS.FINISHED;
  return Object.values(ACTIVE_RUN_STATUS).includes(raw) ? raw : ACTIVE_RUN_STATUS.RUNNING;
}

function normalizeSegments(segments = []) {
  const sourceSegments = Array.isArray(segments) ? segments : [];
  return normalizeTrackSegments(sourceSegments).map((segment, index) => {
    const source = sourceSegments[index] || {};
    const hasExplicitEnd = source.endedAt != null || source.endReason != null;
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
  let segments = normalizeSegments(state.segments || base.segments || []);
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
  }
  const currentLocation = state.currentPosition || trustedPath[trustedPath.length - 1] || base.currentLocation || null;
  const baseDistance = Number(base.distanceMeters ?? base.distance ?? 0) || 0;
  const measuredDistance = Number(state.stats?.distanceMeters ?? state.distanceMeters ?? 0) ||
    calculatePathDistanceMeters(trustedPath);
  const distance = status === ACTIVE_RUN_STATUS.RUNNING
    ? Math.max(baseDistance, measuredDistance)
    : (measuredDistance || baseDistance);
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
    liveRenderPath: firstNonEmptyPath(state.liveRenderPath, base.liveRenderPath, trustedPath),
    displayPoints: firstNonEmptyPath(state.displayPoints, state.liveRenderPath, base.displayPoints, trustedPath),
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
  const startedAtMs = toTimestampMs(snapshot.startedAtMs ?? snapshot.startedAt, Date.now());
  const runId = snapshot.activeRunId || snapshot.id || createRunId(startedAtMs);
  let segments = normalizeSegments(snapshot.segments || snapshot.routeSegments || []);
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
  }
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
    liveRenderPath,
    displayPoints,
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

export function mergeActiveRunSnapshots(existingSnapshot = null, incomingSnapshot = null, options = {}) {
  const existing = normalizeActiveRunSnapshot(existingSnapshot);
  const incoming = normalizeActiveRunSnapshot(incomingSnapshot);
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (existing.activeRunId !== incoming.activeRunId && options.replaceExisting === true) return incoming;
  if (existing.activeRunId !== incoming.activeRunId) return existing;

  const status = normalizeStatus(incoming.status || existing.status);
  const mergedTrustedPath = mergeRunPaths(existing.trustedPath || existing.path || [], incoming.trustedPath || incoming.path || []);
  let mergedRawPath = mergeRunPaths(existing.rawPath || existing.rawPoints || mergedTrustedPath, incoming.rawPath || incoming.rawPoints || []);
  if (mergedRawPath.length < mergedTrustedPath.length) mergedRawPath = mergeRunPaths(mergedRawPath, mergedTrustedPath);
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

  return normalizeActiveRunSnapshot({
    ...existing,
    ...incoming,
    status,
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
    },
  });
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
  mergeActiveRunSnapshots,
  nowIso,
  toTimestampMs,
};
