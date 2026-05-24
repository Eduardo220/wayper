import { getTrackingPreset } from "../tracking/trackingConfig.js";
import {
  calculateDistanceMeters,
  calculateSpeedMps,
  clamp,
  isValidCoordinate,
} from "../tracking/trackingMath.js";
import {
  normalizeLocationPoint as normalizeLegacyLocationPoint,
  shouldAcceptPoint as shouldAcceptLegacyPoint,
} from "../tracking/trackingFilters.js";
import {
  TRACK_FILTER_ACTION,
  TRACK_REJECT_REASON,
} from "./trackTypes.js";
import { getGpsQualityLevel } from "./gpsQuality.js";

export function normalizeTrackPoint(location = {}) {
  const point = normalizeLegacyLocationPoint(location);
  if (!point) return null;
  const coords = location?.coords || {};
  return {
    ...point,
    mocked: Boolean(location?.mocked ?? coords?.mocked ?? location?.isMocked),
  };
}

export const normalizeLocation = normalizeTrackPoint;

function reject(point, reason, extra = {}) {
  return {
    accepted: false,
    point: point || null,
    reason,
    action: TRACK_FILTER_ACTION.reject,
    qualityScore: 0,
    ...extra,
  };
}

function acceptedSegmentBreak(point, previous, gap, preset) {
  const accuracy = Number(point?.accuracy);
  const hasAccuracy = Number.isFinite(accuracy);
  const qualityScore = hasAccuracy
    ? clamp(
        getGpsQualityLevel(accuracy, preset) === "bad" ? 18 : 64,
        0,
        100
      )
    : 52;

  return {
    accepted: true,
    point: { ...point, accepted: true, qualityScore },
    reason: TRACK_REJECT_REASON.gps_gap,
    action: TRACK_FILTER_ACTION.segment_break,
    segmentBreak: true,
    segmentBreakReason: TRACK_REJECT_REASON.gps_gap,
    qualityScore,
    distanceFromPreviousMeters: gap.distanceMeters,
    timeFromPreviousMs: gap.timeMs,
    calculatedSpeedMps: calculateSpeedMps(previous, point),
  };
}

export function detectGpsGap(previousAcceptedPoint, candidatePoint, options = {}) {
  if (!isValidCoordinate(previousAcceptedPoint) || !isValidCoordinate(candidatePoint)) {
    return { shouldBreak: false, reason: null, distanceMeters: 0, timeMs: 0 };
  }

  const preset = getTrackingPreset(options.preset || "run");
  const timeMs = Number(candidatePoint.timestamp) - Number(previousAcceptedPoint.timestamp);
  const distanceMeters = calculateDistanceMeters(previousAcceptedPoint, candidatePoint);
  const gapTimeMs = Number(options.gpsGapTimeMs ?? preset.gpsGapTimeMs ?? 15000);
  const gapDistanceMeters = Number(options.gpsGapDistanceMeters ?? preset.gpsGapDistanceMeters ?? 80);
  const minGapDistanceMeters = Number(options.gpsGapMinDistanceMeters ?? preset.gpsGapMinDistanceMeters ?? 8);

  if (!Number.isFinite(timeMs) || timeMs <= 0) {
    return { shouldBreak: false, reason: null, distanceMeters, timeMs };
  }

  const shouldBreak =
    (timeMs > gapTimeMs && distanceMeters >= minGapDistanceMeters) ||
    (distanceMeters > gapDistanceMeters && timeMs > Math.min(gapTimeMs, 10000));

  return {
    shouldBreak,
    reason: shouldBreak ? TRACK_REJECT_REASON.gps_gap : null,
    distanceMeters,
    timeMs,
  };
}

export function shouldAcceptPoint(previousAcceptedPoint, candidatePoint, state = {}) {
  const preset = state.preset || state.mode || "run";
  const point = normalizeTrackPoint(candidatePoint);

  if (!point || !isValidCoordinate(point)) {
    return reject(null, TRACK_REJECT_REASON.invalid_coordinate);
  }

  if (point.mocked) {
    return reject(point, TRACK_REJECT_REASON.mocked);
  }

  const previous = previousAcceptedPoint || state.previousAcceptedPoint || null;
  if (previous && Number(point.timestamp) <= Number(previous.timestamp)) {
    return reject(point, TRACK_REJECT_REASON.out_of_order, {
      action: TRACK_FILTER_ACTION.reject,
      timeFromPreviousMs: Number(point.timestamp) - Number(previous.timestamp),
    });
  }

  const gap = detectGpsGap(previous, point, { ...state, preset });
  if (gap.shouldBreak) {
    return acceptedSegmentBreak(point, previous, gap, preset);
  }

  const acceptedPath =
    Array.isArray(state.filteredPoints)
      ? state.filteredPoints
      : Array.isArray(state.trustedPath)
        ? state.trustedPath
        : previous
          ? [previous]
          : [];

  return shouldAcceptLegacyPoint(point, {
    ...state,
    trustedPath: acceptedPath,
    acceptedPath,
    previousSpeedMps: state.previousSpeedMps,
  }, preset);
}

export default {
  detectGpsGap,
  normalizeTrackPoint,
  normalizeLocation,
  shouldAcceptPoint,
};
