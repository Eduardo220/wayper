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
import { buildLiveRenderPath, buildSummaryRenderPath, getBestRenderPathForRun } from "./trackingRenderPath.js";
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

function updateQualityStats(state) {
  state.pathQuality.rawPoints = state.rawPath.length;
  state.pathQuality.acceptedPoints = state.trustedPath.length;
  state.pathQuality.averageAccuracy = calculateAverageAccuracy(state.trustedPath);
  state.pathQuality.maxAccuracy = calculateMaxAccuracy(state.trustedPath);
}

function incrementRejectCounter(pathQuality, reason) {
  pathQuality.rejectedPoints += 1;
  const key = reasonCounterMap[reason];
  if (key) pathQuality[key] = (pathQuality[key] || 0) + 1;
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

function createAcceptedPoint(point, verdict, segmentId) {
  return {
    ...point,
    segmentId,
    accepted: true,
    rejectedReason: null,
    qualityScore: verdict.qualityScore,
    distanceFromPreviousMeters: verdict.distanceFromPreviousMeters ?? 0,
    timeFromPreviousMs: verdict.timeFromPreviousMs ?? 0,
    calculatedSpeedMps: verdict.calculatedSpeedMps ?? 0,
    bearingFromPrevious: verdict.bearingFromPrevious ?? null,
  };
}

export function createTrackingSession(options = {}) {
  const presetName = options.preset || options.mode || "run";
  const preset = getTrackingPreset(presetName);
  const state = {
    presetName,
    preset,
    startedAt: options.startedAt || Date.now(),
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
    return {
      rawPath: state.rawPath,
      trustedPath: state.trustedPath,
      liveRenderPath: state.liveRenderPath,
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

  function processLocationPoint(location, processOptions = {}) {
    const rawPoint = normalizeLocationPoint(location);
    if (rawPoint) state.rawPath.push(rawPoint);

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

    const verdict = shouldAcceptPoint(rawPoint, state, preset);
    let pathChanged = false;
    let currentPositionChanged = false;
    let acceptedPoint = null;

    if (verdict.accepted) {
      if (verdict.action === TRACKING_FILTER_ACTION.replace_previous && state.trustedPath.length > 0) {
        state.trustedPath.pop();
        state.distanceMeters = calculatePathDistanceMeters(state.trustedPath);
        state.pathQuality.rejectedByZigzag += 1;
      }

      const last = state.trustedPath[state.trustedPath.length - 1] || null;
      const segmentId = last && (processOptions.segmentBreak || (verdict.timeFromPreviousMs > 30_000 && verdict.calculatedSpeedMps <= preset.maxSpeedMps))
        ? state.segmentId + 1
        : state.segmentId;
      state.segmentId = segmentId;
      acceptedPoint = createAcceptedPoint(rawPoint, verdict, segmentId);
      if (!acceptedPoint.bearingFromPrevious && last) {
        acceptedPoint.bearingFromPrevious = calculateBearing(last, acceptedPoint);
      }

      state.trustedPath.push(acceptedPoint);
      state.distanceMeters = calculatePathDistanceMeters(state.trustedPath);
      state.previousSpeedMps = acceptedPoint.calculatedSpeedMps || 0;
      state.maxSpeedMps = Math.max(state.maxSpeedMps, acceptedPoint.calculatedSpeedMps || 0);
      state.smoothedPosition = smoothCurrentPosition(processOptions.segmentBreak ? null : state.smoothedPosition, acceptedPoint, preset);
      state.currentPosition = state.smoothedPosition || acceptedPoint;
      state.liveRenderPath = buildLiveRenderPath(
        state.currentPosition && state.trustedPath.length > 1
          ? state.trustedPath.slice(0, -1).concat(state.currentPosition)
          : state.trustedPath,
        { preset }
      );
      pathChanged = true;
      currentPositionChanged = true;
    } else {
      incrementRejectCounter(state.pathQuality, verdict.reason);
      // Rejected GPS points must not move the visible marker, camera, distance, or route.
      // That is what prevents urban jumps from drawing cuts across the map.
    }

    updateQualityStats(state);
    const result = {
      accepted: verdict.accepted,
      reason: verdict.reason,
      action: verdict.action,
      point: acceptedPoint,
      rawPoint,
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

  function finishTrackingSession(finishOptions = {}) {
    updateQualityStats(state);
    const durationMs = Number(finishOptions.durationMs ?? finishOptions.durationSeconds * 1000) || 0;
    const summaryRenderPath = buildSummaryRenderPath(state.trustedPath, { preset });
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
      rawPath: state.rawPath.map((point) => ({ ...point })),
      trustedPath: state.trustedPath.map((point) => ({ ...point })),
      liveRenderPath: state.liveRenderPath.map((point) => ({ ...point })),
      summaryRenderPath,
      renderPath: summaryRenderPath,
      displayPath: summaryRenderPath,
      path: state.trustedPath.map((point) => ({ ...point })),
      distanceMeters: state.distanceMeters,
      durationMs,
      averageSpeedMps,
      maxSpeedMps,
      pathQuality: quality,
      lowConfidenceSegments: state.lowConfidenceSegments,
      smoothingVersion: TRACKING_SMOOTHING_VERSION,
    };
  }

  function getState() {
    return snapshot();
  }

  function reset(nextOptions = {}) {
    state.startedAt = nextOptions.startedAt || Date.now();
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

  return {
    processLocationPoint,
    finishTrackingSession,
    getState,
    reset,
    state,
  };
}

export function finishTrackingSession(session, options = {}) {
  if (session?.finishTrackingSession) return session.finishTrackingSession(options);
  const fallback = createTrackingSession();
  for (const point of options.path || []) {
    fallback.processLocationPoint(point);
  }
  return fallback.finishTrackingSession(options);
}

export function getRenderablePathForRun(run = {}) {
  return getBestRenderPathForRun(run);
}

export default {
  createTrackingSession,
  finishTrackingSession,
  getRenderablePathForRun,
  normalizeLocationPoint,
};
