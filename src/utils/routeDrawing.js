const EARTH_RADIUS_M = 6371000;
const DEFAULT_MAX_RUNNING_SPEED_MPS = 10.5;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getTimestamp(point) {
  const ts = toNumber(point?.timestamp ?? point?.time ?? point?.t);
  return ts && ts > 0 ? ts : null;
}

function getAccuracy(point) {
  const accuracy = toNumber(point?.accuracy);
  return accuracy != null && accuracy >= 0 ? accuracy : null;
}

export function sanitizeRoutePath(path = []) {
  if (!Array.isArray(path)) return [];

  return path
    .map((point) => {
      if (!point) return null;
      const latitude = toNumber(point.latitude ?? point.lat);
      const longitude = toNumber(point.longitude ?? point.lon ?? point.lng);
      if (latitude == null || longitude == null) return null;
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

      const timestamp = getTimestamp(point);
      const accuracy = getAccuracy(point);
      return {
        ...point,
        latitude,
        longitude,
        ...(timestamp != null ? { timestamp } : {}),
        ...(accuracy != null ? { accuracy } : {}),
      };
    })
    .filter(Boolean);
}

function projectPoint(point, originLat) {
  const latRad = point.latitude * (Math.PI / 180);
  const lonRad = point.longitude * (Math.PI / 180);
  return {
    x: lonRad * EARTH_RADIUS_M * Math.cos(originLat),
    y: latRad * EARTH_RADIUS_M,
  };
}

function distanceMeters(a, b) {
  if (!a || !b) return 0;
  const lat1 = a.latitude * (Math.PI / 180);
  const lat2 = b.latitude * (Math.PI / 180);
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * (Math.PI / 180);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDegrees(a, b) {
  if (!a || !b) return null;

  const lat1 = a.latitude * (Math.PI / 180);
  const lat2 = b.latitude * (Math.PI / 180);
  const dLon = (b.longitude - a.longitude) * (Math.PI / 180);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;

  return (bearing + 360) % 360;
}

function turnDeltaDegrees(prev, current, next) {
  const a = bearingDegrees(prev, current);
  const b = bearingDegrees(current, next);
  if (a == null || b == null) return 0;
  return Math.abs(((b - a + 540) % 360) - 180);
}

function buildProtectedTurnMask(points, options = {}) {
  const {
    preserveTurns = true,
    minTurnAngleDeg = 28,
    minTurnSegmentM = 2.5,
  } = options;

  const protectedMask = new Uint8Array(points.length);
  if (!preserveTurns || points.length <= 3) return protectedMask;

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    const next = points[i + 1];
    const before = distanceMeters(prev, current);
    const after = distanceMeters(current, next);
    if (before < minTurnSegmentM || after < minTurnSegmentM) continue;

    const turn = turnDeltaDegrees(prev, current, next);
    if (turn >= minTurnAngleDeg) {
      protectedMask[i] = 1;
    }
  }

  return protectedMask;
}

function filterImplausiblePoints(points, options = {}) {
  const {
    maxAccuracyM = Number.POSITIVE_INFINITY,
    maxSpeedMps = DEFAULT_MAX_RUNNING_SPEED_MPS,
    maxSegmentDistanceM = 450,
  } = options;

  if (points.length <= 2) return points;

  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    const last = out[out.length - 1];
    const accuracy = getAccuracy(point);
    const distance = distanceMeters(last, point);

    if (!Number.isFinite(distance) || distance <= 0) continue;

    if (
      Number.isFinite(maxAccuracyM) &&
      accuracy != null &&
      accuracy > maxAccuracyM &&
      i < points.length - 1
    ) {
      continue;
    }

    const lastTs = getTimestamp(last);
    const ts = getTimestamp(point);
    const dtSec = lastTs && ts ? Math.max(0.25, (ts - lastTs) / 1000) : null;
    const speed = dtSec ? distance / dtSec : null;
    const accuracySlack = accuracy != null ? Math.min(2.5, accuracy / 25) : 0;

    if (
      speed != null &&
      distance > 8 &&
      Number.isFinite(maxSpeedMps) &&
      speed > maxSpeedMps + accuracySlack
    ) {
      continue;
    }

    if (
      Number.isFinite(maxSegmentDistanceM) &&
      distance > maxSegmentDistanceM &&
      Number.isFinite(maxSpeedMps) &&
      (speed == null || speed > maxSpeedMps + accuracySlack)
    ) {
      continue;
    }

    out.push(point);
  }

  return out.length >= 2 ? out : points.slice(0, 2);
}

function perpendicularDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return Math.hypot(point.x - x, point.y - y);
}

function removeNearDuplicates(points, minDistanceM) {
  if (points.length <= 2 || minDistanceM <= 0) return points;

  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (distanceMeters(out[out.length - 1], points[i]) >= minDistanceM) {
      out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function removeLineJitter(points, toleranceM, options = {}) {
  if (points.length <= 3 || toleranceM <= 0) return points;

  const originLat = points[0].latitude * (Math.PI / 180);
  const projected = points.map((point) => projectPoint(point, originLat));
  const protectedTurns = buildProtectedTurnMask(points, options);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  for (let i = 1; i < protectedTurns.length - 1; i += 1) {
    if (protectedTurns[i] === 1) keep[i] = 1;
  }

  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    let maxDistance = 0;
    let index = -1;

    for (let i = start + 1; i < end; i += 1) {
      const distance = perpendicularDistance(projected[i], projected[start], projected[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (index > -1 && maxDistance > toleranceM) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

function removeSinglePointSpikes(points, maxSpikeDistanceM) {
  if (points.length <= 3 || maxSpikeDistanceM <= 0) return points;

  const originLat = points[0].latitude * (Math.PI / 180);
  const projected = points.map((point) => projectPoint(point, originLat));
  const out = [points[0]];

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    const next = points[i + 1];
    const prevToCurrent = distanceMeters(prev, current);
    const currentToNext = distanceMeters(current, next);
    const prevToNext = distanceMeters(prev, next);
    const offLine = perpendicularDistance(projected[i], projected[i - 1], projected[i + 1]);

    const tinyDetour = prevToCurrent + currentToNext > prevToNext * 1.9 && offLine <= maxSpikeDistanceM;
    const closeZigZag = prevToCurrent <= maxSpikeDistanceM && currentToNext <= maxSpikeDistanceM && offLine <= maxSpikeDistanceM * 0.55;

    if (!tinyDetour && !closeZigZag) {
      out.push(current);
    }
  }

  out.push(points[points.length - 1]);
  return out;
}

function capPoints(points, maxPoints) {
  if (!Number.isFinite(maxPoints) || points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index === 0 || index === points.length - 1 || index % step === 0);
}

export function calculateRouteDistance(path = []) {
  const clean = sanitizeRoutePath(path);
  if (clean.length < 2) return 0;

  let total = 0;
  for (let i = 1; i < clean.length; i += 1) {
    total += distanceMeters(clean[i - 1], clean[i]);
  }

  return Number.isFinite(total) ? total : 0;
}

export function finalizeRoutePath(path = [], options = {}) {
  const {
    minPointDistanceM = 1.2,
    toleranceM = 2.2,
    spikeToleranceM = 7,
    maxPoints = 3000,
    maxAccuracyM = 70,
    maxSpeedMps = DEFAULT_MAX_RUNNING_SPEED_MPS,
    preserveTurns = true,
  } = options;

  const clean = sanitizeRoutePath(path);
  if (clean.length <= 3) return clean;

  const plausible = filterImplausiblePoints(clean, {
    maxAccuracyM,
    maxSpeedMps,
    maxSegmentDistanceM: 450,
  });
  const noDuplicates = removeNearDuplicates(plausible, minPointDistanceM);
  const noSpikes = removeSinglePointSpikes(noDuplicates, spikeToleranceM);
  const simplified = removeLineJitter(noSpikes, toleranceM, {
    preserveTurns,
    minTurnAngleDeg: 26,
    minTurnSegmentM: 2.5,
  });
  const capped = capPoints(simplified.length >= 2 ? simplified : noSpikes, maxPoints);

  return capped.length >= 2 ? capped : clean.slice(0, 2);
}

export function beautifyRoutePath(path = [], options = {}) {
  const {
    minPointDistanceM = 2,
    toleranceM = 6,
    spikeToleranceM = 10,
    maxPoints = 900,
    preserveTurns = true,
    maxAccuracyM = Number.POSITIVE_INFINITY,
    maxSpeedMps = Number.POSITIVE_INFINITY,
  } = options;

  const clean = sanitizeRoutePath(path);
  if (clean.length <= 3) return clean;

  const plausible = filterImplausiblePoints(clean, {
    maxAccuracyM,
    maxSpeedMps,
    maxSegmentDistanceM: 450,
  });
  const noDuplicates = removeNearDuplicates(plausible, minPointDistanceM);
  if (noDuplicates.length <= 3) return noDuplicates;

  const noSpikes = removeSinglePointSpikes(noDuplicates, spikeToleranceM);
  const simplified = removeLineJitter(noSpikes, toleranceM, {
    preserveTurns,
    minTurnAngleDeg: 26,
    minTurnSegmentM: 2.5,
  });
  const capped = capPoints(simplified.length >= 2 ? simplified : noSpikes, maxPoints);

  return capped.length >= 2 ? capped : clean.slice(0, 2);
}

export default {
  beautifyRoutePath,
  calculateRouteDistance,
  finalizeRoutePath,
  sanitizeRoutePath,
};
