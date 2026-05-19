const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export const toRadians = (value) => Number(value || 0) * DEG_TO_RAD;
export const toDegrees = (value) => Number(value || 0) * RAD_TO_DEG;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
export const lerp = (a, b, t) => Number(a || 0) + (Number(b || 0) - Number(a || 0)) * clamp(t, 0, 1);
export const isFiniteNumber = (value) => Number.isFinite(Number(value));

export function isValidCoordinate(point) {
  const latitude = Number(point?.latitude ?? point?.lat);
  const longitude = Number(point?.longitude ?? point?.lng ?? point?.lon);
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

export function calculateDistanceMeters(a, b) {
  if (!isValidCoordinate(a) || !isValidCoordinate(b)) return 0;

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = lat2 - lat1;
  const dLng = toRadians(Number(b.longitude) - Number(a.longitude));
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function calculateSpeedMps(a, b) {
  const dtMs = Number(b?.timestamp) - Number(a?.timestamp);
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
  return calculateDistanceMeters(a, b) / (dtMs / 1000);
}

export function calculateBearing(a, b) {
  if (!isValidCoordinate(a) || !isValidCoordinate(b)) return null;

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLng = toRadians(Number(b.longitude) - Number(a.longitude));
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeBearing(toDegrees(Math.atan2(y, x)));
}

export function normalizeBearing(deg) {
  const value = Number(deg);
  if (!Number.isFinite(value)) return null;
  return ((value % 360) + 360) % 360;
}

export function calculateBearingDelta(a, b) {
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return 0;
  return Math.abs(((Number(b) - Number(a) + 540) % 360) - 180);
}

export function calculateTurnAngle(a, b, c) {
  const bearingIn = calculateBearing(a, b);
  const bearingOut = calculateBearing(b, c);
  if (bearingIn == null || bearingOut == null) return 0;
  return calculateBearingDelta(bearingIn, bearingOut);
}

export function interpolatePoint(a, b, t) {
  if (!isValidCoordinate(a)) return isValidCoordinate(b) ? { ...b } : null;
  if (!isValidCoordinate(b)) return { ...a };
  const ratio = clamp(t, 0, 1);
  return {
    ...b,
    latitude: lerp(a.latitude, b.latitude, ratio),
    longitude: lerp(a.longitude, b.longitude, ratio),
    timestamp: Number.isFinite(Number(a.timestamp)) && Number.isFinite(Number(b.timestamp))
      ? lerp(a.timestamp, b.timestamp, ratio)
      : b.timestamp ?? a.timestamp ?? Date.now(),
  };
}

export function calculatePathDistanceMeters(path = []) {
  const points = Array.isArray(path) ? path : [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += calculateDistanceMeters(points[i - 1], points[i]);
  }
  return Number.isFinite(total) ? total : 0;
}

export function calculateBoundingBox(path = []) {
  const points = (Array.isArray(path) ? path : []).filter(isValidCoordinate);
  if (points.length === 0) return null;
  const lats = points.map((point) => Number(point.latitude));
  const lngs = points.map((point) => Number(point.longitude));
  return [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];
}

export function calculatePathCenter(path = []) {
  const bbox = calculateBoundingBox(path);
  if (!bbox) return null;
  return {
    latitude: (bbox[1] + bbox[3]) / 2,
    longitude: (bbox[0] + bbox[2]) / 2,
  };
}

function collectAccuracies(path = []) {
  return (Array.isArray(path) ? path : [])
    .map((point) => Number(point?.accuracy))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

export function calculateAverageAccuracy(path = []) {
  const values = collectAccuracies(path);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateMaxAccuracy(path = []) {
  const values = collectAccuracies(path);
  return values.length > 0 ? Math.max(...values) : null;
}

export function metersToLatitudeDelta(meters) {
  return Math.max(0, Number(meters) || 0) / 111320;
}

export function metersToLongitudeDelta(meters, latitude = 0) {
  const cos = Math.max(0.1, Math.cos(toRadians(latitude)));
  return Math.max(0, Number(meters) || 0) / (111320 * cos);
}

export default {
  calculateAverageAccuracy,
  calculateBearing,
  calculateBearingDelta,
  calculateBoundingBox,
  calculateDistanceMeters,
  calculateMaxAccuracy,
  calculatePathCenter,
  calculatePathDistanceMeters,
  calculateSpeedMps,
  calculateTurnAngle,
  clamp,
  interpolatePoint,
  isFiniteNumber,
  isValidCoordinate,
  lerp,
  metersToLatitudeDelta,
  metersToLongitudeDelta,
  normalizeBearing,
  toDegrees,
  toRadians,
};
