import { calculateDistanceMeters } from "../tracking/trackingMath.js";

export const ROUTE_BOUNDARY_MIN_DISTANCE_METERS = 2;

const SEGMENT_POINT_FIELDS = [
  "trustedPath",
  "filteredPoints",
  "path",
  "displayPoints",
  "summaryRenderPath",
  "renderPath",
  "displayPath",
  "liveRenderPath",
  "rawPath",
  "rawPoints",
  "coords",
  "coordinates",
  "points",
];

function isFiniteCoordinate(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

function readArrayCoordinate(point) {
  if (!Array.isArray(point) || point.length < 2) return null;

  const first = Number(point[0]);
  const second = Number(point[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  if (Math.abs(first) > 90 && Math.abs(first) <= 180 && Math.abs(second) <= 90) {
    return { latitude: second, longitude: first };
  }

  return { latitude: first, longitude: second };
}

export function normalizeRouteBoundaryPoint(point, index = 0) {
  if (!point) return null;

  const arrayCoordinate = readArrayCoordinate(point);
  const latitude = arrayCoordinate
    ? arrayCoordinate.latitude
    : Number(point?.latitude ?? point?.lat ?? point?.coords?.latitude);
  const longitude = arrayCoordinate
    ? arrayCoordinate.longitude
    : Number(point?.longitude ?? point?.lng ?? point?.lon ?? point?.coords?.longitude);

  if (!isFiniteCoordinate(latitude, longitude)) return null;

  const base = Array.isArray(point) ? {} : { ...point };
  const explicitIndex = Number(point?.index);

  return {
    ...base,
    latitude,
    longitude,
    timestamp: point?.timestamp ?? point?.time ?? point?.t ?? point?.createdAt ?? null,
    index: Number.isFinite(explicitIndex) ? explicitIndex : index,
  };
}

function isPointLike(value) {
  return Boolean(normalizeRouteBoundaryPoint(value));
}

function sanitizeBoundaryPath(path = []) {
  return (Array.isArray(path) ? path : [])
    .map(normalizeRouteBoundaryPoint)
    .filter(Boolean);
}

function looksLikePath(value) {
  return Array.isArray(value) && value.some(isPointLike);
}

function pointsFromSegment(segment) {
  if (looksLikePath(segment)) return sanitizeBoundaryPath(segment);
  if (!segment || typeof segment !== "object") return [];

  for (const field of SEGMENT_POINT_FIELDS) {
    const candidate = segment[field];
    if (looksLikePath(candidate)) return sanitizeBoundaryPath(candidate);
  }

  return [];
}

function extractSegments(input = []) {
  if (!Array.isArray(input)) return [];
  if (looksLikePath(input)) {
    const points = sanitizeBoundaryPath(input);
    return points.length > 0 ? [points] : [];
  }

  return input
    .map(pointsFromSegment)
    .filter((segment) => segment.length > 0);
}

function firstPointOfFirstSegment(segments = []) {
  for (const segment of segments) {
    if (segment.length > 0) return segment[0];
  }
  return null;
}

function lastPointOfLastSegment(segments = []) {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment.length > 0) return segment[segment.length - 1];
  }
  return null;
}

export function areRouteBoundaryPointsDistinct(
  start,
  finish,
  minDistanceMeters = ROUTE_BOUNDARY_MIN_DISTANCE_METERS
) {
  if (!start || !finish) return false;
  const distanceMeters = calculateDistanceMeters(start, finish);
  return Number.isFinite(distanceMeters) && distanceMeters > minDistanceMeters;
}

export function getRunBoundaryPoints(pointsOrSegments = [], options = {}) {
  const {
    fallbackPath = [],
    minDistanceMeters = ROUTE_BOUNDARY_MIN_DISTANCE_METERS,
  } = options;

  let segments = extractSegments(pointsOrSegments);
  let validPointCount = segments.reduce((sum, segment) => sum + segment.length, 0);

  if (validPointCount < 2 && Array.isArray(fallbackPath) && fallbackPath.length > 0) {
    segments = extractSegments(fallbackPath);
    validPointCount = segments.reduce((sum, segment) => sum + segment.length, 0);
  }

  const start = firstPointOfFirstSegment(segments);
  const finishCandidate = lastPointOfLastSegment(segments);
  const hasDistinctFinish =
    validPointCount >= 2 &&
    areRouteBoundaryPointsDistinct(start, finishCandidate, minDistanceMeters);

  return {
    start,
    finish: hasDistinctFinish ? finishCandidate : null,
    finishCandidate,
    hasStart: Boolean(start),
    hasFinish: hasDistinctFinish,
    hasDistinctFinish,
    validPointCount,
    segmentCount: segments.length,
  };
}

export default getRunBoundaryPoints;
