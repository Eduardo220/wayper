import { getTrackingPreset, TRACKING_SMOOTHING_VERSION } from "./trackingConfig.js";
import { TRACKING_FILTER_ACTION, TRACKING_REJECT_REASON } from "./trackingTypes.js";
import { normalizeLocationPoint, shouldAcceptPoint } from "./trackingFilters.js";
import {
  calculateAverageAccuracy,
  calculateBearing,
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
  [TRACKING_REJECT_REASON.too_much_acceleration]: "rejectedBySpeed",
  [TRACKING_REJECT_REASON.too_close]: "rejectedByDistance",
  [TRACKING_REJECT_REASON.short_zigzag]: "rejectedByZigzag",
  [TRACKING_REJECT_REASON.duplicate_point]: "rejectedByDuplicate",
  [TRACKING_REJECT_REASON.warmup_bad_point]: "rejectedByWarmup",
};

function emptyQuality() {
  return {
    rawPoints: 0,
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
    lowConfidenceSegments: [],
    smoothingVersion: TRACKING_SMOOTHING_VERSION,
  };
}

function clonePoint(point) {
  return point ? { ...point } : point;
}

function clonePath(path = []) {
  return (Array.isArray(path) ? path : []).map(clonePoint).filter(Boolean);
}

function cloneSegment(segment = {}) {
  return {
    id: String(segment.id || ""),
    index: Number.isFinite(Number(segment.index)) ? Number(segment.index) : 0,
    startedAt: Number(segment.startedAt || Date.now()),
    endedAt: segment.endedAt ?? null,
    rawPath: clonePath(segment.rawPath),
    trustedPath: clonePath(segment.trustedPath),
    liveRenderPath: clonePath(segment.liveRenderPath),
    summaryRenderPath: clonePath(segment.summaryRenderPath),
  };
}

function createSegment(index = 0, startedAt = Date.now()) {
  return {
    id: `segment_${index}_${startedAt}`,
    index,
    startedAt,
    endedAt: null,
    rawPath: [],
    trustedPath: [],
    liveRenderPath: [],
    summaryRenderPath: [],
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
  state.pathQuality.acceptedPoints = state.trustedPath.length;
  state.pathQuality.averageAccuracy = calculateAverageAccuracy(state.trustedPath);
  state.pathQuality.maxAccuracy = calculateMaxAccuracy(state.trustedPath);
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

function beginNewSegment(state, startedAt = Date.now()) {
  const current = getCurrentSegment(state, { create: false });
  if (current && !current.endedAt) current.endedAt = startedAt;
  const next = createSegment(state.segments.length, startedAt);
  state.segments.push(next);
  state.currentSegmentIndex = state.segments.length - 1;
  state.segmentId = next.index;
  state.previousSpeedMps = 0;
  state.smoothedPosition = null;
  return next;
}

function buildSummarySegments(state) {
  return state.segments.map((segment, index) => {
    const segmentIndex = Number.isFinite(Number(segment.index)) ? Number(segment.index) : index;
    const summaryRenderPath = buildSummaryRenderPath(segment.trustedPath || [], { preset: state.preset });
    return {
      ...cloneSegment(segment),
      id: String(segment.id || `segment_${segmentIndex}`),
      index: segmentIndex,
      summaryRenderPath: summaryRenderPath.map((point) => normalizePointSegment(point, segmentIndex)),
    };
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
    isRunning: state.isRunning,
    isPaused: state.isPaused,
    segments: summarySegments,
    rawPath: clonePath(state.rawPath),
    trustedPath: clonePath(state.trustedPath),
    liveRenderPath: clonePath(state.liveRenderPath),
    summaryRenderPath,
    renderPath: summaryRenderPath,
    displayPath: summaryRenderPath,
    path: clonePath(state.trustedPath),
    distanceMeters: state.distanceMeters,
    durationMs,
    averageSpeedMps,
    maxSpeedMps,
    pathQuality: quality,
    lowConfidenceSegments: state.lowConfidenceSegments,
    smoothingVersion: TRACKING_SMOOTHING_VERSION,
  };
}

export function createTrackingSession(options = {}) {
  const presetName = options.preset || options.mode || "run";
  const preset = getTrackingPreset(presetName);
  const state = {
    presetName,
    preset,
    startedAt: options.startedAt || Date.now(),
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

  function snapshot(extra = {}) {
    updateFlattenedState(state);
    return {
      isRunning: state.isRunning,
      isPaused: state.isPaused,
      segments: state.segments,
      rawPath: state.rawPath,
      trustedPath: state.trustedPath,
      liveRenderPath: state.liveRenderPath,
      trustedSegments: getRenderableSegmentPaths(state.segments, "trustedPath"),
      liveRenderSegments: getRenderableSegmentPaths(state.segments, "liveRenderPath"),
      currentPosition: state.currentPosition,
      stats: {
        distanceMeters: state.distanceMeters,
        maxSpeedMps: state.maxSpeedMps,
        averageSpeedMps: extra.durationMs > 0 ? state.distanceMeters / (extra.durationMs / 1000) : 0,
      },
      pathQuality: state.pathQuality,
      lowConfidenceSegments: state.lowConfidenceSegments,
      smoothingVersion: TRACKING_SMOOTHING_VERSION,
    };
  }

  function start(startOptions = {}) {
    state.isRunning = true;
    state.isPaused = false;
    if (state.segments.length === 0) {
      getCurrentSegment(state, { create: true, startedAt: startOptions.startedAt || Date.now() });
    }
    return snapshot();
  }

  function pause(pauseOptions = {}) {
    if (!state.isRunning || state.isPaused) return snapshot();
    const endedAt = pauseOptions.endedAt || Date.now();
    const current = getCurrentSegment(state, { create: false });
    if (current && !current.endedAt) current.endedAt = endedAt;
    state.isPaused = true;
    state.smoothedPosition = null;
    state.previousSpeedMps = 0;
    return snapshot();
  }

  function resume(resumeOptions = {}) {
    const startedAt = resumeOptions.startedAt || Date.now();
    state.isRunning = true;
    state.isPaused = false;
    const current = getCurrentSegment(state, { create: false });
    if (!current || current.trustedPath.length > 0 || current.rawPath.length > 0 || current.endedAt) {
      beginNewSegment(state, startedAt);
    }
    return snapshot();
  }

  function processLocationPoint(location, processOptions = {}) {
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
      processOptions.segmentBreak === true &&
      (currentSegment.trustedPath.length > 0 || currentSegment.rawPath.length > 0);
    if (shouldBreak) {
      currentSegment = beginNewSegment(state, rawPoint.timestamp || Date.now());
    }

    const segmentIndex = Number.isFinite(Number(currentSegment.index)) ? Number(currentSegment.index) : state.currentSegmentIndex;
    const rawWithSegment = normalizePointSegment(rawPoint, segmentIndex);
    currentSegment.rawPath.push(rawWithSegment);
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
    const current = getCurrentSegment(state, { create: false });
    if (current && !current.endedAt) current.endedAt = finishOptions.finishedAt || Date.now();
    state.isRunning = false;
    state.isPaused = false;
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
