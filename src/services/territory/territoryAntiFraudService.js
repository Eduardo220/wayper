import { TERRITORY_CONFIG } from "./territoryConfig.js";
import { TERRITORY_CAPTURE_FAILURE } from "./territoryTypes.js";
import {
  buildCaptureGeometryFromPath,
  calculateDistanceMeters,
  sanitizePathForTerritory,
} from "./territoryGeometryService.js";

export const TERRITORY_ANTI_FRAUD_CONFIG = {
  minPoints: TERRITORY_CONFIG.minLoopPoints,
  minDurationSeconds: 45,
  minDistanceMeters: 80,
  maxAccuracyM: TERRITORY_CONFIG.maxAccuracyM,
  maxSpeedMps: TERRITORY_CONFIG.maxSpeedMps,
  maxJumpM: TERRITORY_CONFIG.maxJumpM,
  maxAreaM2: TERRITORY_CONFIG.maxAreaM2,
  maxBadAccuracyRatio: 0.35,
  suspiciousThreshold: 65,
};

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toTimestampMs = (value) => {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const number = Number(value);
  if (Number.isFinite(number)) return number < 10_000_000_000 ? number * 1000 : number;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

function calculatePathDistance(path = []) {
  let distance = 0;
  for (let i = 1; i < path.length; i += 1) {
    distance += calculateDistanceMeters(path[i - 1], path[i]);
  }
  return distance;
}

function calculatePathDurationSeconds(path = []) {
  const timestamps = path
    .map((point) => toTimestampMs(point?.timestamp))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (timestamps.length < 2) return 0;
  return Math.max(0, (timestamps[timestamps.length - 1] - timestamps[0]) / 1000);
}

function inspectGpsQuality(rawPath = [], sanitizedPath = [], config) {
  let maxJumpM = 0;
  let maxSegmentSpeedMps = 0;
  let maxReportedSpeedMps = 0;
  let badAccuracyCount = 0;
  let accuracyCount = 0;

  for (const point of rawPath) {
    const accuracy = Number(point?.accuracy);
    if (Number.isFinite(accuracy)) {
      accuracyCount += 1;
      if (accuracy > config.maxAccuracyM) badAccuracyCount += 1;
    }

    const speed = Number(point?.speed);
    if (Number.isFinite(speed)) maxReportedSpeedMps = Math.max(maxReportedSpeedMps, speed);
  }

  for (let i = 1; i < sanitizedPath.length; i += 1) {
    const previous = sanitizedPath[i - 1];
    const current = sanitizedPath[i];
    const jump = calculateDistanceMeters(previous, current);
    maxJumpM = Math.max(maxJumpM, jump);

    const previousTs = toTimestampMs(previous.timestamp);
    const currentTs = toTimestampMs(current.timestamp);
    const deltaSeconds = previousTs != null && currentTs != null ? Math.max(0, (currentTs - previousTs) / 1000) : 0;
    if (deltaSeconds > 0) {
      maxSegmentSpeedMps = Math.max(maxSegmentSpeedMps, jump / deltaSeconds);
    }
  }

  return {
    accuracyCount,
    badAccuracyCount,
    badAccuracyRatio: accuracyCount > 0 ? badAccuracyCount / accuracyCount : 0,
    maxJumpM,
    maxReportedSpeedMps,
    maxSegmentSpeedMps,
  };
}

function fail(reason, suspiciousScore, details = {}) {
  return {
    ok: false,
    reason,
    suspiciousScore: Math.min(100, Math.max(0, Math.round(suspiciousScore))),
    details: {
      ...details,
      suspicious: true,
    },
  };
}

export function validateRunForTerritoryCapture(path = [], options = {}) {
  const config = {
    ...TERRITORY_ANTI_FRAUD_CONFIG,
    ...(options.config || {}),
    ...options,
  };

  const rawPath = Array.isArray(path) ? path : [];
  const rawValidPath = sanitizePathForTerritory(rawPath, {
    ...config,
    maxAccuracyM: Number.POSITIVE_INFINITY,
    maxJumpM: Number.POSITIVE_INFINITY,
    maxSpeedMps: Number.POSITIVE_INFINITY,
  });
  const sanitizedPath = sanitizePathForTerritory(rawPath, config);
  const pointCount = sanitizedPath.length;
  const durationSeconds = toNumber(options.durationSeconds, calculatePathDurationSeconds(sanitizedPath));
  const distanceMeters = toNumber(options.distanceMeters, calculatePathDistance(sanitizedPath));
  const gps = inspectGpsQuality(rawPath, rawValidPath, config);

  let suspiciousScore = 0;
  if (durationSeconds < config.minDurationSeconds) suspiciousScore += 25;
  if (distanceMeters < config.minDistanceMeters) suspiciousScore += 25;
  if (gps.badAccuracyRatio > config.maxBadAccuracyRatio) suspiciousScore += 30;
  if (gps.maxReportedSpeedMps > config.maxSpeedMps || gps.maxSegmentSpeedMps > config.maxSpeedMps) suspiciousScore += 45;
  if (gps.maxJumpM > config.maxJumpM) suspiciousScore += 35;

  const baseDetails = {
    pointCount,
    durationSeconds,
    distanceMeters,
    ...gps,
  };

  if (gps.badAccuracyRatio > config.maxBadAccuracyRatio) {
    return fail("bad_accuracy", suspiciousScore, {
      ...baseDetails,
      maxAccuracyM: config.maxAccuracyM,
      maxBadAccuracyRatio: config.maxBadAccuracyRatio,
    });
  }

  if (gps.maxJumpM > config.maxJumpM) {
    return fail("gps_jump", suspiciousScore, {
      ...baseDetails,
      maxJumpM: config.maxJumpM,
    });
  }

  if (gps.maxReportedSpeedMps > config.maxSpeedMps || gps.maxSegmentSpeedMps > config.maxSpeedMps) {
    return fail("impossible_speed", suspiciousScore, {
      ...baseDetails,
      maxSpeedMps: config.maxSpeedMps,
    });
  }

  if (pointCount < config.minPoints) {
    return fail(TERRITORY_CAPTURE_FAILURE.not_enough_points, 30, {
      ...baseDetails,
      minPoints: config.minPoints,
    });
  }

  if (durationSeconds < config.minDurationSeconds) {
    return fail("duration_too_short", suspiciousScore, {
      ...baseDetails,
      minDurationSeconds: config.minDurationSeconds,
    });
  }

  if (distanceMeters < config.minDistanceMeters) {
    return fail("distance_too_short", suspiciousScore, {
      ...baseDetails,
      minDistanceMeters: config.minDistanceMeters,
    });
  }

  const capture = buildCaptureGeometryFromPath(sanitizedPath, config);
  if (!capture.ok && capture.reason === TERRITORY_CAPTURE_FAILURE.area_too_large) {
    return fail(TERRITORY_CAPTURE_FAILURE.area_too_large, suspiciousScore + 30, {
      ...baseDetails,
      areaM2: capture.details?.areaM2,
      maxAreaM2: config.maxAreaM2,
    });
  }

  if (capture.ok && capture.areaM2 > config.maxAreaM2) {
    return fail(TERRITORY_CAPTURE_FAILURE.area_too_large, suspiciousScore + 30, {
      ...baseDetails,
      areaM2: capture.areaM2,
      maxAreaM2: config.maxAreaM2,
    });
  }

  if (suspiciousScore >= config.suspiciousThreshold) {
    return fail(TERRITORY_CAPTURE_FAILURE.suspicious_activity, suspiciousScore, baseDetails);
  }

  return {
    ok: true,
    reason: null,
    suspiciousScore: Math.max(0, Math.round(suspiciousScore)),
    details: baseDetails,
  };
}

export default {
  TERRITORY_ANTI_FRAUD_CONFIG,
  validateRunForTerritoryCapture,
};
