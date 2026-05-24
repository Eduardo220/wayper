import { getTrackingPreset } from "./trackingConfig.js";
import { TRACKING_FILTER_ACTION, TRACKING_POINT_SOURCE, TRACKING_REJECT_REASON } from "./trackingTypes.js";
import {
  calculateBearing,
  calculateDistanceMeters,
  calculateSpeedMps,
  calculateTurnAngle,
  clamp,
  isValidCoordinate,
} from "./trackingMath.js";

const toNumber = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeTimestamp = (value) => {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.getTime();
  return Date.now();
};

const normalizeOptionalNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function normalizeSource(point = {}) {
  const source = point.source || point.provider || null;
  if (source === TRACKING_POINT_SOURCE.expoLocation || source === "foreground" || source === "background") {
    return TRACKING_POINT_SOURCE.expoLocation;
  }
  if (source === TRACKING_POINT_SOURCE.fallback || source === "polling") return TRACKING_POINT_SOURCE.fallback;
  return TRACKING_POINT_SOURCE.unknown;
}

export function normalizeLocationPoint(location = {}) {
  if (!location) return null;
  const coords = location.coords || location;
  const latitude = toNumber(coords.latitude ?? location.latitude ?? coords.lat ?? location.lat);
  const longitude = toNumber(
    coords.longitude ?? location.longitude ?? coords.lng ?? coords.lon ?? location.lng ?? location.lon
  );

  const point = {
    latitude,
    longitude,
    accuracy: normalizeOptionalNumber(coords.accuracy ?? location.accuracy),
    altitude: normalizeOptionalNumber(coords.altitude ?? location.altitude),
    altitudeAccuracy: normalizeOptionalNumber(coords.altitudeAccuracy ?? location.altitudeAccuracy),
    speed: normalizeOptionalNumber(coords.speed ?? location.speed),
    heading: normalizeOptionalNumber(coords.heading ?? location.heading),
    timestamp: normalizeTimestamp(location.timestamp ?? coords.timestamp ?? location.time ?? location.t),
    source: normalizeSource(location),
    mocked: Boolean(location.mocked ?? coords.mocked ?? location.isMocked),
  };

  if (!isValidCoordinate(point)) return null;
  return point;
}

function qualityScoreForPoint(point, preset) {
  const accuracy = Number(point?.accuracy);
  if (!Number.isFinite(accuracy)) return 62;
  if (accuracy <= preset.quality.excellentAccuracyMeters) return 98;
  if (accuracy <= preset.quality.goodAccuracyMeters) return 86;
  if (accuracy <= preset.quality.acceptableAccuracyMeters) return 68;
  if (accuracy <= preset.quality.badAccuracyMeters) return 42;
  return 15;
}

function result(accepted, point, reason, qualityScore, action, extra = {}) {
  return {
    accepted,
    point: point || null,
    reason: reason || null,
    qualityScore: clamp(qualityScore, 0, 100),
    action,
    ...extra,
  };
}

function getAcceptedPath(state = {}) {
  return state.trustedPath || state.acceptedPath || state.path || [];
}

function isDuplicate(last, next, distanceM, dtMs) {
  return (
    (last.latitude === next.latitude && last.longitude === next.longitude && last.timestamp === next.timestamp) ||
    distanceM < 0.75 ||
    (distanceM < 1.2 && dtMs < 1200)
  );
}

function isWarmupBadPoint(point, state, preset) {
  const startedAt = Number(state.startedAt || state.startedAtMs || 0);
  if (!startedAt || !point?.timestamp) return false;
  const ageMs = point.timestamp - startedAt;
  const accuracy = Number(point.accuracy);
  return ageMs >= 0 && ageMs <= 10000 && Number.isFinite(accuracy) && accuracy > preset.maxAccuracyMeters;
}

function shouldRemovePreviousAsZigzag(path, next, preset) {
  if (!Array.isArray(path) || path.length < 2 || !next) return false;
  const a = path[path.length - 2];
  const b = path[path.length - 1];
  const c = next;
  const ab = calculateDistanceMeters(a, b);
  const bc = calculateDistanceMeters(b, c);
  const angle = calculateTurnAngle(a, b, c);
  const bAccuracy = Number.isFinite(Number(b.accuracy)) ? Number(b.accuracy) : preset.zigzagMinAccuracyPenaltyMeters;
  const cAccuracy = Number.isFinite(Number(c.accuracy)) ? Number(c.accuracy) : preset.zigzagMinAccuracyPenaltyMeters;

  return (
    angle >= preset.zigzagAngleDegrees &&
    ab <= preset.zigzagMaxSegmentMeters &&
    bc <= preset.zigzagMaxSegmentMeters &&
    bAccuracy >= Math.min(cAccuracy + 4, preset.zigzagMinAccuracyPenaltyMeters)
  );
}

function isShortZigzagCurrent(path, next, preset) {
  if (!Array.isArray(path) || path.length < 2 || !next) return false;
  const a = path[path.length - 2];
  const b = path[path.length - 1];
  const c = next;
  const ab = calculateDistanceMeters(a, b);
  const bc = calculateDistanceMeters(b, c);
  const angle = calculateTurnAngle(a, b, c);
  const cAccuracy = Number.isFinite(Number(c.accuracy)) ? Number(c.accuracy) : preset.softMaxAccuracyMeters;
  return (
    angle >= preset.zigzagAngleDegrees &&
    ab <= preset.zigzagMaxSegmentMeters &&
    bc <= preset.zigzagMaxSegmentMeters &&
    cAccuracy > preset.zigzagMinAccuracyPenaltyMeters
  );
}

export function shouldAcceptPoint(rawPoint, state = {}, presetInput = "run") {
  const preset = getTrackingPreset(presetInput);
  const point = normalizeLocationPoint(rawPoint);

  if (!point) {
    return result(false, null, TRACKING_REJECT_REASON.invalid_coordinate, 0, TRACKING_FILTER_ACTION.reject);
  }

  let qualityScore = qualityScoreForPoint(point, preset);
  const accuracy = Number(point.accuracy);
  const hasAccuracy = Number.isFinite(accuracy);
  const path = getAcceptedPath(state);
  const last = path[path.length - 1] || null;
  const prev = path[path.length - 2] || null;

  if (hasAccuracy && accuracy > preset.hardMaxAccuracyMeters) {
    return result(false, point, TRACKING_REJECT_REASON.bad_accuracy, qualityScore, TRACKING_FILTER_ACTION.reject);
  }

  if (point.mocked) {
    return result(false, point, TRACKING_REJECT_REASON.mocked, qualityScore, TRACKING_FILTER_ACTION.reject);
  }

  if (!last) {
    if (isWarmupBadPoint(point, state, preset)) {
      return result(false, point, TRACKING_REJECT_REASON.warmup_bad_point, qualityScore, TRACKING_FILTER_ACTION.pending);
    }
    return result(true, { ...point, accepted: true, qualityScore }, null, qualityScore, TRACKING_FILTER_ACTION.accept, {
      distanceFromPreviousMeters: 0,
      timeFromPreviousMs: 0,
      calculatedSpeedMps: 0,
      bearingFromPrevious: null,
    });
  }

  const distanceFromPreviousMeters = calculateDistanceMeters(last, point);
  const timeFromPreviousMs = point.timestamp - last.timestamp;

  if (!Number.isFinite(timeFromPreviousMs) || timeFromPreviousMs < 0) {
    return result(false, point, TRACKING_REJECT_REASON.out_of_order, qualityScore, TRACKING_FILTER_ACTION.reject, {
      distanceFromPreviousMeters,
      timeFromPreviousMs,
      calculatedSpeedMps: 0,
      bearingFromPrevious: null,
      accelerationMps2: 0,
    });
  }

  const calculatedSpeedMps = calculateSpeedMps(last, point);
  const bearingFromPrevious = calculateBearing(last, point);
  const previousSpeedMps = Number.isFinite(Number(state.previousSpeedMps))
    ? Number(state.previousSpeedMps)
    : prev
      ? calculateSpeedMps(prev, last)
      : calculatedSpeedMps;
  const acceleration = timeFromPreviousMs > 0
    ? Math.abs(calculatedSpeedMps - previousSpeedMps) / (timeFromPreviousMs / 1000)
    : 0;

  const meta = {
    distanceFromPreviousMeters,
    timeFromPreviousMs,
    calculatedSpeedMps,
    bearingFromPrevious,
    accelerationMps2: acceleration,
  };

  if (isDuplicate(last, point, distanceFromPreviousMeters, timeFromPreviousMs)) {
    return result(false, point, TRACKING_REJECT_REASON.duplicate_point, qualityScore, TRACKING_FILTER_ACTION.ignore, meta);
  }

  if (hasAccuracy && accuracy > preset.softMaxAccuracyMeters) {
    return result(false, point, TRACKING_REJECT_REASON.bad_accuracy, qualityScore, TRACKING_FILTER_ACTION.reject, meta);
  }

  if (timeFromPreviousMs < preset.minTimeMs && distanceFromPreviousMeters < preset.minDistanceMeters * 2) {
    return result(false, point, TRACKING_REJECT_REASON.too_close, qualityScore, TRACKING_FILTER_ACTION.ignore, meta);
  }

  if (
    distanceFromPreviousMeters < preset.stationaryDistanceMeters ||
    (distanceFromPreviousMeters < preset.minDistanceMeters && calculatedSpeedMps < 1.2)
  ) {
    return result(false, point, TRACKING_REJECT_REASON.too_close, qualityScore, TRACKING_FILTER_ACTION.ignore, meta);
  }

  if (distanceFromPreviousMeters > 35 && calculatedSpeedMps > preset.hardMaxSpeedMps) {
    return result(false, point, TRACKING_REJECT_REASON.gps_jump, qualityScore, TRACKING_FILTER_ACTION.reject, meta);
  }

  if (calculatedSpeedMps > preset.hardMaxSpeedMps) {
    return result(false, point, TRACKING_REJECT_REASON.too_fast, qualityScore, TRACKING_FILTER_ACTION.reject, meta);
  }

  if (calculatedSpeedMps > preset.maxSpeedMps) {
    const excellentAccuracy = hasAccuracy && accuracy <= preset.quality.excellentAccuracyMeters;
    if (!excellentAccuracy || acceleration > preset.maxAccelerationMps2) {
      return result(false, point, TRACKING_REJECT_REASON.too_fast, qualityScore, TRACKING_FILTER_ACTION.reject, meta);
    }
    qualityScore -= 14;
  }

  if (acceleration > preset.maxAccelerationMps2 && distanceFromPreviousMeters > preset.minUsefulDistanceMeters * 2) {
    return result(false, point, TRACKING_REJECT_REASON.too_much_acceleration, qualityScore, TRACKING_FILTER_ACTION.reject, meta);
  }

  if (shouldRemovePreviousAsZigzag(path, point, preset)) {
    return result(true, { ...point, accepted: true, qualityScore }, TRACKING_REJECT_REASON.short_zigzag, qualityScore, TRACKING_FILTER_ACTION.replace_previous, meta);
  }

  if (isShortZigzagCurrent(path, point, preset)) {
    return result(false, point, TRACKING_REJECT_REASON.short_zigzag, qualityScore, TRACKING_FILTER_ACTION.reject, meta);
  }

  return result(true, { ...point, accepted: true, qualityScore }, null, qualityScore, TRACKING_FILTER_ACTION.accept, meta);
}

export default {
  normalizeLocationPoint,
  shouldAcceptPoint,
};
