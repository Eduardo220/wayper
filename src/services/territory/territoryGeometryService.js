import * as turf from "@turf/turf";
import { TERRITORY_CONFIG } from "./territoryConfig.js";
import {
  TERRITORY_CAPTURE_FAILURE,
  TERRITORY_SOURCE,
} from "./territoryTypes.js";

const EARTH_RADIUS_M = 6371008.8;
const DEG_TO_RAD = Math.PI / 180;
const SUPPORTED_GEOMETRY_TYPES = new Set(["Polygon", "MultiPolygon"]);

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

export function buildCaptureGeometryFromPath(path, options = {}) {
  const config = getConfig(options);
  const sanitizedPath = sanitizePathForTerritory(path, config);

  if (sanitizedPath.length < config.minLoopPoints) {
    return {
      ok: false,
      reason: TERRITORY_CAPTURE_FAILURE.not_enough_points,
      details: {
        pointCount: sanitizedPath.length,
        minLoopPoints: config.minLoopPoints,
      },
    };
  }

  const closedLoop = isClosedLoop(sanitizedPath, config);
  if (!closedLoop.closed) {
    return {
      ok: false,
      reason: closedLoop.reason,
      details: closedLoop,
    };
  }

  try {
    const ring = sanitizedPath.map((point) => [point.longitude, point.latitude]);
    if (!sameCoordinate(ring[0], ring[ring.length - 1])) {
      ring.push([...ring[0]]);
    }

    let feature = turf.polygon([ring]);
    feature = turf.cleanCoords(feature, { mutate: false });

    if (typeof turf.rewind === "function") {
      feature = turf.rewind(feature, { mutate: false });
    }

    const prepared = prepareGeometryFeature(feature.geometry, config);
    if (!prepared || !isGeometryRenderable(prepared.geometry)) {
      return {
        ok: false,
        reason: TERRITORY_CAPTURE_FAILURE.invalid_geometry,
        details: { pointCount: sanitizedPath.length },
      };
    }

    const geometry = prepared.geometry;
    const areaM2 = calculateGeometryAreaM2(geometry);

    if (areaM2 < config.minAreaM2) {
      return {
        ok: false,
        reason: TERRITORY_CAPTURE_FAILURE.area_too_small,
        details: { areaM2, minAreaM2: config.minAreaM2 },
      };
    }

    if (areaM2 > config.maxAreaM2) {
      return {
        ok: false,
        reason: TERRITORY_CAPTURE_FAILURE.area_too_large,
        details: { areaM2, maxAreaM2: config.maxAreaM2 },
      };
    }

    return {
      ok: true,
      geometry,
      areaM2,
      bbox: calculateGeometryBbox(geometry),
      center: calculateGeometryCenter(geometry),
      coordsPreview: geometryToPreviewCoords(geometry, config.maxPoints),
      source: TERRITORY_SOURCE.closed_loop,
      sanitizedPath,
      meta: {
        pointCount: sanitizedPath.length,
        distanceToStartM: closedLoop.distanceToStartM,
        closeDistanceM: config.closeDistanceM,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: TERRITORY_CAPTURE_FAILURE.turf_error,
      details: {
        error: error?.message || String(error),
      },
    };
  }
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
  buildCaptureGeometryFromPath,
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
