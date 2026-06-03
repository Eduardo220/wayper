import { getTrackingPreset, TRACKING_FILTER_VERSION, TRACKING_SMOOTHING_VERSION } from "./trackingConfig.js";
import { TRACKING_FILTER_ACTION, TRACKING_REJECT_REASON } from "./trackingTypes.js";
import { normalizeLocationPoint, shouldAcceptPoint } from "./trackingFilters.js";
import {
  calculateAverageAccuracy,
  calculateBearing,
  calculateDistanceMeters,
  calculateMaxAccuracy,
  calculatePathDistanceMeters,
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
    rejectedByWarmup: 0,
    averageAccuracy: null,
    maxAccuracy: null,
    poorAccuracyRatio: 0,
    gpsGapCount: 0,
    lowConfidenceSegments: [],
    smoothingVersion: TRACKING_SMOOTHING_VERSION,
    filterVersion: TRACKING_FILTER_VERSION,
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

function getRenderableSegmentPaths(segments = [], key = "liveRenderPath") {
  return (Array.isArray(segments) ? segments : [])
    .map((segment, index) => {
      const segmentIndex = Number.isFinite(Number(segment?.index)) ? Number(segment.index) : index;
      return clonePath(segment?.[key]).map((point) => normalizePointSegment(point, segmentIndex));
    })
    .filter((path) => path.length >= 2);
}

function calculateSegmentsDistance(segments = []) {
  return (Array.isArray(segments) ? segments : []).reduce((total, segment) => {
    return total + calculatePathDistanceMeters(segment?.trustedPath || []);
  }, 0);
}

function calculateMaxSpeed(path = []) {
  let maxSpeedMps = 0;
  for (let i = 1; i < path.length; i += 1) {
    const explicit = Number(path[i].calculatedSpeedMps ?? path[i].speed);
    if (Number.isFinite(explicit) && explicit >= 0) {
      maxSpeedMps = Math.max(maxSpeedMps, explicit);
    }
  }
  return maxSpeedMps;
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
      const cloned = cloneSegment({
        ...segment,
        id: segment?.id || `segment_${index}`,
        index: Number.isFinite(Number(segment?.index ?? segment?.segmentId)) ? Number(segment.index ?? segment.segmentId) : index,
        rawPath: segment?.rawPath || segment?.rawPoints || [],
        trustedPath: segment?.trustedPath || segment?.filteredPoints || segment?.path || [],
        liveRenderPath: segment?.liveRenderPath || segment?.displayPoints || segment?.summaryRenderPath || [],
        summaryRenderPath: segment?.summaryRenderPath || segment?.displayPoints || segment?.renderPath || [],
      });
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
  updateQualityStats(state);
  state.currentPosition = clonePoint(snapshot.currentLocation || state.trustedPath[state.trustedPath.length - 1] || null);
  state.smoothedPosition = clonePoint(state.currentPosition);
  state.maxSpeedMps = Number(snapshot.maxSpeedMps ?? snapshot.stats?.maxSpeedMps ?? calculateMaxSpeed(state.trustedPath)) || 0;
  const lastPoint = state.trustedPath[state.trustedPath.length - 1] || null;
  state.previousSpeedMps = Number(lastPoint?.calculatedSpeedMps || lastPoint?.speed || 0) || 0;
  state.segmentId = Number.isFinite(Number(segments[segments.length - 1]?.index)) ? Number(segments[segments.length - 1].index) : 0;
}

function incrementRejectCounter(pathQuality, reason) {
  pathQuality.rejectedPoints += 1;
  const key = reasonCounterMap[reason];
  if (key) pathQuality[key] = (pathQuality[key] || 0) + 1;
}

function createAcceptedPoint(point, verdict, segmentIndex) {
  return {
    ...point,
    segmentId: segmentIndex,
    accepted: true,
    rejectedReason: null,
    qualityScore: verdict.qualityScore,
    distanceFromPreviousMeters: verdict.distanceFromPreviousMeters ?? 0,
    timeFromPreviousMs: verdict.timeFromPreviousMs ?? 0,
    calculatedSpeedMps: verdict.calculatedSpeedMps ?? 0,
    bearingFromPrevious: verdict.bearingFromPrevious ?? null,
  };
}

function updateFlattenedState(state) {
  state.rawPath = flattenSegmentPath(state.segments, "rawPath");
  state.trustedPath = flattenSegmentPath(state.segments, "trustedPath");
  state.liveRenderPath = flattenSegmentPath(state.segments, "liveRenderPath");
  state.distanceMeters = calculateSegmentsDistance(state.segments);
}

function updateQualityStats(state) {
  updateFlattenedState(state);
  state.pathQuality.rawPoints = state.rawPath.length;
  state.pathQuality.totalRawPoints = state.rawPath.length;
  state.pathQuality.acceptedPoints = state.trustedPath.length;
  state.pathQuality.averageAccuracy = calculateAverageAccuracy(state.trustedPath);
  state.pathQuality.maxAccuracy = calculateMaxAccuracy(state.trustedPath);
  const rawWithAccuracy = state.rawPath
    .map((point) => Number(point?.accuracy))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const poorAccuracyCount = rawWithAccuracy.filter((value) => value > state.preset.maxAccuracyMeters).length;
  state.pathQuality.poorAccuracyRatio = rawWithAccuracy.length > 0 ? poorAccuracyCount / rawWithAccuracy.length : 0;
  state.pathQuality.smoothingVersion = TRACKING_SMOOTHING_VERSION;
  state.pathQuality.filterVersion = TRACKING_FILTER_VERSION;
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

function buildSummarySegments(state) {
  return state.segments.map((segment, index) => {
    const segmentIndex = Number.isFinite(Number(segment.index)) ? Number(segment.index) : index;
    const summaryRenderPath = buildSummaryRenderPath(segment.trustedPath || [], { preset: state.preset });
    return mirrorSegmentAliases({
      ...cloneSegment(segment),
      id: String(segment.id || `segment_${segmentIndex}`),
      index: segmentIndex,
      summaryRenderPath: summaryRenderPath.map((point) => normalizePointSegment(point, segmentIndex)),
    });
  });
}

function buildFinishPayload(state, finishOptions = {}) {
  updateQualityStats(state);
  const durationMs = Number(finishOptions.durationMs ?? finishOptions.durationSeconds * 1000) || 0;
  const summarySegments = buildSummarySegments(state);
  const summaryRenderPath = flattenSegmentPath(summarySegments, "summaryRenderPath");
  const averageSpeedMps = durationMs > 0 ? state.distanceMeters / (durationMs / 1000) : 0;
  const maxSpeedMps = Math.max(state.maxSpeedMps, calculateMaxSpeed(state.trustedPath));
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
    liveRenderPath: clonePath(state.liveRenderPath),
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
    currentPosition: null,
    smoothedPosition: null,
    distanceMeters: 0,
    previousSpeedMps: 0,
    maxSpeedMps: 0,
    segmentId: 0,
    pathQuality: emptyQuality(),
    lowConfidenceSegments: [],
    lastResult: null,
  };

  if (options.snapshot) {
    hydrateStateFromSnapshot(state, options.snapshot);
  }

  function snapshot(extra = {}) {
    updateFlattenedState(state);
    return {
      status: state.status,
      isRunning: state.isRunning,
      isPaused: state.isPaused,
      segments: state.segments,
      rawPath: state.rawPath,
      rawPoints: state.rawPath,
      trustedPath: state.trustedPath,
      filteredPoints: state.trustedPath,
      liveRenderPath: state.liveRenderPath,
      displayPoints: state.liveRenderPath,
      trustedSegments: getRenderableSegmentPaths(state.segments, "trustedPath"),
      liveRenderSegments: getRenderableSegmentPaths(state.segments, "liveRenderPath"),
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
    if (state.status === "finished") {
      const rawPoint = normalizeLocationPoint(location);
      return {
        accepted: false,
        reason: "finished",
        action: TRACKING_FILTER_ACTION.ignore,
        rawPoint,
        currentPositionChanged: false,
        pathChanged: false,
        shouldMoveCamera: false,
        ...snapshot(),
      };
    }

    if (!state.isRunning) start({ startedAt: processOptions.startedAt });

    const rawPoint = normalizeLocationPoint(location);
    if (!rawPoint) {
      state.pathQuality.rawPoints += 1;
      incrementRejectCounter(state.pathQuality, TRACKING_REJECT_REASON.invalid_coordinate);
      return {
        accepted: false,
        reason: TRACKING_REJECT_REASON.invalid_coordinate,
        action: TRACKING_FILTER_ACTION.reject,
        currentPositionChanged: false,
        pathChanged: false,
        shouldMoveCamera: false,
        ...snapshot(),
      };
    }

    if (state.isPaused) {
      return {
        accepted: false,
        reason: "paused",
        action: TRACKING_FILTER_ACTION.ignore,
        rawPoint,
        currentPositionChanged: false,
        pathChanged: false,
        shouldMoveCamera: false,
        ...snapshot(),
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
    updateFlattenedState(state);

    const filterState = {
      ...state,
      startedAt: currentSegment.startedAt || state.startedAt,
      trustedPath: currentSegment.trustedPath.length > 0 ? state.trustedPath : [],
      previousSpeedMps: currentSegment.trustedPath.length > 0 ? state.previousSpeedMps : 0,
    };
    const verdict = shouldAcceptPoint(rawWithSegment, filterState, preset);
    let pathChanged = false;
    let currentPositionChanged = false;
    let acceptedPoint = null;

    if (verdict.accepted) {
      if (verdict.action === TRACKING_FILTER_ACTION.replace_previous && currentSegment.trustedPath.length > 0) {
        currentSegment.trustedPath.pop();
        currentSegment.liveRenderPath = buildLiveRenderPath(currentSegment.trustedPath, { preset });
        currentSegment.filteredPoints = currentSegment.trustedPath;
        state.pathQuality.rejectedByZigzag += 1;
      }

      const lastInSegment = currentSegment.trustedPath[currentSegment.trustedPath.length - 1] || null;
      acceptedPoint = createAcceptedPoint(rawWithSegment, verdict, segmentIndex);
      if (!lastInSegment) {
        acceptedPoint.distanceFromPreviousMeters = 0;
        acceptedPoint.timeFromPreviousMs = 0;
        acceptedPoint.calculatedSpeedMps = 0;
        acceptedPoint.bearingFromPrevious = null;
      } else if (!acceptedPoint.bearingFromPrevious) {
        acceptedPoint.bearingFromPrevious = calculateBearing(lastInSegment, acceptedPoint);
      }

      currentSegment.trustedPath.push(acceptedPoint);
      currentSegment.filteredPoints = currentSegment.trustedPath;
      state.previousSpeedMps = acceptedPoint.calculatedSpeedMps || 0;
      state.maxSpeedMps = Math.max(state.maxSpeedMps, acceptedPoint.calculatedSpeedMps || 0);
      const resetSmoothing = !lastInSegment || shouldBreak || processOptions.segmentBreak === true;
      state.smoothedPosition = smoothCurrentPosition(resetSmoothing ? null : state.smoothedPosition, acceptedPoint, preset);
      state.currentPosition = state.smoothedPosition || acceptedPoint;
      currentSegment.liveRenderPath = buildLiveRenderPath(
        state.currentPosition && currentSegment.trustedPath.length > 1
          ? currentSegment.trustedPath.slice(0, -1).concat(normalizePointSegment(state.currentPosition, segmentIndex))
          : currentSegment.trustedPath,
        { preset }
      ).map((point) => normalizePointSegment(point, segmentIndex));
      currentSegment.displayPoints = currentSegment.liveRenderPath;
      pathChanged = true;
      currentPositionChanged = true;
    } else {
      incrementRejectCounter(state.pathQuality, verdict.reason);
    }

    updateQualityStats(state);
    const result = {
      accepted: verdict.accepted,
      reason: verdict.reason,
      action: verdict.action,
      point: acceptedPoint,
      rawPoint: rawWithSegment,
      currentPositionChanged,
      pathChanged,
      shouldMoveCamera: currentPositionChanged && verdict.accepted,
      ...snapshot(),
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

  function getState() {
    updateQualityStats(state);
    return snapshot();
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
    state.currentPosition = null;
    state.smoothedPosition = null;
    state.distanceMeters = 0;
    state.previousSpeedMps = 0;
    state.maxSpeedMps = 0;
    state.segmentId = 0;
    state.pathQuality = emptyQuality();
    state.lowConfidenceSegments = [];
    state.lastResult = null;
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
    getRawPath: () => clonePath(getState().rawPath),
    getTrustedPath: () => clonePath(getState().trustedPath),
    getLiveRenderPath: () => clonePath(getState().liveRenderPath),
    getSummaryRenderPath: () => buildFinishPayload(state).summaryRenderPath,
    getCurrentPosition: () => clonePoint(state.currentPosition),
    getPathQuality: () => ({ ...getState().pathQuality }),
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
