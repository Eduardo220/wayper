import { getTrackingPreset, TRACKING_FILTER_VERSION, TRACKING_SMOOTHING_VERSION } from "./trackingConfig.js";
import { TRACKING_FILTER_ACTION, TRACKING_REJECT_REASON } from "./trackingTypes.js";
import { normalizeLocationPoint, shouldAcceptPoint } from "./trackingFilters.js";
import {
  calculateBearing,
  calculateDistanceMeters,
} from "./trackingMath.js";
import { smoothCurrentPosition } from "./trackingSmoothing.js";
import {
  buildLiveRenderPath,
  buildSummaryRenderPath,
  getBestRenderPathForRun,
  getRenderableSegmentsForRun,
} from "./trackingRenderPath.js";
import { buildTrackingDebugSnapshot, logTrackingDebug } from "./trackingDebug.js";

const reasonCounterMap = {
  [TRACKING_REJECT_REASON.bad_accuracy]: "rejectedByAccuracy",
  [TRACKING_REJECT_REASON.too_fast]: "rejectedBySpeed",
  [TRACKING_REJECT_REASON.gps_jump]: "rejectedBySpeed",
  [TRACKING_REJECT_REASON.gps_gap]: "gpsGapCount",
  [TRACKING_REJECT_REASON.too_much_acceleration]: "rejectedBySpeed",
  [TRACKING_REJECT_REASON.too_close]: "rejectedByDistance",
  [TRACKING_REJECT_REASON.invalid_timestamp]: "rejectedByTimestamp",
  [TRACKING_REJECT_REASON.future_timestamp]: "rejectedByTimestamp",
  [TRACKING_REJECT_REASON.stale_point]: "rejectedByTimestamp",
  [TRACKING_REJECT_REASON.out_of_order]: "rejectedByTimestamp",
  [TRACKING_REJECT_REASON.short_zigzag]: "rejectedByZigzag",
  [TRACKING_REJECT_REASON.duplicate_point]: "rejectedByDuplicate",
  [TRACKING_REJECT_REASON.warmup_bad_point]: "rejectedByWarmup",
};

function emptyQuality() {
  return {
    rawPoints: 0,
    totalRawPoints: 0,
    acceptedPoints: 0,
    rejectedPoints: 0,
    rejectedByAccuracy: 0,
    rejectedBySpeed: 0,
    rejectedByDistance: 0,
    rejectedByZigzag: 0,
    rejectedByDuplicate: 0,
    rejectedByTimestamp: 0,
    rejectedByWarmup: 0,
    suspiciousPoints: 0,
    lastRejectReason: null,
    lastAccuracyMeters: null,
    lastCalculatedSpeedMps: null,
    lastCheckpointAt: null,
    averageAccuracy: null,
    maxAccuracy: null,
    poorAccuracyRatio: 0,
    gpsGapCount: 0,
    lowConfidenceSegments: [],
    smoothingVersion: TRACKING_SMOOTHING_VERSION,
    filterVersion: TRACKING_FILTER_VERSION,
  };
}

function emptyWorkCounters() {
  return {
    fullPathRebuilds: 0,
    liveRenderBuilds: 0,
    hotPathSnapshots: 0,
    incrementalRawAppends: 0,
    incrementalTrustedAppends: 0,
    incrementalTrustedRemovals: 0,
  };
}

function clonePoint(point) {
  return point ? { ...point } : point;
}

function clonePath(path = []) {
  return (Array.isArray(path) ? path : []).map(clonePoint).filter(Boolean);
}

function cloneSegment(segment = {}) {
  const rawPath = clonePath(segment.rawPoints || segment.rawPath);
  const trustedPath = clonePath(segment.filteredPoints || segment.trustedPath);
  const liveRenderPath = clonePath(segment.liveRenderPath);
  const summaryRenderPath = clonePath(segment.displayPoints || segment.summaryRenderPath);
  return {
    id: String(segment.id || ""),
    index: Number.isFinite(Number(segment.index)) ? Number(segment.index) : 0,
    startedAt: Number(segment.startedAt || Date.now()),
    endedAt: segment.endedAt ?? null,
    startTimestamp: segment.startTimestamp ?? segment.startedAt ?? null,
    endTimestamp: segment.endTimestamp ?? segment.endedAt ?? null,
    reason: segment.reason || "active",
    endReason: segment.endReason || null,
    rawPath,
    rawPoints: rawPath,
    trustedPath,
    filteredPoints: trustedPath,
    liveRenderPath,
    summaryRenderPath,
    displayPoints: summaryRenderPath,
  };
}

function createSegment(index = 0, startedAt = Date.now(), reason = "active") {
  const rawPath = [];
  const trustedPath = [];
  const liveRenderPath = [];
  const summaryRenderPath = [];
  return {
    id: `segment_${index}_${startedAt}`,
    index,
    startedAt,
    endedAt: null,
    startTimestamp: startedAt,
    endTimestamp: null,
    reason,
    endReason: null,
    rawPath,
    rawPoints: rawPath,
    trustedPath,
    filteredPoints: trustedPath,
    liveRenderPath,
    summaryRenderPath,
    displayPoints: summaryRenderPath,
  };
}

function normalizePointSegment(point, segmentIndex) {
  return {
    ...point,
    segmentId: Number.isFinite(Number(point?.segmentId)) ? Number(point.segmentId) : segmentIndex,
  };
}

function flattenSegmentPath(segments = [], key = "trustedPath") {
  const output = [];
  (Array.isArray(segments) ? segments : []).forEach((segment, index) => {
    const segmentIndex = Number.isFinite(Number(segment?.index)) ? Number(segment.index) : index;
    for (const point of Array.isArray(segment?.[key]) ? segment[key] : []) {
      output.push(normalizePointSegment(point, segmentIndex));
    }
  });
  return output;
}

function getRenderableSegmentPathReferences(segments = [], key = "liveRenderPath") {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => (Array.isArray(segment?.[key]) ? segment[key] : []))
    .filter((path) => path.length >= 2);
}

function getSnapshotStatus(snapshot = {}) {
  const rawStatus = String(snapshot.status || "").toLowerCase();
  if (rawStatus === "running" || rawStatus === "active") return "active";
  if (rawStatus === "paused") return "paused";
  if (rawStatus === "finished" || rawStatus === "completed") return "finished";
  if (rawStatus === "cancelled" || rawStatus === "canceled") return "cancelled";
  return "active";
}

function getSnapshotSegments(snapshot = {}) {
  const sourceSegments = Array.isArray(snapshot.segments)
    ? snapshot.segments
    : Array.isArray(snapshot.routeSegments)
      ? snapshot.routeSegments
      : [];

  if (sourceSegments.length > 0) {
    return sourceSegments.map((segment, index) => {
      const segmentIndex = Number.isFinite(Number(segment?.index ?? segment?.segmentId))
        ? Number(segment.index ?? segment.segmentId)
        : index;
      const cloned = cloneSegment({
        ...segment,
        id: segment?.id || `segment_${index}`,
        index: segmentIndex,
        rawPath: segment?.rawPath || segment?.rawPoints || [],
        trustedPath: segment?.trustedPath || segment?.filteredPoints || segment?.path || [],
        liveRenderPath: segment?.liveRenderPath || segment?.displayPoints || segment?.summaryRenderPath || [],
        summaryRenderPath: segment?.summaryRenderPath || segment?.displayPoints || segment?.renderPath || [],
      });
      cloned.rawPath = cloned.rawPath.map((point) => normalizePointSegment(point, segmentIndex));
      cloned.trustedPath = cloned.trustedPath.map((point) => normalizePointSegment(point, segmentIndex));
      cloned.liveRenderPath = cloned.liveRenderPath.map((point) => normalizePointSegment(point, segmentIndex));
      cloned.summaryRenderPath = cloned.summaryRenderPath.map((point) => normalizePointSegment(point, segmentIndex));
      return mirrorSegmentAliases(cloned);
    });
  }

  const trustedPath = clonePath(snapshot.trustedPath || snapshot.filteredPoints || snapshot.points || snapshot.path || []);
  const rawPath = clonePath(snapshot.rawPath || snapshot.rawPoints || trustedPath);
  const liveRenderPath = clonePath(snapshot.liveRenderPath || snapshot.displayPoints || snapshot.displayPath || trustedPath);
  const summaryRenderPath = clonePath(snapshot.summaryRenderPath || snapshot.renderPath || snapshot.displayPath || liveRenderPath);
  if (rawPath.length === 0 && trustedPath.length === 0 && liveRenderPath.length === 0) return [];

  return [
    mirrorSegmentAliases({
      ...createSegment(0, Number(snapshot.startedAtMs || snapshot.startedAt) || Date.now()),
      rawPath: rawPath.map((point) => normalizePointSegment(point, 0)),
      trustedPath: trustedPath.map((point) => normalizePointSegment(point, 0)),
      liveRenderPath: liveRenderPath.map((point) => normalizePointSegment(point, 0)),
      summaryRenderPath: summaryRenderPath.map((point) => normalizePointSegment(point, 0)),
    }),
  ];
}

function hydrateStateFromSnapshot(state, snapshot = {}) {
  const status = getSnapshotStatus(snapshot);
  const segments = getSnapshotSegments(snapshot);
  state.startedAt = Number(snapshot.startedAtMs || snapshot.startedAt || state.startedAt || Date.now());
  state.status = status === "cancelled" ? "finished" : status;
  state.isRunning = status === "active";
  state.isPaused = status === "paused";
  state.segments = segments;
  state.currentSegmentIndex = Math.max(segments.length - 1, -1);
  state.pathQuality = {
    ...emptyQuality(),
    ...(snapshot.pathQuality || snapshot.gpsQualitySummary || {}),
  };
  state.lowConfidenceSegments = Array.isArray(snapshot.lowConfidenceSegments) ? snapshot.lowConfidenceSegments : [];
  rebuildDerivedState(state);
  state.currentPosition = clonePoint(snapshot.currentLocation || state.trustedPath[state.trustedPath.length - 1] || null);
  state.smoothedPosition = clonePoint(state.currentPosition);
  const persistedMaxSpeedMps = Number(snapshot.maxSpeedMps ?? snapshot.stats?.maxSpeedMps) || 0;
  const hasReconstructibleSpeed = state.trustedPath.some((point) => {
    const speed = point?.calculatedSpeedMps ?? point?.speed;
    return speed != null && speed !== "" && Number.isFinite(Number(speed));
  });
  state.maxSpeedFloor = hasReconstructibleSpeed ? 0 : persistedMaxSpeedMps;
  state.maxSpeedMps = Math.max(state.maxSpeedMps, state.maxSpeedFloor);
  const lastPoint = state.trustedPath[state.trustedPath.length - 1] || null;
  state.previousSpeedMps = Number(lastPoint?.calculatedSpeedMps || lastPoint?.speed || 0) || 0;
  state.segmentId = Number.isFinite(Number(segments[segments.length - 1]?.index)) ? Number(segments[segments.length - 1].index) : 0;
}

function incrementRejectCounter(pathQuality, reason) {
  pathQuality.rejectedPoints += 1;
  pathQuality.lastRejectReason = reason || TRACKING_REJECT_REASON.unknown;
  const key = reasonCounterMap[reason];
  if (key) pathQuality[key] = (pathQuality[key] || 0) + 1;
}

function createAcceptedPoint(point, verdict, segmentIndex) {
  return {
    ...point,
    segmentId: segmentIndex,
    accepted: true,
    rejectedReason: null,
    classification: verdict.classification || "accepted",
    qualityScore: verdict.qualityScore,
    distanceFromPreviousMeters: verdict.distanceFromPreviousMeters ?? 0,
    timeFromPreviousMs: verdict.timeFromPreviousMs ?? 0,
    calculatedSpeedMps: verdict.calculatedSpeedMps ?? 0,
    bearingFromPrevious: verdict.bearingFromPrevious ?? null,
  };
}

function getValidAccuracy(point) {
  const rawAccuracy = point?.accuracy;
  if (rawAccuracy == null || rawAccuracy === "") return null;
  const accuracy = Number(rawAccuracy);
  return Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;
}

function syncQualityStats(state) {
  state.pathQuality.rawPoints = state.rawPath.length;
  state.pathQuality.totalRawPoints = state.rawPath.length;
  state.pathQuality.acceptedPoints = state.trustedPath.length;
  state.pathQuality.averageAccuracy = state.acceptedAccuracyCount > 0
    ? state.acceptedAccuracySum / state.acceptedAccuracyCount
    : null;
  state.pathQuality.maxAccuracy = state.acceptedAccuracyCount > 0
    ? state.acceptedAccuracyMaxPrefix[state.acceptedAccuracyMaxPrefix.length - 1] ?? null
    : null;
  state.pathQuality.poorAccuracyRatio = state.rawAccuracyCount > 0
    ? state.poorRawAccuracyCount / state.rawAccuracyCount
    : 0;
  state.pathQuality.smoothingVersion = TRACKING_SMOOTHING_VERSION;
  state.pathQuality.filterVersion = TRACKING_FILTER_VERSION;
}

function pushAcceptedAccuracy(state, point) {
  const accuracy = getValidAccuracy(point);
  const previousMax =
    state.acceptedAccuracyMaxPrefix[state.acceptedAccuracyMaxPrefix.length - 1] ?? null;
  state.acceptedAccuracyValues.push(accuracy);
  state.acceptedAccuracyMaxPrefix.push(
    accuracy == null
      ? previousMax
      : previousMax == null
        ? accuracy
        : Math.max(previousMax, accuracy)
  );
  if (accuracy != null) {
    state.acceptedAccuracySum += accuracy;
    state.acceptedAccuracyCount += 1;
  }
}

function popAcceptedAccuracy(state) {
  const accuracy = state.acceptedAccuracyValues.pop();
  state.acceptedAccuracyMaxPrefix.pop();
  if (accuracy != null) {
    state.acceptedAccuracySum = Math.max(0, state.acceptedAccuracySum - accuracy);
    state.acceptedAccuracyCount = Math.max(0, state.acceptedAccuracyCount - 1);
  }
}

function appendRawPoint(state, point) {
  state.rawPath.push(point);
  const accuracy = getValidAccuracy(point);
  if (accuracy != null) {
    state.rawAccuracyCount += 1;
    if (accuracy > state.preset.maxAccuracyMeters) {
      state.poorRawAccuracyCount += 1;
    }
  }
  state.workCounters.incrementalRawAppends += 1;
}

function appendTrustedPoint(state, segment, point) {
  const last = segment.trustedPath[segment.trustedPath.length - 1] || null;
  const distanceMeters = last ? calculateDistanceMeters(last, point) : 0;
  segment.trustedPath.push(point);
  segment.filteredPoints = segment.trustedPath;
  if (segment.trustedPath.length === 2) {
    state.trustedSegmentPaths.push(segment.trustedPath);
  }
  state.trustedPath.push(point);
  state.distanceMeters += distanceMeters;
  pushAcceptedAccuracy(state, point);
  const previousMaxSpeed = Math.max(
    state.maxSpeedFloor,
    state.maxSpeedPrefix[state.maxSpeedPrefix.length - 1] || 0
  );
  state.maxSpeedPrefix.push(Math.max(previousMaxSpeed, Number(point.calculatedSpeedMps) || 0));
  state.maxSpeedMps = Math.max(
    state.maxSpeedFloor,
    state.maxSpeedPrefix[state.maxSpeedPrefix.length - 1] || 0
  );
  state.workCounters.incrementalTrustedAppends += 1;
}

function removeLastTrustedPoint(state, segment) {
  if (!segment || segment.trustedPath.length === 0) return null;
  const removed = segment.trustedPath.pop();
  if (
    segment.trustedPath.length === 1 &&
    state.trustedSegmentPaths[state.trustedSegmentPaths.length - 1] === segment.trustedPath
  ) {
    state.trustedSegmentPaths.pop();
  }
  const previous = segment.trustedPath[segment.trustedPath.length - 1] || null;
  if (previous) {
    state.distanceMeters = Math.max(0, state.distanceMeters - calculateDistanceMeters(previous, removed));
  }
  if (state.trustedPath[state.trustedPath.length - 1] === removed) {
    state.trustedPath.pop();
  } else {
    // This is only a defensive path for malformed legacy hydration. Normal
    // foreground/headless ingestion always removes the global tail in O(1).
    state.trustedPath = flattenSegmentPath(state.segments, "trustedPath");
    state.workCounters.fullPathRebuilds += 1;
  }
  popAcceptedAccuracy(state);
  state.maxSpeedPrefix.pop();
  state.maxSpeedMps = Math.max(
    state.maxSpeedFloor,
    state.maxSpeedPrefix[state.maxSpeedPrefix.length - 1] || 0
  );
  segment.filteredPoints = segment.trustedPath;
  state.workCounters.incrementalTrustedRemovals += 1;
  return removed;
}

function appendLivePoint(state, segment, point) {
  segment.liveRenderPath.push(point);
  segment.displayPoints = segment.liveRenderPath;
  if (segment.liveRenderPath.length === 2) {
    state.liveRenderSegmentPaths.push(segment.liveRenderPath);
  }
  state.liveRenderPath.push(point);
}

function removeLastLivePoint(state, segment) {
  if (!segment || segment.liveRenderPath.length === 0) return;
  const removed = segment.liveRenderPath.pop();
  if (
    segment.liveRenderPath.length === 1 &&
    state.liveRenderSegmentPaths[state.liveRenderSegmentPaths.length - 1] === segment.liveRenderPath
  ) {
    state.liveRenderSegmentPaths.pop();
  }
  if (state.liveRenderPath[state.liveRenderPath.length - 1] === removed) {
    state.liveRenderPath.pop();
    return;
  }
  state.liveRenderPath = flattenSegmentPath(state.segments, "liveRenderPath");
  state.workCounters.fullPathRebuilds += 1;
}

function rebuildDerivedState(state) {
  // Recovery is the only normal path allowed to rebuild the flat indexes.
  // Foreground and headless samples update the same arrays incrementally.
  state.workCounters.fullPathRebuilds += 1;
  state.rawPath = [];
  state.trustedPath = [];
  state.liveRenderPath = [];
  state.trustedSegmentPaths = [];
  state.liveRenderSegmentPaths = [];
  state.distanceMeters = 0;
  state.rawAccuracyCount = 0;
  state.poorRawAccuracyCount = 0;
  state.acceptedAccuracyValues = [];
  state.acceptedAccuracyMaxPrefix = [];
  state.acceptedAccuracySum = 0;
  state.acceptedAccuracyCount = 0;
  state.maxSpeedPrefix = [];
  state.maxSpeedMps = 0;

  for (const segment of state.segments) {
    let previousTrusted = null;
    for (const point of segment.rawPath || []) {
      state.rawPath.push(point);
      const accuracy = getValidAccuracy(point);
      if (accuracy != null) {
        state.rawAccuracyCount += 1;
        if (accuracy > state.preset.maxAccuracyMeters) state.poorRawAccuracyCount += 1;
      }
    }
    for (const point of segment.trustedPath || []) {
      state.trustedPath.push(point);
      if (previousTrusted) state.distanceMeters += calculateDistanceMeters(previousTrusted, point);
      previousTrusted = point;
      pushAcceptedAccuracy(state, point);
      const previousMaxSpeed = state.maxSpeedPrefix[state.maxSpeedPrefix.length - 1] || 0;
      state.maxSpeedPrefix.push(Math.max(previousMaxSpeed, Number(point.calculatedSpeedMps ?? point.speed) || 0));
    }
    for (const point of segment.liveRenderPath || []) {
      state.liveRenderPath.push(point);
    }
    if ((segment.trustedPath || []).length >= 2) state.trustedSegmentPaths.push(segment.trustedPath);
    if ((segment.liveRenderPath || []).length >= 2) state.liveRenderSegmentPaths.push(segment.liveRenderPath);
  }

  state.maxSpeedMps = state.maxSpeedPrefix[state.maxSpeedPrefix.length - 1] || 0;
  syncQualityStats(state);
}

function getCurrentSegment(state, { create = true, startedAt = Date.now() } = {}) {
  let current = state.segments[state.currentSegmentIndex] || null;
  if (!current && create) {
    current = createSegment(state.segments.length, startedAt);
    state.segments.push(current);
    state.currentSegmentIndex = state.segments.length - 1;
  }
  return current;
}

function beginNewSegment(state, startedAt = Date.now(), reason = "resume") {
  const current = getCurrentSegment(state, { create: false });
  if (current && !current.endedAt) {
    current.endedAt = startedAt;
    current.endTimestamp = startedAt;
    current.endReason = reason;
  }
  const next = createSegment(state.segments.length, startedAt, reason);
  state.segments.push(next);
  state.currentSegmentIndex = state.segments.length - 1;
  state.segmentId = next.index;
  state.previousSpeedMps = 0;
  state.smoothedPosition = null;
  return next;
}

function mirrorSegmentAliases(segment) {
  if (!segment) return segment;
  segment.rawPoints = segment.rawPath;
  segment.filteredPoints = segment.trustedPath;
  segment.displayPoints = segment.summaryRenderPath;
  segment.startTimestamp = segment.startedAt;
  segment.endTimestamp = segment.endedAt;
  return segment;
}

function shouldStartGpsGapSegment(currentSegment, rawPoint, preset) {
  const last = currentSegment?.trustedPath?.[currentSegment.trustedPath.length - 1] || null;
  if (!last || !rawPoint) return false;
  const timeMs = Number(rawPoint.timestamp) - Number(last.timestamp);
  if (!Number.isFinite(timeMs) || timeMs <= 0) return false;
  const distanceMeters = calculateDistanceMeters(last, rawPoint);
  const gapTimeMs = Number(preset.gpsGapTimeMs || 15000);
  const gapDistanceMeters = Number(preset.gpsGapDistanceMeters || 80);
  const minGapDistanceMeters = Number(preset.gpsGapMinDistanceMeters || 8);
  return (
    (timeMs > gapTimeMs && distanceMeters >= minGapDistanceMeters) ||
    (distanceMeters > gapDistanceMeters && timeMs > Math.min(gapTimeMs, 10000))
  );
}

function buildFullLiveRenderView(state) {
  const segments = state.segments.map((segment, index) => {
    const segmentIndex = Number.isFinite(Number(segment.index)) ? Number(segment.index) : index;
    const isCurrentSegment = index === state.currentSegmentIndex;
    const trustedPath = segment.trustedPath || [];
    const renderSource =
      isCurrentSegment && state.currentPosition && trustedPath.length > 1
        ? trustedPath.slice(0, -1).concat(normalizePointSegment(state.currentPosition, segmentIndex))
        : trustedPath;
    const liveRenderPath = buildLiveRenderPath(renderSource, { preset: state.preset }).map((point) =>
      normalizePointSegment(point, segmentIndex)
    );
    state.workCounters.liveRenderBuilds += 1;
    return {
      ...segment,
      rawPoints: segment.rawPath,
      filteredPoints: segment.trustedPath,
      liveRenderPath,
      displayPoints: liveRenderPath,
    };
  });
  return {
    segments,
    liveRenderPath: flattenSegmentPath(segments, "liveRenderPath"),
  };
}

function buildSummarySegments(state, liveSegments = state.segments) {
  return state.segments.map((segment, index) => {
    const segmentIndex = Number.isFinite(Number(segment.index)) ? Number(segment.index) : index;
    const summaryRenderPath = buildSummaryRenderPath(segment.trustedPath || [], { preset: state.preset });
    return mirrorSegmentAliases({
      ...cloneSegment({
        ...segment,
        liveRenderPath: liveSegments[index]?.liveRenderPath || segment.liveRenderPath,
      }),
      id: String(segment.id || `segment_${segmentIndex}`),
      index: segmentIndex,
      summaryRenderPath: summaryRenderPath.map((point) => normalizePointSegment(point, segmentIndex)),
    });
  });
}

function buildFinishPayload(state, finishOptions = {}) {
  syncQualityStats(state);
  const durationMs = Number(finishOptions.durationMs ?? finishOptions.durationSeconds * 1000) || 0;
  const liveRenderView = buildFullLiveRenderView(state);
  const summarySegments = buildSummarySegments(state, liveRenderView.segments);
  const summaryRenderPath = flattenSegmentPath(summarySegments, "summaryRenderPath");
  const averageSpeedMps = durationMs > 0 ? state.distanceMeters / (durationMs / 1000) : 0;
  const maxSpeedMps = state.maxSpeedMps;
  const quality = {
    ...state.pathQuality,
    rawPoints: state.rawPath.length,
    acceptedPoints: state.trustedPath.length,
    lowConfidenceSegments: state.lowConfidenceSegments,
    smoothingVersion: TRACKING_SMOOTHING_VERSION,
  };

  return {
    status: "finished",
    isRunning: state.isRunning,
    isPaused: state.isPaused,
    segments: summarySegments,
    routeSegments: summarySegments,
    rawPath: clonePath(state.rawPath),
    rawPoints: clonePath(state.rawPath),
    trustedPath: clonePath(state.trustedPath),
    filteredPoints: clonePath(state.trustedPath),
    liveRenderPath: clonePath(liveRenderView.liveRenderPath),
    summaryRenderPath,
    renderPath: summaryRenderPath,
    displayPath: summaryRenderPath,
    displayPoints: summaryRenderPath,
    path: clonePath(state.trustedPath),
    distanceMeters: state.distanceMeters,
    durationMs,
    averageSpeedMps,
    maxSpeedMps,
    pathQuality: quality,
    gpsQualitySummary: quality,
    lowConfidenceSegments: state.lowConfidenceSegments,
    smoothingVersion: TRACKING_SMOOTHING_VERSION,
    filterVersion: TRACKING_FILTER_VERSION,
  };
}

export function createTrackingSession(options = {}) {
  const presetName = options.preset || options.mode || "run";
  const preset = getTrackingPreset(presetName);
  const state = {
    presetName,
    preset,
    startedAt: options.startedAt || Date.now(),
    status: options.autoStart === false ? "idle" : "active",
    isRunning: options.autoStart === false ? false : true,
    isPaused: false,
    segments: [],
    currentSegmentIndex: -1,
    rawPath: [],
    trustedPath: [],
    liveRenderPath: [],
    trustedSegmentPaths: [],
    liveRenderSegmentPaths: [],
    currentPosition: null,
    smoothedPosition: null,
    distanceMeters: 0,
    previousSpeedMps: 0,
    maxSpeedMps: 0,
    maxSpeedFloor: 0,
    segmentId: 0,
    pathQuality: emptyQuality(),
    lowConfidenceSegments: [],
    lastResult: null,
    rawAccuracyCount: 0,
    poorRawAccuracyCount: 0,
    acceptedAccuracyValues: [],
    acceptedAccuracyMaxPrefix: [],
    acceptedAccuracySum: 0,
    acceptedAccuracyCount: 0,
    maxSpeedPrefix: [],
    workCounters: emptyWorkCounters(),
  };

  if (options.snapshot) {
    hydrateStateFromSnapshot(state, options.snapshot);
  }

  function buildExplicitLiveRenderView() {
    // Full smoothing/simplification is intentionally lazy. It is appropriate
    // for an explicit map/state read, but never for the GPS ingestion path.
    return buildFullLiveRenderView(state);
  }

  function snapshot(extra = {}, snapshotOptions = {}) {
    syncQualityStats(state);
    // Hot-path arrays are ephemeral, read-only views owned by this session.
    // Reusing them is what keeps ingestion O(1); explicit render/final payloads
    // materialize their own visual paths at non-critical boundaries.
    const explicitRender = snapshotOptions.fullRender === true
      ? buildExplicitLiveRenderView()
      : null;
    const segments = explicitRender?.segments || state.segments;
    const liveRenderPath = explicitRender?.liveRenderPath || state.liveRenderPath;
    if (snapshotOptions.hotPath === true) state.workCounters.hotPathSnapshots += 1;
    return {
      status: state.status,
      isRunning: state.isRunning,
      isPaused: state.isPaused,
      segments,
      rawPath: state.rawPath,
      rawPoints: state.rawPath,
      trustedPath: state.trustedPath,
      filteredPoints: state.trustedPath,
      liveRenderPath,
      displayPoints: liveRenderPath,
      trustedSegments: explicitRender
        ? getRenderableSegmentPathReferences(segments, "trustedPath")
        : state.trustedSegmentPaths,
      liveRenderSegments: explicitRender
        ? getRenderableSegmentPathReferences(segments, "liveRenderPath")
        : state.liveRenderSegmentPaths,
      currentPosition: state.currentPosition,
      stats: {
        distanceMeters: state.distanceMeters,
        maxSpeedMps: state.maxSpeedMps,
        averageSpeedMps: extra.durationMs > 0 ? state.distanceMeters / (extra.durationMs / 1000) : 0,
      },
      pathQuality: state.pathQuality,
      gpsQualitySummary: state.pathQuality,
      lowConfidenceSegments: state.lowConfidenceSegments,
      smoothingVersion: TRACKING_SMOOTHING_VERSION,
      filterVersion: TRACKING_FILTER_VERSION,
    };
  }

  function start(startOptions = {}) {
    if (state.status === "finished") return snapshot();
    state.isRunning = true;
    state.isPaused = false;
    state.status = "active";
    if (state.segments.length === 0) {
      getCurrentSegment(state, { create: true, startedAt: startOptions.startedAt || Date.now() });
    }
    return snapshot();
  }

  function pause(pauseOptions = {}) {
    if (!state.isRunning || state.isPaused) return snapshot();
    const endedAt = pauseOptions.endedAt || Date.now();
    const current = getCurrentSegment(state, { create: false });
    if (current && !current.endedAt) {
      current.endedAt = endedAt;
      current.endTimestamp = endedAt;
      current.endReason = "pause";
    }
    state.isPaused = true;
    state.status = "paused";
    state.smoothedPosition = null;
    state.previousSpeedMps = 0;
    return snapshot();
  }

  function resume(resumeOptions = {}) {
    if (state.status === "finished") return snapshot();
    const startedAt = resumeOptions.startedAt || Date.now();
    state.isRunning = true;
    state.isPaused = false;
    state.status = "active";
    const current = getCurrentSegment(state, { create: false });
    if (!current || current.trustedPath.length > 0 || current.rawPath.length > 0 || current.endedAt) {
      beginNewSegment(state, startedAt, "resume");
    }
    return snapshot();
  }

  function processLocationPoint(location, processOptions = {}) {
    const rawPoint = normalizeLocationPoint(location);
    if (state.status === "finished") {
      return {
        accepted: false,
        reason: "finished",
        action: TRACKING_FILTER_ACTION.ignore,
        rawPoint,
        currentPositionChanged: false,
        pathChanged: false,
        shouldMoveCamera: false,
        ...snapshot({}, { hotPath: true }),
      };
    }

    // A recovered PAUSED snapshot is intentionally not auto-started by a
    // location callback. Only the explicit resume transition may reopen it.
    if (state.isPaused) {
      return {
        accepted: false,
        reason: "paused",
        action: TRACKING_FILTER_ACTION.ignore,
        rawPoint,
        currentPositionChanged: false,
        pathChanged: false,
        shouldMoveCamera: false,
        ...snapshot({}, { hotPath: true }),
      };
    }

    if (!state.isRunning) {
      state.isRunning = true;
      state.isPaused = false;
      state.status = "active";
      if (state.segments.length === 0) {
        getCurrentSegment(state, { create: true, startedAt: processOptions.startedAt || Date.now() });
      }
    }

    if (!rawPoint) {
      incrementRejectCounter(state.pathQuality, TRACKING_REJECT_REASON.invalid_coordinate);
      return {
        accepted: false,
        reason: TRACKING_REJECT_REASON.invalid_coordinate,
        action: TRACKING_FILTER_ACTION.reject,
        currentPositionChanged: false,
        pathChanged: false,
        shouldMoveCamera: false,
        ...snapshot({}, { hotPath: true }),
      };
    }

    let currentSegment = getCurrentSegment(state, { create: true, startedAt: rawPoint.timestamp || Date.now() });
    const shouldBreak =
      ((processOptions.segmentBreak === true) ||
        shouldStartGpsGapSegment(currentSegment, rawPoint, preset)) &&
      (currentSegment.trustedPath.length > 0 || currentSegment.rawPath.length > 0);
    if (shouldBreak) {
      const breakReason = processOptions.segmentBreak === true ? "resume" : "gps_gap";
      if (breakReason === "gps_gap") state.pathQuality.gpsGapCount = (state.pathQuality.gpsGapCount || 0) + 1;
      currentSegment = beginNewSegment(state, rawPoint.timestamp || Date.now(), breakReason);
    }

    const segmentIndex = Number.isFinite(Number(currentSegment.index)) ? Number(currentSegment.index) : state.currentSegmentIndex;
    const rawWithSegment = normalizePointSegment(rawPoint, segmentIndex);
    currentSegment.rawPath.push(rawWithSegment);
    currentSegment.rawPoints = currentSegment.rawPath;
    appendRawPoint(state, rawWithSegment);

    const filterState = {
      ...state,
      startedAt: currentSegment.startedAt || state.startedAt,
      trustedPath: currentSegment.trustedPath,
      previousSpeedMps: currentSegment.trustedPath.length > 0 ? state.previousSpeedMps : 0,
    };
    const verdict = shouldAcceptPoint(rawWithSegment, filterState, preset);
    let pathChanged = false;
    let currentPositionChanged = false;
    let acceptedPoint = null;
    let canonicalAccelerationMps2 = verdict.accelerationMps2 ?? null;

    if (verdict.accepted) {
      if (verdict.action === TRACKING_FILTER_ACTION.replace_previous && currentSegment.trustedPath.length > 0) {
        removeLastTrustedPoint(state, currentSegment);
        removeLastLivePoint(state, currentSegment);
        const previousLivePosition =
          currentSegment.liveRenderPath[currentSegment.liveRenderPath.length - 1] ||
          currentSegment.trustedPath[currentSegment.trustedPath.length - 1] ||
          null;
        state.smoothedPosition = clonePoint(previousLivePosition);
        state.currentPosition = clonePoint(previousLivePosition);
        state.pathQuality.rejectedByZigzag += 1;
      }

      const lastInSegment = currentSegment.trustedPath[currentSegment.trustedPath.length - 1] || null;
      acceptedPoint = createAcceptedPoint(rawWithSegment, verdict, segmentIndex);
      if (acceptedPoint.classification === "suspicious") {
        state.pathQuality.suspiciousPoints = (state.pathQuality.suspiciousPoints || 0) + 1;
      }
      if (!lastInSegment) {
        acceptedPoint.distanceFromPreviousMeters = 0;
        acceptedPoint.timeFromPreviousMs = 0;
        acceptedPoint.calculatedSpeedMps = 0;
        acceptedPoint.bearingFromPrevious = null;
      } else {
        acceptedPoint.distanceFromPreviousMeters = calculateDistanceMeters(lastInSegment, acceptedPoint);
        acceptedPoint.timeFromPreviousMs = Math.max(
          0,
          Number(acceptedPoint.timestamp) - Number(lastInSegment.timestamp)
        );
        acceptedPoint.calculatedSpeedMps = acceptedPoint.timeFromPreviousMs > 0
          ? acceptedPoint.distanceFromPreviousMeters / (acceptedPoint.timeFromPreviousMs / 1000)
          : 0;
        acceptedPoint.bearingFromPrevious = calculateBearing(lastInSegment, acceptedPoint);
        if (verdict.action === TRACKING_FILTER_ACTION.replace_previous) {
          const previousSpeedMps = Number(
            lastInSegment.calculatedSpeedMps ?? lastInSegment.speed ?? 0
          ) || 0;
          canonicalAccelerationMps2 = acceptedPoint.timeFromPreviousMs > 0
            ? Math.abs(acceptedPoint.calculatedSpeedMps - previousSpeedMps) /
              (acceptedPoint.timeFromPreviousMs / 1000)
            : 0;
        }
      }

      appendTrustedPoint(state, currentSegment, acceptedPoint);
      state.previousSpeedMps = acceptedPoint.calculatedSpeedMps || 0;
      const resetSmoothing = !lastInSegment || shouldBreak || processOptions.segmentBreak === true;
      state.smoothedPosition = smoothCurrentPosition(resetSmoothing ? null : state.smoothedPosition, acceptedPoint, preset);
      state.currentPosition = state.smoothedPosition || acceptedPoint;
      appendLivePoint(
        state,
        currentSegment,
        normalizePointSegment(state.currentPosition, segmentIndex)
      );
      pathChanged = true;
      currentPositionChanged = true;
    } else {
      incrementRejectCounter(state.pathQuality, verdict.reason);
    }

    syncQualityStats(state);
    state.pathQuality.lastAccuracyMeters = getValidAccuracy(rawWithSegment);
    state.pathQuality.lastCalculatedSpeedMps = acceptedPoint?.calculatedSpeedMps ?? verdict.calculatedSpeedMps ?? null;
    const result = {
      accepted: verdict.accepted,
      reason: verdict.reason,
      action: verdict.action,
      classification: verdict.classification,
      qualityScore: verdict.qualityScore,
      distanceFromPreviousMeters: acceptedPoint?.distanceFromPreviousMeters ?? verdict.distanceFromPreviousMeters ?? null,
      timeFromPreviousMs: acceptedPoint?.timeFromPreviousMs ?? verdict.timeFromPreviousMs ?? null,
      calculatedSpeedMps: acceptedPoint?.calculatedSpeedMps ?? verdict.calculatedSpeedMps ?? null,
      accelerationMps2: canonicalAccelerationMps2,
      point: acceptedPoint,
      rawPoint: rawWithSegment,
      currentPositionChanged,
      pathChanged,
      shouldMoveCamera: currentPositionChanged && verdict.accepted,
      ...snapshot({}, { hotPath: true }),
    };
    state.lastResult = result;
    logTrackingDebug(verdict.accepted ? "accept" : "reject", {
      reason: verdict.reason,
      qualityScore: verdict.qualityScore,
      ...buildTrackingDebugSnapshot(state),
    }, options.debug);
    return result;
  }

  function finish(finishOptions = {}) {
    if (state.status === "finished") return buildFinishPayload(state, finishOptions);
    const current = getCurrentSegment(state, { create: false });
    if (current && !current.endedAt) {
      current.endedAt = finishOptions.finishedAt || Date.now();
      current.endTimestamp = current.endedAt;
    }
    state.isRunning = false;
    state.isPaused = false;
    state.status = "finished";
    return buildFinishPayload(state, finishOptions);
  }

  function finishTrackingSession(finishOptions = {}) {
    return finish(finishOptions);
  }

  function getState(getStateOptions = {}) {
    return snapshot({}, { fullRender: getStateOptions.fullRender !== false });
  }

  function reset(nextOptions = {}) {
    state.startedAt = nextOptions.startedAt || Date.now();
    state.status = nextOptions.autoStart === false ? "idle" : "active";
    state.isRunning = nextOptions.autoStart === false ? false : true;
    state.isPaused = false;
    state.segments = [];
    state.currentSegmentIndex = -1;
    state.rawPath = [];
    state.trustedPath = [];
    state.liveRenderPath = [];
    state.trustedSegmentPaths = [];
    state.liveRenderSegmentPaths = [];
    state.currentPosition = null;
    state.smoothedPosition = null;
    state.distanceMeters = 0;
    state.previousSpeedMps = 0;
    state.maxSpeedMps = 0;
    state.maxSpeedFloor = 0;
    state.segmentId = 0;
    state.pathQuality = emptyQuality();
    state.lowConfidenceSegments = [];
    state.lastResult = null;
    state.rawAccuracyCount = 0;
    state.poorRawAccuracyCount = 0;
    state.acceptedAccuracyValues = [];
    state.acceptedAccuracyMaxPrefix = [];
    state.acceptedAccuracySum = 0;
    state.acceptedAccuracyCount = 0;
    state.maxSpeedPrefix = [];
    state.workCounters = emptyWorkCounters();
  }

  const api = {
    start,
    pause,
    resume,
    finish,
    processLocationPoint,
    finishTrackingSession,
    getState,
    getSegments: () => getState().segments.map(cloneSegment),
    getRawPath: () => clonePath(state.rawPath),
    getTrustedPath: () => clonePath(state.trustedPath),
    getLiveRenderPath: () => clonePath(getState().liveRenderPath),
    getSummaryRenderPath: () => buildFinishPayload(state).summaryRenderPath,
    getCurrentPosition: () => clonePoint(state.currentPosition),
    getPathQuality: () => {
      syncQualityStats(state);
      return { ...state.pathQuality };
    },
    __getWorkCountersForTests: () => ({ ...state.workCounters }),
    reset,
    state,
  };

  return api;
}

export function finishTrackingSession(session, options = {}) {
  if (session?.finishTrackingSession) return session.finishTrackingSession(options);
  const fallback = createTrackingSession();
  for (const point of options.path || []) {
    fallback.processLocationPoint(point);
  }
  return fallback.finish(options);
}

export function getRenderablePathForRun(run = {}) {
  return getBestRenderPathForRun(run);
}

export { getRenderableSegmentsForRun };

export default {
  createTrackingSession,
  finishTrackingSession,
  getRenderablePathForRun,
  getRenderableSegmentsForRun,
  normalizeLocationPoint,
};
