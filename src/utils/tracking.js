export const TRACKING_CONFIG = {
  GPS_ACCURACY_IDEAL_M: 20,
  GPS_ACCURACY_MAX_M: 35,
  GPS_ACCURACY_HARD_REJECT_M: 50,

  MIN_DISTANCE_WHEN_STILL_M: 4,
  MIN_DISTANCE_WALKING_M: 3,
  MIN_DISTANCE_RUNNING_M: 5,

  MAX_REASONABLE_SPEED_KMH: 35,
  MAX_HUMAN_SPRINT_SPEED_KMH: 45,
  TELEPORT_DISTANCE_M: 80,
  TELEPORT_TIME_WINDOW_MS: 8000,

  MIN_TIME_BETWEEN_ACCEPTED_POINTS_MS: 700,
  MAX_STALE_LOCATION_AGE_MS: 15000,

  BACKTRACKING_DISTANCE_M: 12,
  BACKTRACKING_ANGLE_DEG: 140,

  SMOOTHING_MIN_ALPHA: 0.25,
  SMOOTHING_MAX_ALPHA: 0.65,

  DISPLAY_PATH_MAX_POINTS: 2500,
  DEBUG_TRACKING: typeof __DEV__ !== "undefined" && __DEV__,
};

const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const toNumber = (value, fallback = NaN) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeTimestamp = (value) => {
  const timestamp = toNumber(value, NaN);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
};

const normalizeOptionalNumber = (value) => {
  const number = toNumber(value, NaN);
  return Number.isFinite(number) ? number : null;
};

export function debugTracking(label, payload = {}, config = TRACKING_CONFIG) {
  if (!config.DEBUG_TRACKING) return;
  console.log(`[WayperTracking:${label}]`, payload);
}

export function isValidCoordinate(point) {
  const latitude = toNumber(point?.latitude, NaN);
  const longitude = toNumber(point?.longitude, NaN);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function normalizePathPoint(point, fallbackTimestamp = Date.now()) {
  if (!point) return null;

  let latitude;
  let longitude;

  if (Array.isArray(point)) {
    const first = toNumber(point[0], NaN);
    const second = toNumber(point[1], NaN);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

    if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
      longitude = first;
      latitude = second;
    } else {
      latitude = first;
      longitude = second;
    }
  } else {
    latitude = toNumber(point.latitude ?? point.lat ?? point.coords?.latitude, NaN);
    longitude = toNumber(point.longitude ?? point.lon ?? point.lng ?? point.coords?.longitude, NaN);
  }

  const normalized = {
    latitude,
    longitude,
    timestamp: normalizeTimestamp(point.timestamp ?? point.time ?? point.t ?? fallbackTimestamp),
    accuracy: normalizeOptionalNumber(point.accuracy ?? point.coords?.accuracy),
    speed: normalizeOptionalNumber(point.speed ?? point.coords?.speed),
    heading: normalizeOptionalNumber(point.heading ?? point.coords?.heading),
    altitude: normalizeOptionalNumber(point.altitude ?? point.coords?.altitude),
    source: point.source || "gps",
    segmentId: Number.isFinite(Number(point.segmentId)) ? Number(point.segmentId) : 0,
  };

  return isValidCoordinate(normalized) ? normalized : null;
}

export function normalizeLocation(location) {
  const source = location?.source || "gps";
  const point = normalizePathPoint(
    location?.coords
      ? {
          ...location.coords,
          timestamp: location.timestamp,
          source,
        }
      : location,
    Date.now()
  );

  return point ? { ...point, source } : null;
}

export function sanitizeRunPath(path = []) {
  if (!Array.isArray(path)) return [];

  const out = [];
  for (const point of path) {
    const normalized = normalizePathPoint(point);
    if (!normalized) continue;
    const previous = out[out.length - 1];
    if (previous && isDuplicatePoint(previous, normalized)) continue;
    if (previous && normalized.timestamp < previous.timestamp) continue;
    out.push(normalized);
  }

  return out;
}

export function calculateDistanceMeters(a, b) {
  if (!isValidCoordinate(a) || !isValidCoordinate(b)) return 0;

  const lat1 = a.latitude * DEG_TO_RAD;
  const lat2 = b.latitude * DEG_TO_RAD;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function calculateBearingDegrees(a, b) {
  if (!isValidCoordinate(a) || !isValidCoordinate(b)) return null;

  const lat1 = a.latitude * DEG_TO_RAD;
  const lat2 = b.latitude * DEG_TO_RAD;
  const dLon = (b.longitude - a.longitude) * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * RAD_TO_DEG) + 360) % 360;
}

export function calculateSpeedKmh(a, b) {
  const dtMs = toNumber(b?.timestamp, 0) - toNumber(a?.timestamp, 0);
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
  return (calculateDistanceMeters(a, b) / (dtMs / 1000)) * 3.6;
}

function angleDeltaDegrees(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.abs(((b - a + 540) % 360) - 180);
}

export function isAccuracyAcceptable(point, context = {}) {
  const config = context.config || TRACKING_CONFIG;
  const accuracy = normalizeOptionalNumber(point?.accuracy);
  if (accuracy == null) return context.allowMissingAccuracy !== false;
  return accuracy <= config.GPS_ACCURACY_HARD_REJECT_M;
}

export function isDuplicatePoint(prev, next) {
  if (!prev || !next) return false;
  const distanceM = calculateDistanceMeters(prev, next);
  const dtMs = Math.abs(toNumber(next.timestamp, 0) - toNumber(prev.timestamp, 0));
  return distanceM < 0.75 || (distanceM < 1.2 && dtMs < 1200);
}

export function getMinAppendDistanceMeters(speedKmh = 0, accuracy = 0, config = TRACKING_CONFIG) {
  const speed = Number.isFinite(Number(speedKmh)) ? Number(speedKmh) : 0;
  const accuracyValue = Number.isFinite(Number(accuracy)) ? Number(accuracy) : config.GPS_ACCURACY_MAX_M;
  let base = config.MIN_DISTANCE_RUNNING_M;

  if (speed < 1) base = config.MIN_DISTANCE_WHEN_STILL_M + 2;
  else if (speed < 7) base = config.MIN_DISTANCE_WALKING_M;
  else if (speed < 15) base = 4;

  if (accuracyValue > config.GPS_ACCURACY_MAX_M) base += 3;
  else if (accuracyValue > config.GPS_ACCURACY_IDEAL_M) base += 1.5;

  return base;
}

export function isTooCloseToAppend(prev, next, context = {}) {
  if (!prev || !next) return false;
  const config = context.config || TRACKING_CONFIG;
  const distanceM = context.distanceM ?? calculateDistanceMeters(prev, next);
  const speedKmh = context.speedKmh ?? calculateSpeedKmh(prev, next);
  const accuracy = next.accuracy ?? prev.accuracy ?? config.GPS_ACCURACY_MAX_M;
  return distanceM < getMinAppendDistanceMeters(speedKmh, accuracy, config);
}

export function isLikelyGpsJump(prev, next, context = {}) {
  if (!prev || !next) return false;
  const config = context.config || TRACKING_CONFIG;
  const distanceM = context.distanceM ?? calculateDistanceMeters(prev, next);
  const dtMs = context.dtMs ?? next.timestamp - prev.timestamp;
  const speedKmh = context.speedKmh ?? calculateSpeedKmh(prev, next);
  const accuracy = Math.max(toNumber(prev.accuracy, 0), toNumber(next.accuracy, 0));

  if (distanceM >= config.TELEPORT_DISTANCE_M && dtMs <= config.TELEPORT_TIME_WINDOW_MS) return true;
  if (distanceM > 20 && speedKmh > config.MAX_HUMAN_SPRINT_SPEED_KMH) return true;
  if (distanceM > 35 && speedKmh > config.MAX_REASONABLE_SPEED_KMH && accuracy > config.GPS_ACCURACY_IDEAL_M) return true;
  return false;
}

export function isLikelyBacktrackingNoise(path = [], next, context = {}) {
  const config = context.config || TRACKING_CONFIG;
  if (!Array.isArray(path) || path.length < 3 || !next) return false;

  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  const beforePrev = path[path.length - 3];
  const distanceFromLast = context.distanceM ?? calculateDistanceMeters(last, next);
  const distanceToPrev = calculateDistanceMeters(prev, next);
  const distanceToBeforePrev = calculateDistanceMeters(beforePrev, next);
  const bearingIn = calculateBearingDegrees(prev, last);
  const bearingOut = calculateBearingDegrees(last, next);
  const turn = angleDeltaDegrees(bearingIn, bearingOut);
  const nextAccuracy = toNumber(next.accuracy, config.GPS_ACCURACY_MAX_M);
  const lastAccuracy = toNumber(last.accuracy, config.GPS_ACCURACY_MAX_M);

  if (
    turn >= config.BACKTRACKING_ANGLE_DEG &&
    distanceFromLast <= config.BACKTRACKING_DISTANCE_M &&
    (distanceToPrev <= config.BACKTRACKING_DISTANCE_M || distanceToBeforePrev <= config.BACKTRACKING_DISTANCE_M) &&
    nextAccuracy >= lastAccuracy
  ) {
    return true;
  }

  return false;
}

export function shouldAppendLocationPoint(path = [], next, context = {}) {
  const config = context.config || TRACKING_CONFIG;
  const last = Array.isArray(path) && path.length > 0 ? path[path.length - 1] : null;
  const now = context.now || Date.now();

  if (!next || !isValidCoordinate(next)) {
    return { accepted: false, reason: "invalid_coordinate" };
  }

  if (!context.ignoreStale && now - next.timestamp > config.MAX_STALE_LOCATION_AGE_MS) {
    return { accepted: false, reason: "stale_location" };
  }

  if (!isAccuracyAcceptable(next, context)) {
    return { accepted: false, reason: "bad_accuracy", accuracy: next.accuracy };
  }

  if (!last) {
    return { accepted: true, reason: "first_point", distanceM: 0, speedKmh: 0, segmentBreak: Boolean(context.forceSegmentBreak) };
  }

  const dtMs = next.timestamp - last.timestamp;
  if (!Number.isFinite(dtMs) || dtMs < 0) {
    return { accepted: false, reason: "out_of_order" };
  }

  const distanceM = calculateDistanceMeters(last, next);
  const speedKmh = calculateSpeedKmh(last, next);

  if (isDuplicatePoint(last, next)) {
    return { accepted: false, reason: "duplicate", distanceM, speedKmh };
  }

  if (dtMs < config.MIN_TIME_BETWEEN_ACCEPTED_POINTS_MS && distanceM < 15) {
    return { accepted: false, reason: "too_frequent", distanceM, speedKmh };
  }

  const segmentBreak = Boolean(context.forceSegmentBreak) ||
    (dtMs > config.MAX_STALE_LOCATION_AGE_MS && distanceM > config.TELEPORT_DISTANCE_M / 2);

  if (!segmentBreak && isLikelyGpsJump(last, next, { ...context, distanceM, dtMs, speedKmh })) {
    return { accepted: false, reason: "gps_jump", distanceM, dtMs, speedKmh, pending: true };
  }

  if (!segmentBreak && isTooCloseToAppend(last, next, { ...context, distanceM, speedKmh })) {
    return { accepted: false, reason: "too_close", distanceM, speedKmh };
  }

  if (!segmentBreak && isLikelyBacktrackingNoise(path, next, { ...context, distanceM, speedKmh })) {
    return { accepted: false, reason: "backtracking_noise", distanceM, speedKmh };
  }

  return { accepted: true, reason: segmentBreak ? "segment_break" : "accepted", distanceM, speedKmh, segmentBreak };
}

export function smoothLocationPoint(prevSmoothed, nextValidated, context = {}) {
  if (!nextValidated) return null;
  if (!prevSmoothed) return { ...nextValidated, source: "smoothed" };

  const config = context.config || TRACKING_CONFIG;
  const distanceM = calculateDistanceMeters(prevSmoothed, nextValidated);
  if (distanceM > config.TELEPORT_DISTANCE_M || context.segmentBreak) {
    return { ...nextValidated, source: "smoothed" };
  }

  const speedKmh = context.speedKmh ?? calculateSpeedKmh(prevSmoothed, nextValidated);
  const accuracy = toNumber(nextValidated.accuracy, config.GPS_ACCURACY_MAX_M);
  const speedFactor = Math.min(1, Math.max(0, speedKmh / 16));
  const accuracyFactor = accuracy <= config.GPS_ACCURACY_IDEAL_M ? 1 : Math.max(0, 1 - (accuracy - config.GPS_ACCURACY_IDEAL_M) / 35);
  const alpha = Math.max(
    config.SMOOTHING_MIN_ALPHA,
    Math.min(config.SMOOTHING_MAX_ALPHA, 0.28 + speedFactor * 0.25 + accuracyFactor * 0.18)
  );

  return {
    ...nextValidated,
    latitude: prevSmoothed.latitude + (nextValidated.latitude - prevSmoothed.latitude) * alpha,
    longitude: prevSmoothed.longitude + (nextValidated.longitude - prevSmoothed.longitude) * alpha,
    accuracy: nextValidated.accuracy,
    source: "smoothed",
  };
}

export function smoothDisplayPath(savedPath = [], context = {}) {
  const clean = sanitizeRunPath(savedPath);
  if (clean.length <= 2) return clean.map((point) => ({ ...point, source: "smoothed" }));

  return clean.map((point, index) => {
    if (index === 0 || index === clean.length - 1) return { ...point, source: "smoothed" };

    const prev = clean[index - 1];
    const next = clean[index + 1];
    if (prev.segmentId !== point.segmentId || next.segmentId !== point.segmentId) {
      return { ...point, source: "smoothed" };
    }

    const before = calculateDistanceMeters(prev, point);
    const after = calculateDistanceMeters(point, next);
    if (before > 45 || after > 45 || before < 1.5 || after < 1.5) {
      return { ...point, source: "smoothed" };
    }

    const bearingIn = calculateBearingDegrees(prev, point);
    const bearingOut = calculateBearingDegrees(point, next);
    const turn = angleDeltaDegrees(bearingIn, bearingOut);
    if (turn > 32) return { ...point, source: "smoothed" };

    return {
      ...point,
      latitude: point.latitude * 0.72 + (prev.latitude + next.latitude) * 0.14,
      longitude: point.longitude * 0.72 + (prev.longitude + next.longitude) * 0.14,
      source: "smoothed",
    };
  });
}

export function removePathOutliers(path = [], config = TRACKING_CONFIG) {
  const clean = sanitizeRunPath(path);
  if (clean.length <= 2) return clean;

  const out = [clean[0]];
  for (let i = 1; i < clean.length; i += 1) {
    const verdict = shouldAppendLocationPoint(out, clean[i], {
      config,
      ignoreStale: true,
      allowMissingAccuracy: true,
      now: clean[i].timestamp,
      forceSegmentBreak: clean[i].segmentId !== out[out.length - 1]?.segmentId,
    });
    if (verdict.accepted) out.push(clean[i]);
  }

  return out;
}

export function limitPathForRendering(path = [], maxPoints = TRACKING_CONFIG.DISPLAY_PATH_MAX_POINTS) {
  if (!Array.isArray(path) || path.length <= maxPoints) return Array.isArray(path) ? path : [];

  const step = Math.ceil(path.length / maxPoints);
  return path.filter((_, index) => index === 0 || index === path.length - 1 || index % step === 0);
}

export function splitPathIntoSegments(path = []) {
  const clean = sanitizeRunPath(path);
  if (clean.length === 0) return [];

  const segments = [];
  let current = [];

  for (const point of clean) {
    const last = current[current.length - 1];
    const segmentChanged = last && point.segmentId !== last.segmentId;

    if (current.length > 0 && segmentChanged) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }

    current.push(point);
  }

  if (current.length >= 2) segments.push(current);
  return segments;
}

export default {
  TRACKING_CONFIG,
  isValidCoordinate,
  normalizeLocation,
  normalizePathPoint,
  calculateDistanceMeters,
  calculateBearingDegrees,
  calculateSpeedKmh,
  isAccuracyAcceptable,
  isDuplicatePoint,
  isTooCloseToAppend,
  isLikelyGpsJump,
  isLikelyBacktrackingNoise,
  shouldAppendLocationPoint,
  smoothLocationPoint,
  smoothDisplayPath,
  sanitizeRunPath,
  removePathOutliers,
  limitPathForRendering,
  splitPathIntoSegments,
};
