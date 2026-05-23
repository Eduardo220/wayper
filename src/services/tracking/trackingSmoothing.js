import { getTrackingPreset } from "./trackingConfig.js";
import {
  calculateBearing,
  calculateBearingDelta,
  calculateDistanceMeters,
  clamp,
  interpolatePoint,
  isValidCoordinate,
  lerp,
  normalizeBearing,
} from "./trackingMath.js";

const toNumber = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function smoothHeading(previousHeading, nextHeading, alpha = 0.35) {
  const prev = normalizeBearing(previousHeading);
  const next = normalizeBearing(nextHeading);
  if (next == null) return prev;
  if (prev == null) return next;
  const delta = ((next - prev + 540) % 360) - 180;
  return normalizeBearing(prev + delta * clamp(alpha, 0, 1));
}

export function smoothCurrentPosition(previousSmoothedPoint, newTrustedPoint, presetInput = "run") {
  const preset = getTrackingPreset(presetInput);
  if (!isValidCoordinate(newTrustedPoint)) return previousSmoothedPoint || null;
  if (!isValidCoordinate(previousSmoothedPoint)) return { ...newTrustedPoint, source: "smoothed" };

  const distance = calculateDistanceMeters(previousSmoothedPoint, newTrustedPoint);
  if (distance > 80) return { ...newTrustedPoint, source: "smoothed" };

  const smoothing = preset.currentPositionSmoothing || {};
  const minAlpha = smoothing.minAlpha ?? 0.18;
  const maxAlpha = smoothing.maxAlpha ?? 0.55;
  const speed = Math.max(0, toNumber(newTrustedPoint.calculatedSpeedMps ?? newTrustedPoint.speed, 0));
  const accuracy = toNumber(newTrustedPoint.accuracy, preset.softMaxAccuracyMeters);

  const speedFactor = smoothing.speedWeight === false ? 0.25 : clamp(speed / preset.maxSpeedMps, 0, 1);
  const accuracyFactor = smoothing.accuracyWeight === false
    ? 0.5
    : clamp(1 - ((accuracy - preset.quality.excellentAccuracyMeters) / Math.max(1, preset.hardMaxAccuracyMeters)), 0, 1);
  const alpha = clamp(minAlpha + speedFactor * 0.28 + accuracyFactor * 0.16, minAlpha, maxAlpha);
  const gpsHeading = toNumber(newTrustedPoint.heading);
  const fallbackHeading = distance > 1.5 ? calculateBearing(previousSmoothedPoint, newTrustedPoint) : previousSmoothedPoint.heading;

  return {
    ...newTrustedPoint,
    latitude: lerp(previousSmoothedPoint.latitude, newTrustedPoint.latitude, alpha),
    longitude: lerp(previousSmoothedPoint.longitude, newTrustedPoint.longitude, alpha),
    heading: smoothHeading(previousSmoothedPoint.heading, gpsHeading ?? fallbackHeading, alpha),
    source: "smoothed",
  };
}

export function smoothPathMovingAverage(path = [], options = {}) {
  const points = Array.isArray(path) ? path.filter(isValidCoordinate) : [];
  const strength = clamp(options.strength ?? 0.25, 0, 0.75);
  if (points.length < 3 || strength <= 0) return points.map((point) => ({ ...point }));

  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return { ...point };
    const prev = points[index - 1];
    const next = points[index + 1];
    const before = calculateDistanceMeters(prev, point);
    const after = calculateDistanceMeters(point, next);
    if (before > 65 || after > 65) return { ...point };
    return {
      ...point,
      latitude: point.latitude * (1 - strength) + ((prev.latitude + next.latitude) / 2) * strength,
      longitude: point.longitude * (1 - strength) + ((prev.longitude + next.longitude) / 2) * strength,
      source: point.source || "render",
    };
  });
}

export function smoothPathChaikin(path = [], options = {}) {
  const points = Array.isArray(path) ? path.filter(isValidCoordinate) : [];
  const strength = clamp(options.strength ?? 0.35, 0.05, 0.48);
  const iterations = Math.max(1, Math.min(2, Number(options.iterations || 1)));
  if (points.length < 3) return points.map((point) => ({ ...point }));

  let output = points.map((point) => ({ ...point }));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = [output[0]];
    for (let i = 0; i < output.length - 1; i += 1) {
      const a = output[i];
      const b = output[i + 1];
      const distance = calculateDistanceMeters(a, b);
      if (distance > 85) {
        next.push(b);
        continue;
      }
      next.push(interpolatePoint(a, b, strength));
      next.push(interpolatePoint(a, b, 1 - strength));
    }
    next.push(output[output.length - 1]);
    output = next.filter(Boolean);
  }

  return output;
}

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    ...p1,
    latitude: 0.5 * (
      2 * p1.latitude +
      (-p0.latitude + p2.latitude) * t +
      (2 * p0.latitude - 5 * p1.latitude + 4 * p2.latitude - p3.latitude) * t2 +
      (-p0.latitude + 3 * p1.latitude - 3 * p2.latitude + p3.latitude) * t3
    ),
    longitude: 0.5 * (
      2 * p1.longitude +
      (-p0.longitude + p2.longitude) * t +
      (2 * p0.longitude - 5 * p1.longitude + 4 * p2.longitude - p3.longitude) * t2 +
      (-p0.longitude + 3 * p1.longitude - 3 * p2.longitude + p3.longitude) * t3
    ),
    source: "render",
  };
}

export function smoothPathCatmullRom(path = [], options = {}) {
  const points = Array.isArray(path) ? path.filter(isValidCoordinate) : [];
  const samplesPerSegment = Math.max(2, Math.min(6, Number(options.samplesPerSegment || 3)));
  if (points.length < 6) return points.map((point) => ({ ...point }));

  const output = [points[0]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    if (calculateDistanceMeters(p1, p2) > 75) {
      output.push(p2);
      continue;
    }

    for (let sample = 1; sample <= samplesPerSegment; sample += 1) {
      output.push(catmullRomPoint(p0, p1, p2, p3, sample / samplesPerSegment));
    }
  }

  const last = points[points.length - 1];
  const outLast = output[output.length - 1];
  if (calculateDistanceMeters(outLast, last) > 0.2) output.push(last);
  return output.filter(isValidCoordinate);
}

export function preventCornerOvercut(renderPath = [], trustedPath = [], options = {}) {
  const render = Array.isArray(renderPath) ? renderPath.filter(isValidCoordinate) : [];
  const trusted = Array.isArray(trustedPath) ? trustedPath.filter(isValidCoordinate) : [];
  const maxDistance = Math.max(1, Number(options.maxVisualCornerCutMeters || 8));
  if (render.length < 3 || trusted.length < 2) return render;

  return render.map((point, index) => {
    if (index === 0) return { ...trusted[0], ...point, latitude: trusted[0].latitude, longitude: trusted[0].longitude };
    if (index === render.length - 1) {
      const last = trusted[trusted.length - 1];
      return { ...point, latitude: last.latitude, longitude: last.longitude };
    }

    let nearest = trusted[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of trusted) {
      const distance = calculateDistanceMeters(point, candidate);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }

    if (nearestDistance <= maxDistance) return point;
    const ratio = maxDistance / Math.max(maxDistance, nearestDistance);
    return {
      ...point,
      latitude: nearest.latitude + (point.latitude - nearest.latitude) * ratio,
      longitude: nearest.longitude + (point.longitude - nearest.longitude) * ratio,
    };
  });
}

export function isHeadingStable(previousHeading, nextHeading, maxDelta = 75) {
  const prev = normalizeBearing(previousHeading);
  const next = normalizeBearing(nextHeading);
  if (prev == null || next == null) return false;
  return calculateBearingDelta(prev, next) <= maxDelta;
}

export default {
  isHeadingStable,
  preventCornerOvercut,
  smoothCurrentPosition,
  smoothHeading,
  smoothPathCatmullRom,
  smoothPathChaikin,
  smoothPathMovingAverage,
};
