import { getTrackingPreset, TRACKING_SMOOTHING_VERSION } from "./trackingConfig.js";
import {
  calculateDistanceMeters,
  calculatePathDistanceMeters,
  calculateTurnAngle,
  isValidCoordinate,
} from "./trackingMath.js";
import {
  preventCornerOvercut,
  smoothPathCatmullRom,
  smoothPathChaikin,
  smoothPathMovingAverage,
} from "./trackingSmoothing.js";

const cache = new Map();

function clonePoint(point) {
  return { ...point };
}

function normalizeSegmentPoint(point, segmentIndex) {
  return {
    ...point,
    segmentId: Number.isFinite(Number(point?.segmentId)) ? Number(point.segmentId) : segmentIndex,
  };
}

function cacheKey(kind, path = [], presetName = "run") {
  const last = path[path.length - 1] || {};
  return `${kind}:${presetName}:${path.length}:${last.timestamp || ""}:${last.latitude || ""}:${last.longitude || ""}:${TRACKING_SMOOTHING_VERSION}`;
}

export function removeDuplicateVisualPoints(path = [], minDistanceMeters = 0.85) {
  const points = (Array.isArray(path) ? path : []).filter(isValidCoordinate);
  if (points.length <= 2) return points.map(clonePoint);

  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (calculateDistanceMeters(out[out.length - 1], points[i]) >= minDistanceMeters) {
      out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function perpendicularDistanceMeters(point, start, end) {
  const total = calculateDistanceMeters(start, end);
  if (total <= 0) return calculateDistanceMeters(point, start);
  const a = calculateDistanceMeters(start, point);
  const b = calculateDistanceMeters(point, end);
  const s = (a + b + total) / 2;
  const area = Math.max(0, s * (s - a) * (s - b) * (s - total));
  return (2 * Math.sqrt(area)) / total;
}

export function simplifyPathByDistance(path = [], toleranceMeters = 2.5) {
  const points = (Array.isArray(path) ? path : []).filter(isValidCoordinate);
  if (points.length <= 3 || toleranceMeters <= 0) return points.map(clonePoint);

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  for (let i = 1; i < points.length - 1; i += 1) {
    const turn = calculateTurnAngle(points[i - 1], points[i], points[i + 1]);
    if (turn > 28) keep[i] = 1;
  }

  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    let maxDistance = 0;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const distance = perpendicularDistanceMeters(points[i], points[start], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (index > -1 && maxDistance > toleranceMeters) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

export function removeTinyBacktracks(path = [], presetInput = "run") {
  const preset = getTrackingPreset(presetInput);
  const points = (Array.isArray(path) ? path : []).filter(isValidCoordinate);
  if (points.length < 3) return points.map(clonePoint);

  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const ab = calculateDistanceMeters(a, b);
    const bc = calculateDistanceMeters(b, c);
    const angle = calculateTurnAngle(a, b, c);
    const bAccuracy = Number.isFinite(Number(b.accuracy)) ? Number(b.accuracy) : preset.softMaxAccuracyMeters;
    const cAccuracy = Number.isFinite(Number(c.accuracy)) ? Number(c.accuracy) : preset.softMaxAccuracyMeters;
    const shortBacktrack =
      ab < 15 &&
      bc < 15 &&
      angle > 120 &&
      bAccuracy >= Math.min(cAccuracy + 5, preset.zigzagMinAccuracyPenaltyMeters + 4);

    if (!shortBacktrack) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function validateRenderPath(renderPath = [], trustedPath = []) {
  const render = (Array.isArray(renderPath) ? renderPath : []).filter(isValidCoordinate);
  const trusted = (Array.isArray(trustedPath) ? trustedPath : []).filter(isValidCoordinate);
  if (trusted.length >= 2 && render.length < 2) return { ok: false, reason: "too_few_points" };
  if (render.some((point) => !Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude)))) {
    return { ok: false, reason: "nan" };
  }

  const trustedDistance = calculatePathDistanceMeters(trusted);
  const renderDistance = calculatePathDistanceMeters(render);
  if (trustedDistance > 30) {
    if (renderDistance > trustedDistance * 1.12) return { ok: false, reason: "distance_exploded" };
    if (renderDistance < trustedDistance * 0.82) return { ok: false, reason: "distance_collapsed" };
  }

  return { ok: true, reason: null };
}

function capRenderPoints(points = [], maxPoints = 1800) {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index === 0 || index === points.length - 1 || index % step === 0);
}

export function buildLiveRenderPath(trustedPath = [], options = {}) {
  const preset = getTrackingPreset(options.preset || "run");
  const points = (Array.isArray(trustedPath) ? trustedPath : []).filter(isValidCoordinate);
  if (points.length < 3) return points.map(clonePoint);

  const key = cacheKey("live", points, options.preset || "run");
  if (cache.has(key)) return cache.get(key).map(clonePoint);

  const last = points[points.length - 1];
  const deduped = removeDuplicateVisualPoints(points);
  const simplified = simplifyPathByDistance(deduped, preset.liveSimplifyToleranceMeters);
  const smoothed = deduped.length < 6
    ? smoothPathMovingAverage(simplified, { strength: preset.liveSmoothingStrength * 0.45 })
    : smoothPathMovingAverage(simplified, { strength: preset.liveSmoothingStrength });
  const protectedPath = preventCornerOvercut(smoothed, points, preset);
  const output = capRenderPoints(protectedPath, options.maxPoints || 2200);
  if (output.length > 0) {
    output[0] = { ...points[0] };
    output[output.length - 1] = { ...last, source: "render" };
  }

  cache.set(key, output.map(clonePoint));
  return output;
}

export function buildSummaryRenderPath(trustedPath = [], options = {}) {
  const preset = getTrackingPreset(options.preset || "run");
  const points = (Array.isArray(trustedPath) ? trustedPath : []).filter(isValidCoordinate);
  if (points.length < 3) return points.map(clonePoint);

  const key = cacheKey("summary", points, options.preset || "run");
  if (cache.has(key)) return cache.get(key).map(clonePoint);

  const deduped = removeDuplicateVisualPoints(points);
  const noBacktracks = removeTinyBacktracks(deduped, preset);
  const simplified = simplifyPathByDistance(noBacktracks, preset.summarySimplifyToleranceMeters);
  const moving = smoothPathMovingAverage(simplified, { strength: Math.min(0.36, preset.summarySmoothingStrength * 0.55) });
  const chaikin = smoothPathChaikin(moving, { strength: 0.22, iterations: moving.length > 12 ? 2 : 1 });
  const maybeSpline = chaikin.length >= preset.minPointsForSpline && chaikin.length <= 650
    ? smoothPathCatmullRom(chaikin, { samplesPerSegment: 2 })
    : chaikin;
  const protectedPath = preventCornerOvercut(maybeSpline, points, preset);
  const output = capRenderPoints(protectedPath, options.maxPoints || 1600);
  if (output.length > 0) {
    output[0] = { ...points[0] };
    output[output.length - 1] = { ...points[points.length - 1] };
  }

  const validation = validateRenderPath(output, points);
  const fallback = preventCornerOvercut(
    smoothPathMovingAverage(simplified, { strength: preset.summarySmoothingStrength * 0.5 }),
    points,
    preset
  );
  const finalPath = validation.ok ? output : fallback;

  cache.set(key, finalPath.map(clonePoint));
  return finalPath;
}

export function getBestRenderPathForRun(run = {}) {
  const candidates = [
    run.displayPoints,
    run.renderPath,
    run.displayPath,
    run.summaryRenderPath,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.filter(isValidCoordinate).length > 1) return candidate;
  }

  const segmentPaths = getRenderableSegmentsForRun(run);
  if (segmentPaths.length > 0) {
    return segmentPaths.flat();
  }

  const trusted = Array.isArray(run.trustedPath) && run.trustedPath.length > 1
    ? run.trustedPath
    : Array.isArray(run.filteredPoints) && run.filteredPoints.length > 1
      ? run.filteredPoints
      : run.path;
  return buildSummaryRenderPath(trusted || []);
}

export function getRenderableSegmentsForRun(run = {}) {
  const rawSegments = Array.isArray(run?.segments) ? run.segments : [];
  if (rawSegments.length > 0) {
    const paths = rawSegments
      .map((segment, index) => {
        const segmentIndex = Number.isFinite(Number(segment?.index)) ? Number(segment.index) : index;
        const candidate =
          segment?.displayPoints ||
          segment?.summaryRenderPath ||
          segment?.renderPath ||
          segment?.displayPath ||
          segment?.liveRenderPath ||
          segment?.filteredPoints ||
          segment?.trustedPath ||
          segment?.path ||
          [];
        const clean = (Array.isArray(candidate) ? candidate : [])
          .filter(isValidCoordinate)
          .map((point) => normalizeSegmentPoint(point, segmentIndex));
        if (clean.length > 1) return clean;

        const trusted = (Array.isArray(segment?.filteredPoints) ? segment.filteredPoints : Array.isArray(segment?.trustedPath) ? segment.trustedPath : [])
          .filter(isValidCoordinate)
          .map((point) => normalizeSegmentPoint(point, segmentIndex));
        return trusted.length > 1
          ? buildSummaryRenderPath(trusted).map((point) => normalizeSegmentPoint(point, segmentIndex))
          : [];
      })
      .filter((path) => path.length > 1);
    if (paths.length > 0) return paths;
  }

  const candidate = getBestFlatCandidate(run);
  const clean = (Array.isArray(candidate) ? candidate : []).filter(isValidCoordinate);
  if (clean.length < 2) return [];

  const segments = [];
  let current = [];
  for (const point of clean) {
    const last = current[current.length - 1];
    const segmentChanged = last && point.segmentId !== last.segmentId;
    if (current.length > 0 && segmentChanged) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 1) segments.push(current);
  return segments.length > 0 ? segments : [clean];
}

function getBestFlatCandidate(run = {}) {
  const candidates = [
    run.renderPath,
    run.displayPoints,
    run.displayPath,
    run.summaryRenderPath,
    run.filteredPoints,
    run.trustedPath,
    run.path,
  ];
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.filter(isValidCoordinate).length > 1) || [];
}

export default {
  buildLiveRenderPath,
  buildSummaryRenderPath,
  getBestRenderPathForRun,
  getRenderableSegmentsForRun,
  removeDuplicateVisualPoints,
  removeTinyBacktracks,
  simplifyPathByDistance,
  validateRenderPath,
};
