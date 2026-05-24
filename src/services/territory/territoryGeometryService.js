import * as turf from "@turf/turf";
import { TERRITORY_CONFIG } from "./territoryConfig.js";
import {
  TERRITORY_CAPTURE_FAILURE,
  TERRITORY_SOURCE,
} from "./territoryTypes.js";

const EARTH_RADIUS_M = 6371008.8;
const DEG_TO_RAD = Math.PI / 180;
const SUPPORTED_GEOMETRY_TYPES = new Set(["Polygon", "MultiPolygon"]);
const SUPPORTED_ROUTE_GEOMETRY_TYPES = new Set(["LineString", "MultiLineString"]);

function getConfig(options = {}) {
  return { ...TERRITORY_CONFIG, ...(options || {}) };
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeOptionalNumber(value) {
  const number = toFiniteNumber(value);
  return number == null ? undefined : number;
}

function isValidLatitude(latitude) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
}

function isValidLongitude(longitude) {
  return Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function sameCoordinate(a, b) {
  return Boolean(
    a &&
      b &&
      Number(a[0]) === Number(b[0]) &&
      Number(a[1]) === Number(b[1])
  );
}

function normalizePathPoint(point) {
  if (!point) return null;

  let latitude;
  let longitude;

  if (Array.isArray(point)) {
    const first = toFiniteNumber(point[0]);
    const second = toFiniteNumber(point[1]);
    if (first == null || second == null) return null;

    if (!isValidLatitude(first) && isValidLatitude(second) && isValidLongitude(first)) {
      latitude = second;
      longitude = first;
    } else {
      latitude = first;
      longitude = second;
    }
  } else {
    latitude = toFiniteNumber(point.latitude ?? point.lat);
    longitude = toFiniteNumber(point.longitude ?? point.lng ?? point.lon);

    if (
      !isValidLatitude(latitude) &&
      isValidLatitude(longitude) &&
      isValidLongitude(latitude)
    ) {
      const originalLatitude = latitude;
      latitude = longitude;
      longitude = originalLatitude;
    }
  }

  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;

  const accuracy = normalizeOptionalNumber(point.accuracy ?? point.coords?.accuracy);
  const speed = normalizeOptionalNumber(point.speed ?? point.coords?.speed);

  return {
    latitude,
    longitude,
    timestamp: point.timestamp,
    accuracy,
    speed,
  };
}

function isDuplicatePathPoint(a, b) {
  if (!a || !b) return false;
  return (
    a.latitude === b.latitude &&
    a.longitude === b.longitude
  );
}

function limitPoints(points, maxPoints) {
  const limit = Number(maxPoints);
  if (!Number.isFinite(limit) || limit <= 0 || points.length <= limit) return points;
  if (limit === 1) return [points[0]];

  const out = [];
  const lastIndex = points.length - 1;
  const interval = lastIndex / (limit - 1);

  for (let i = 0; i < limit; i += 1) {
    out.push(points[Math.round(i * interval)]);
  }

  return out;
}

function calculatePathDistanceMeters(path = []) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += calculateDistanceMeters(path[i - 1], path[i]);
  }
  return total;
}

function getPointSegmentIndex(point, fallback = 0) {
  const value = Number(point?.segmentId ?? point?.segmentIndex ?? point?.segment);
  return Number.isFinite(value) ? value : fallback;
}

function splitPathBySegment(points = []) {
  const segments = [];
  let current = [];
  let currentSegmentIndex = null;

  for (const point of Array.isArray(points) ? points : []) {
    const segmentIndex = getPointSegmentIndex(point, currentSegmentIndex ?? 0);
    if (current.length > 0 && currentSegmentIndex !== segmentIndex) {
      segments.push(current);
      current = [];
    }
    currentSegmentIndex = segmentIndex;
    current.push(point);
  }

  if (current.length > 0) segments.push(current);
  return segments;
}

function sanitizePathSegmentsForTerritory(points = [], options = {}) {
  const explicitSegments = Array.isArray(options.segments) && options.segments.length > 0
    ? options.segments
    : null;
  const rawSegments = explicitSegments
    ? explicitSegments.map((segment) => {
        if (Array.isArray(segment)) return segment;
        return segment?.filteredPoints || segment?.trustedPath || segment?.path || segment?.rawPath || [];
      })
    : splitPathBySegment(Array.isArray(points) ? points : []);

  const maxRoutePoints = Number(options.maxRoutePoints || options.maxPoints || TERRITORY_CONFIG.maxRoutePoints);
  const segmentOptions = {
    ...options,
    maxPoints: maxRoutePoints,
  };

  let used = 0;
  const sanitizedSegments = [];

  for (const rawSegment of rawSegments) {
    const remaining = maxRoutePoints > 0 ? Math.max(0, maxRoutePoints - used) : Infinity;
    if (remaining <= 0) break;

    const segment = sanitizePathForTerritory(rawSegment, {
      ...segmentOptions,
      maxPoints: Number.isFinite(remaining) ? remaining : segmentOptions.maxPoints,
    });
    if (segment.length >= 2) {
      sanitizedSegments.push(segment);
      used += segment.length;
    }
  }

  if (sanitizedSegments.length === 0 && Array.isArray(points) && points.length > 0) {
    const fallback = sanitizePathForTerritory(points, segmentOptions);
    return fallback.length >= 2 ? [fallback] : [];
  }

  return sanitizedSegments;
}

function flattenSegments(segments = []) {
  return (Array.isArray(segments) ? segments : []).flatMap((segment) => segment || []);
}

function pointToPosition(point) {
  const normalized = normalizePathPoint(point);
  return normalized ? [normalized.longitude, normalized.latitude] : null;
}

function pointsToPositions(points = []) {
  const coordinates = [];
  for (const point of Array.isArray(points) ? points : []) {
    const position = pointToPosition(point);
    if (!position) continue;
    if (coordinates.length > 0 && sameCoordinate(coordinates[coordinates.length - 1], position)) continue;
    coordinates.push(position);
  }
  return coordinates;
}

function normalizeRouteGeometry(geometry) {
  if (!geometry || !SUPPORTED_ROUTE_GEOMETRY_TYPES.has(geometry.type)) return null;

  if (geometry.type === "LineString") {
    const coordinates = (Array.isArray(geometry.coordinates) ? geometry.coordinates : [])
      .map(normalizePosition)
      .filter(Boolean);
    return coordinates.length >= 2 ? { type: "LineString", coordinates } : null;
  }

  const coordinates = (Array.isArray(geometry.coordinates) ? geometry.coordinates : [])
    .map((line) => (Array.isArray(line) ? line : []).map(normalizePosition).filter(Boolean))
    .filter((line) => line.length >= 2);

  if (coordinates.length === 0) return null;
  if (coordinates.length === 1) return { type: "LineString", coordinates: coordinates[0] };
  return { type: "MultiLineString", coordinates };
}

function simplifyRouteGeometry(geometry, config) {
  const normalized = normalizeRouteGeometry(geometry);
  if (!normalized) return null;

  const feature = createFeature(normalized);
  const maxPoints = Number(config.maxRouteGeometryPoints || config.maxPoints || TERRITORY_CONFIG.maxRouteGeometryPoints);
  const currentPointCount = normalized.type === "LineString"
    ? normalized.coordinates.length
    : normalized.coordinates.reduce((total, line) => total + line.length, 0);

  if (currentPointCount <= maxPoints || !(config.simplifyTolerance > 0) || typeof turf.simplify !== "function") {
    return normalized;
  }

  try {
    return normalizeRouteGeometry(turf.simplify(feature, {
      tolerance: config.simplifyTolerance,
      highQuality: true,
      mutate: false,
    })?.geometry) || normalized;
  } catch {
    return normalized;
  }
}

function buildRouteGeometryFromSegments(segments = [], config = {}) {
  const lines = (Array.isArray(segments) ? segments : [])
    .map(pointsToPositions)
    .filter((line) => line.length >= 2);

  if (lines.length === 0) return null;
  const geometry = lines.length === 1
    ? { type: "LineString", coordinates: lines[0] }
    : { type: "MultiLineString", coordinates: lines };

  return simplifyRouteGeometry(geometry, config);
}

function planarSegmentIntersection(a, b, c, d) {
  const x1 = a[0];
  const y1 = a[1];
  const x2 = b[0];
  const y2 = b[1];
  const x3 = c[0];
  const y3 = c[1];
  const x4 = d[0];
  const y4 = d[1];
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) < 1e-12) return null;

  const px =
    ((x1 * y2 - y1 * x2) * (x3 - x4) -
      (x1 - x2) * (x3 * y4 - y3 * x4)) /
    denominator;
  const py =
    ((x1 * y2 - y1 * x2) * (y3 - y4) -
      (y1 - y2) * (x3 * y4 - y3 * x4)) /
    denominator;

  const within = (value, start, end) =>
    value >= Math.min(start, end) - 1e-10 && value <= Math.max(start, end) + 1e-10;

  if (
    !within(px, x1, x2) ||
    !within(py, y1, y2) ||
    !within(px, x3, x4) ||
    !within(py, y3, y4)
  ) {
    return null;
  }

  return [px, py];
}

function signedRingArea(ring = []) {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    total += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return total / 2;
}

function closeRing(ring = []) {
  const clean = [];
  for (const position of ring) {
    const normalized = normalizePosition(position);
    if (!normalized) continue;
    if (clean.length > 0 && sameCoordinate(clean[clean.length - 1], normalized)) continue;
    clean.push(normalized);
  }

  if (clean.length < 3) return null;
  if (!sameCoordinate(clean[0], clean[clean.length - 1])) clean.push([...clean[0]]);

  const unique = new Set(clean.slice(0, -1).map((coordinate) => coordinate.join(",")));
  return unique.size >= 3 ? clean : null;
}

function ringHasSelfIntersection(ring = []) {
  const coordinates = closeRing(ring);
  if (!coordinates) return false;

  for (let i = 0; i < coordinates.length - 1; i += 1) {
    for (let j = i + 1; j < coordinates.length - 1; j += 1) {
      const adjacent = Math.abs(i - j) <= 1 || (i === 0 && j === coordinates.length - 2);
      if (adjacent) continue;
      if (planarSegmentIntersection(coordinates[i], coordinates[i + 1], coordinates[j], coordinates[j + 1])) {
        return true;
      }
    }
  }

  return false;
}

function createGeometryCandidatesFromRing(rawRing = [], config = {}) {
  const ring = closeRing(rawRing);
  if (!ring) return [];

  const candidates = [];

  try {
    let feature = turf.polygon([ring]);
    feature = turf.cleanCoords(feature, { mutate: false });

    const featureList = [];
    if (!ringHasSelfIntersection(ring)) {
      featureList.push(feature);
    } else if (typeof turf.unkinkPolygon === "function") {
      const unkinked = turf.unkinkPolygon(feature);
      featureList.push(...(unkinked?.features || []));
    }

    for (const item of featureList) {
      const normalized = normalizeGeometry(item?.geometry);
      if (!normalized) continue;

      const areaM2 = calculateGeometryAreaM2(normalized);
      if (areaM2 < config.minAreaM2) continue;
      candidates.push({ geometry: normalized, areaM2 });
    }
  } catch {
    return [];
  }

  return candidates;
}

function extractLoopRingsFromSegment(segment = [], config = {}) {
  const points = Array.isArray(segment) ? segment : [];
  const coordinates = pointsToPositions(points);
  if (coordinates.length < config.minLoopPoints) return [];

  const closeDistanceM = Math.min(
    toFiniteNumber(config.closeDistanceM) ?? TERRITORY_CONFIG.closeDistanceM,
    toFiniteNumber(config.maxCloseDistanceM) ?? TERRITORY_CONFIG.maxCloseDistanceM
  );
  const maxCloseDistanceM = toFiniteNumber(config.maxCloseDistanceM) ?? closeDistanceM;
  const minLoopPoints = Math.max(4, Number(config.minLoopPoints || TERRITORY_CONFIG.minLoopPoints));
  const rings = [];

  const maybePushRing = (ring, reason, closeDistanceMValue = 0) => {
    const closed = closeRing(ring);
    if (!closed) return;
    const signature = closed.map((coordinate) => coordinate.map((value) => value.toFixed(7)).join(",")).join("|");
    if (rings.some((item) => item.signature === signature)) return;
    rings.push({ ring: closed, reason, closeDistanceM: closeDistanceMValue, signature });
  };

  const first = points[0];
  const last = points[points.length - 1];
  const fullCloseDistanceM = calculateDistanceMeters(first, last);
  const hasFullClosure = fullCloseDistanceM <= maxCloseDistanceM;
  if (hasFullClosure) {
    maybePushRing(coordinates, "start-close", fullCloseDistanceM);
  }

  if (!hasFullClosure) {
    for (let end = minLoopPoints - 1; end < points.length; end += 1) {
      for (let start = 0; start <= end - minLoopPoints + 1; start += 1) {
        const closeDistance = calculateDistanceMeters(points[start], points[end]);
        if (closeDistance <= maxCloseDistanceM) {
          maybePushRing(coordinates.slice(start, end + 1), "near-return", closeDistance);
        }
      }
    }
  }

  for (let end = 3; end < coordinates.length; end += 1) {
    const currentA = coordinates[end - 1];
    const currentB = coordinates[end];
    for (let start = 0; start < end - 2; start += 1) {
      if (start === 0 && end === coordinates.length - 1) continue;
      const previousA = coordinates[start];
      const previousB = coordinates[start + 1];
      const intersection = planarSegmentIntersection(previousA, previousB, currentA, currentB);
      if (!intersection) continue;

      const ring = [intersection, ...coordinates.slice(start + 1, end), intersection];
      if (ring.length >= minLoopPoints) maybePushRing(ring, "self-intersection", 0);
    }
  }

  rings.sort((a, b) => a.closeDistanceM - b.closeDistanceM);
  return rings.map((item) => item.ring);
}

function combineLoopGeometries(candidates = [], config = {}) {
  const geometries = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => normalizeGeometry(candidate.geometry || candidate))
    .filter(Boolean);

  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0];

  const union = unionGeometries(geometries);
  if (union.ok && union.geometry) return union.geometry;

  const polygons = [];
  for (const geometry of geometries) {
    if (geometry.type === "Polygon") polygons.push(geometry.coordinates);
    if (geometry.type === "MultiPolygon") polygons.push(...geometry.coordinates);
  }

  return normalizeGeometry({ type: "MultiPolygon", coordinates: polygons });
}

function createInvalidRouteResult({ status = "invalid", reason, details = {}, routeGeometry = null, sanitizedPath = [], sanitizedSegments = [] }) {
  return {
    ok: false,
    status,
    reason,
    geometry: null,
    routeGeometry,
    areaM2: 0,
    bbox: null,
    center: null,
    coordsPreview: [],
    sanitizedPath,
    sanitizedSegments,
    meta: {
      ...details,
      pointCount: sanitizedPath.length,
      segmentCount: sanitizedSegments.length,
    },
  };
}

function createFeature(geometry) {
  return {
    type: "Feature",
    properties: {},
    geometry,
  };
}

function normalizePosition(position) {
  if (!Array.isArray(position) || position.length < 2) return null;
  const longitude = toFiniteNumber(position[0]);
  const latitude = toFiniteNumber(position[1]);
  if (!isValidLongitude(longitude) || !isValidLatitude(latitude)) return null;
  return [longitude, latitude];
}

function normalizeRing(ring) {
  if (!Array.isArray(ring)) return null;

  const coordinates = [];
  for (const position of ring) {
    const normalized = normalizePosition(position);
    if (!normalized) continue;
    if (coordinates.length > 0 && sameCoordinate(coordinates[coordinates.length - 1], normalized)) {
      continue;
    }
    coordinates.push(normalized);
  }

  if (coordinates.length < 3) return null;

  if (!sameCoordinate(coordinates[0], coordinates[coordinates.length - 1])) {
    coordinates.push([...coordinates[0]]);
  }

  const uniqueCoordinates = new Set(
    coordinates.slice(0, -1).map((coordinate) => coordinate.join(","))
  );

  return uniqueCoordinates.size >= 3 && coordinates.length >= 4 ? coordinates : null;
}

function normalizePolygonCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return null;

  const rings = coordinates.map(normalizeRing).filter(Boolean);
  return rings.length > 0 ? rings : null;
}

function normalizeRawGeometry(geometry) {
  if (!geometry || !SUPPORTED_GEOMETRY_TYPES.has(geometry.type)) return null;

  if (geometry.type === "Polygon") {
    const coordinates = normalizePolygonCoordinates(geometry.coordinates);
    return coordinates ? { type: "Polygon", coordinates } : null;
  }

  const polygons = Array.isArray(geometry.coordinates)
    ? geometry.coordinates.map(normalizePolygonCoordinates).filter(Boolean)
    : [];

  return polygons.length > 0
    ? { type: "MultiPolygon", coordinates: polygons }
    : null;
}

function getGeometryFromInput(input) {
  if (!input) return null;
  if (input.type === "Feature") return input.geometry;
  return input;
}

function countGeometryPoints(geometry) {
  if (!geometry) return 0;
  if (geometry.type === "Polygon") {
    return geometry.coordinates.reduce((total, ring) => total + ring.length, 0);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce(
      (total, polygon) =>
        total + polygon.reduce((ringTotal, ring) => ringTotal + ring.length, 0),
      0
    );
  }
  return 0;
}

export function applyPolygonSmoothWithFallback(geometry, config = {}) {
  const normalized = normalizeGeometry(geometry);
  const smoothIterations = Number(config?.polygonSmoothIterations ?? config?.smoothIterations ?? 0);
  const smoothFn = config?.smoothFn || turf.polygonSmooth;
  if (!normalized || typeof smoothFn !== "function" || smoothIterations <= 0) return normalized;

  try {
    const smoothed = smoothFn(createFeature(normalized), {
      iterations: Math.min(2, Math.max(1, Math.round(smoothIterations))),
      mutate: false,
    });
    const smoothedGeometry = normalizeGeometry(smoothed?.geometry || smoothed?.features?.[0]?.geometry);
    return smoothedGeometry && isGeometryRenderable(smoothedGeometry)
      ? smoothedGeometry
      : normalized;
  } catch {
    return normalized;
  }
}

function prepareGeometryFeature(geometry, config) {
  let normalized = normalizeGeometry(geometry);
  if (!normalized) return null;

  let feature = createFeature(normalized);

  if (
    typeof turf.simplify === "function" &&
    config?.simplifyTolerance > 0 &&
    countGeometryPoints(normalized) > config.maxPoints
  ) {
    try {
      const simplified = turf.simplify(feature, {
        tolerance: config.simplifyTolerance,
        highQuality: true,
        mutate: false,
      });
      normalized = normalizeGeometry(simplified);
      if (normalized) feature = createFeature(normalized);
    } catch {
      feature = createFeature(normalized);
    }
  }

  normalized = applyPolygonSmoothWithFallback(normalized, config);
  feature = createFeature(normalized);

  return feature;
}

function makeOperationFailure(reason, error = null) {
  return {
    ok: false,
    geometry: null,
    areaM2: 0,
    reason,
    error: error?.message || error || null,
  };
}

function makeOperationSuccess(geometry) {
  const normalized = normalizeGeometry(geometry);
  if (!normalized) return makeOperationFailure(TERRITORY_CAPTURE_FAILURE.invalid_geometry);

  return {
    ok: true,
    geometry: normalized,
    areaM2: calculateGeometryAreaM2(normalized),
    reason: null,
    error: null,
  };
}

export function sanitizePathForTerritory(path, options = {}) {
  const config = getConfig(options);
  if (!Array.isArray(path)) return [];

  const clean = [];

  for (const point of path) {
    const normalized = normalizePathPoint(point);
    if (!normalized) continue;

    if (
      normalized.accuracy != null &&
      (normalized.accuracy < 0 || normalized.accuracy > config.maxAccuracyM)
    ) {
      continue;
    }

    if (
      normalized.speed != null &&
      (normalized.speed < 0 || normalized.speed > config.maxSpeedMps)
    ) {
      continue;
    }

    const previous = clean[clean.length - 1];
    if (previous && isDuplicatePathPoint(previous, normalized)) continue;

    if (previous) {
      const jumpM = calculateDistanceMeters(previous, normalized);
      if (jumpM > config.maxJumpM) continue;
    }

    clean.push(normalized);
  }

  return limitPoints(clean, config.maxPoints);
}

export function calculateDistanceMeters(a, b) {
  const from = normalizePathPoint(a);
  const to = normalizePathPoint(b);
  if (!from || !to) return 0;

  const lat1 = from.latitude * DEG_TO_RAD;
  const lat2 = to.latitude * DEG_TO_RAD;
  const dLat = lat2 - lat1;
  const dLng = (to.longitude - from.longitude) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const haversine =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function isClosedLoop(path, options = {}) {
  const config = getConfig(options);
  const sanitizedPath = sanitizePathForTerritory(path, config);

  if (sanitizedPath.length < config.minLoopPoints) {
    return {
      closed: false,
      distanceToStartM: 0,
      reason: TERRITORY_CAPTURE_FAILURE.not_enough_points,
    };
  }

  const first = sanitizedPath[0];
  const last = sanitizedPath[sanitizedPath.length - 1];
  const distanceToStartM = calculateDistanceMeters(first, last);
  const configuredCloseDistanceM = toFiniteNumber(config.closeDistanceM) ?? TERRITORY_CONFIG.closeDistanceM;
  const configuredMaxCloseDistanceM = toFiniteNumber(config.maxCloseDistanceM) ?? TERRITORY_CONFIG.maxCloseDistanceM;
  const closeDistanceM = Math.min(configuredCloseDistanceM, configuredMaxCloseDistanceM);

  return {
    closed: distanceToStartM <= closeDistanceM,
    distanceToStartM,
    reason:
      distanceToStartM <= closeDistanceM
        ? null
        : TERRITORY_CAPTURE_FAILURE.not_closed_loop,
  };
}

export function routeToZoneGeometry(points = [], options = {}) {
  const config = getConfig(options);
  const sanitizedSegments = sanitizePathSegmentsForTerritory(points, config);
  const sanitizedPath = flattenSegments(sanitizedSegments);
  const routeGeometry = buildRouteGeometryFromSegments(sanitizedSegments, config);
  const distanceM = sanitizedSegments.reduce(
    (total, segment) => total + calculatePathDistanceMeters(segment),
    0
  );
  const accuracyPoints = sanitizedPath.filter((point) => Number.isFinite(Number(point.accuracy)));
  const quality = {
    rawPoints: Array.isArray(points) ? points.length : 0,
    pointsUsed: sanitizedPath.length,
    pointsDiscarded: Math.max(0, (Array.isArray(points) ? points.length : 0) - sanitizedPath.length),
    averageAccuracy: accuracyPoints.length > 0
      ? accuracyPoints.reduce((total, point) => total + Number(point.accuracy), 0) / accuracyPoints.length
      : null,
  };

  if (sanitizedPath.length < config.minLoopPoints) {
    return createInvalidRouteResult({
      reason: TERRITORY_CAPTURE_FAILURE.not_enough_points,
      details: {
        minLoopPoints: config.minLoopPoints,
        distanceM,
        quality,
      },
      routeGeometry,
      sanitizedPath,
      sanitizedSegments,
    });
  }

  try {
    const loopRings = sanitizedSegments.flatMap((segment) => extractLoopRingsFromSegment(segment, config));
    const geometryCandidates = [];

    for (const ring of loopRings) {
      geometryCandidates.push(...createGeometryCandidatesFromRing(ring, config));
    }

    if (geometryCandidates.length === 0) {
      return createInvalidRouteResult({
        status: "partial",
        reason: loopRings.length > 0
          ? TERRITORY_CAPTURE_FAILURE.area_too_small
          : TERRITORY_CAPTURE_FAILURE.not_closed_loop,
        details: {
          distanceM,
          quality,
          closureDetected: loopRings.length > 0,
          loopCount: loopRings.length,
        },
        routeGeometry,
        sanitizedPath,
        sanitizedSegments,
      });
    }

    const geometry = normalizeGeometry(combineLoopGeometries(geometryCandidates, config));
    if (!geometry || !isGeometryRenderable(geometry)) {
      return createInvalidRouteResult({
        reason: TERRITORY_CAPTURE_FAILURE.invalid_geometry,
        details: {
          distanceM,
          quality,
          candidateCount: geometryCandidates.length,
        },
        routeGeometry,
        sanitizedPath,
        sanitizedSegments,
      });
    }

    const areaM2 = calculateGeometryAreaM2(geometry);
    if (areaM2 < config.minAreaM2) {
      return createInvalidRouteResult({
        status: "partial",
        reason: TERRITORY_CAPTURE_FAILURE.area_too_small,
        details: { areaM2, minAreaM2: config.minAreaM2, distanceM, quality },
        routeGeometry,
        sanitizedPath,
        sanitizedSegments,
      });
    }

    if (distanceM < config.minDistanceM) {
      return createInvalidRouteResult({
        status: "partial",
        reason: TERRITORY_CAPTURE_FAILURE.distance_too_short,
        details: {
          distanceM,
          minDistanceM: config.minDistanceM,
          areaM2,
          quality,
        },
        routeGeometry,
        sanitizedPath,
        sanitizedSegments,
      });
    }

    if (areaM2 > config.maxAreaM2) {
      return createInvalidRouteResult({
        reason: TERRITORY_CAPTURE_FAILURE.area_too_large,
        details: { areaM2, maxAreaM2: config.maxAreaM2, distanceM, quality },
        routeGeometry,
        sanitizedPath,
        sanitizedSegments,
      });
    }

    const bbox = calculateGeometryBbox(geometry);
    const center = calculateGeometryCenter(geometry);

    return {
      ok: true,
      status: "completed",
      reason: null,
      geometry,
      routeGeometry,
      areaM2,
      bbox,
      center,
      coordsPreview: geometryToPreviewCoords(geometry, config.maxPoints),
      source: TERRITORY_SOURCE.zone_run,
      sanitizedPath,
      sanitizedSegments,
      meta: {
        pointCount: sanitizedPath.length,
        segmentCount: sanitizedSegments.length,
        distanceM,
        distanceToStartM: calculateDistanceMeters(sanitizedPath[0], sanitizedPath[sanitizedPath.length - 1]),
        closeDistanceM: config.closeDistanceM,
        maxCloseDistanceM: config.maxCloseDistanceM,
        loopCount: loopRings.length,
        candidateCount: geometryCandidates.length,
        closureDetected: true,
        quality,
        geometryVersion: "route_to_zone_v2",
      },
    };
  } catch (error) {
    return createInvalidRouteResult({
      reason: TERRITORY_CAPTURE_FAILURE.turf_error,
      details: {
        error: error?.message || String(error),
        distanceM,
        quality,
      },
      routeGeometry,
      sanitizedPath,
      sanitizedSegments,
    });
  }
}

export function buildCaptureGeometryFromPath(path, options = {}) {
  const config = getConfig(options);
  const result = routeToZoneGeometry(path, config);
  if (!result.ok) return result;

  const prepared = prepareGeometryFeature(result.geometry, config);
  if (!prepared || !isGeometryRenderable(prepared.geometry)) {
    return {
      ...result,
      ok: false,
      status: "invalid",
      reason: TERRITORY_CAPTURE_FAILURE.invalid_geometry,
      geometry: null,
      areaM2: 0,
    };
  }

  const geometry = prepared.geometry;
  const areaM2 = calculateGeometryAreaM2(geometry);

  return {
    ...result,
    geometry,
    areaM2,
    bbox: calculateGeometryBbox(geometry),
    center: calculateGeometryCenter(geometry),
    coordsPreview: geometryToPreviewCoords(geometry, config.maxPoints),
    source: TERRITORY_SOURCE.closed_loop,
  };
}

export function calculateGeometryAreaM2(geometry) {
  const normalized = normalizeGeometry(geometry);
  if (!normalized) return 0;

  try {
    const areaM2 = turf.area(createFeature(normalized));
    return Number.isFinite(areaM2) && areaM2 > 0 ? areaM2 : 0;
  } catch {
    return 0;
  }
}

export function calculateGeometryBbox(geometry) {
  const normalized = normalizeGeometry(geometry);
  if (!normalized) return null;

  try {
    const bbox = turf.bbox(createFeature(normalized));
    return Array.isArray(bbox) && bbox.length === 4 ? bbox : null;
  } catch {
    return null;
  }
}

export function calculateGeometryCenter(geometry) {
  const normalized = normalizeGeometry(geometry);
  if (!normalized) return null;

  try {
    const center = turf.centroid(createFeature(normalized));
    const coordinates = center?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

    const longitude = toFiniteNumber(coordinates[0]);
    const latitude = toFiniteNumber(coordinates[1]);
    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;

    return { latitude, longitude };
  } catch {
    return null;
  }
}

export function geometryToPreviewCoords(geometry, maxPoints = TERRITORY_CONFIG.maxPoints) {
  const normalized = normalizeGeometry(geometry);
  if (!normalized) return [];

  const rings =
    normalized.type === "Polygon"
      ? [normalized.coordinates[0]]
      : normalized.coordinates.map((polygon) => polygon[0]);

  const points = rings
    .flat()
    .map((coordinate) => ({
      latitude: coordinate[1],
      longitude: coordinate[0],
    }))
    .filter(
      (point) =>
        isValidLatitude(point.latitude) && isValidLongitude(point.longitude)
    );

  return limitPoints(points, maxPoints);
}

export function isGeometryRenderable(geometry) {
  return Boolean(normalizeGeometry(geometry));
}

export function normalizeGeometry(geometry) {
  const rawGeometry = getGeometryFromInput(geometry);
  const basicGeometry = normalizeRawGeometry(rawGeometry);
  if (!basicGeometry) return null;

  let feature = createFeature(basicGeometry);

  try {
    feature = turf.cleanCoords(feature, { mutate: false });
  } catch {
    feature = createFeature(basicGeometry);
  }

  const cleanedGeometry = normalizeRawGeometry(feature.geometry);
  if (!cleanedGeometry) return null;

  feature = createFeature(cleanedGeometry);

  if (typeof turf.rewind === "function") {
    try {
      feature = turf.rewind(feature, { mutate: false });
    } catch {
      feature = createFeature(cleanedGeometry);
    }
  }

  return normalizeRawGeometry(feature.geometry) || cleanedGeometry;
}

export function intersectGeometries(a, b) {
  try {
    const first = normalizeGeometry(a);
    const second = normalizeGeometry(b);
    if (!first || !second) {
      return makeOperationFailure(TERRITORY_CAPTURE_FAILURE.invalid_geometry);
    }

    const result = turf.intersect(
      turf.featureCollection([createFeature(first), createFeature(second)])
    );

    return result?.geometry
      ? makeOperationSuccess(result.geometry)
      : makeOperationFailure("empty_geometry");
  } catch (error) {
    return makeOperationFailure(TERRITORY_CAPTURE_FAILURE.turf_error, error);
  }
}

export function differenceGeometries(a, b) {
  try {
    const first = normalizeGeometry(a);
    const second = normalizeGeometry(b);
    if (!first || !second) {
      return makeOperationFailure(TERRITORY_CAPTURE_FAILURE.invalid_geometry);
    }

    const result = turf.difference(
      turf.featureCollection([createFeature(first), createFeature(second)])
    );

    return result?.geometry
      ? makeOperationSuccess(result.geometry)
      : makeOperationFailure("empty_geometry");
  } catch (error) {
    return makeOperationFailure(TERRITORY_CAPTURE_FAILURE.turf_error, error);
  }
}

export function unionGeometries(geometries) {
  try {
    const items = Array.isArray(geometries) ? geometries : [];
    const normalized = items.map(normalizeGeometry).filter(Boolean);

    if (normalized.length === 0) {
      return makeOperationFailure(TERRITORY_CAPTURE_FAILURE.invalid_geometry);
    }

    if (normalized.length === 1) {
      return makeOperationSuccess(normalized[0]);
    }

    const result = turf.union(
      turf.featureCollection(normalized.map((geometry) => createFeature(geometry)))
    );

    return result?.geometry
      ? makeOperationSuccess(result.geometry)
      : makeOperationFailure("empty_geometry");
  } catch (error) {
    return makeOperationFailure(TERRITORY_CAPTURE_FAILURE.turf_error, error);
  }
}

export default {
  sanitizePathForTerritory,
  calculateDistanceMeters,
  isClosedLoop,
  routeToZoneGeometry,
  buildCaptureGeometryFromPath,
  applyPolygonSmoothWithFallback,
  calculateGeometryAreaM2,
  calculateGeometryBbox,
  calculateGeometryCenter,
  geometryToPreviewCoords,
  isGeometryRenderable,
  normalizeGeometry,
  intersectGeometries,
  differenceGeometries,
  unionGeometries,
};
