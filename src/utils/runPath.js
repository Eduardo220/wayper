const PATH_FIELD_CANDIDATES = [
  "filteredPoints",
  "trustedPath",
  "path",
  "displayPoints",
  "coords",
  "coordinates",
  "route",
  "points",
  "trackingPoints",
  "locationPoints",
  "polyline",
  "rawPath",
];

function isFiniteCoordinate(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function readArrayCoordinate(point) {
  if (!Array.isArray(point) || point.length < 2) return null;

  const first = Number(point[0]);
  const second = Number(point[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  // Arrays in Wayper are expected as [latitude, longitude]. Only swap when
  // the first value cannot be a latitude, which avoids breaking Brazilian routes.
  if (Math.abs(first) > 90 && Math.abs(first) <= 180 && Math.abs(second) <= 90) {
    return { latitude: second, longitude: first };
  }

  return { latitude: first, longitude: second };
}

function normalizePoint(point, index) {
  if (!point) return null;

  const arrayCoordinate = readArrayCoordinate(point);
  const latitude = arrayCoordinate
    ? arrayCoordinate.latitude
    : Number(point?.latitude ?? point?.lat);
  const longitude = arrayCoordinate
    ? arrayCoordinate.longitude
    : Number(point?.longitude ?? point?.lng ?? point?.lon);

  if (!isFiniteCoordinate(latitude, longitude)) return null;

  const base = Array.isArray(point) ? {} : { ...point };
  const explicitIndex = Number(point?.index);

  return {
    ...base,
    latitude,
    longitude,
    timestamp:
      point?.timestamp ??
      point?.time ??
      point?.createdAt ??
      point?.recordedAt ??
      null,
    index: Number.isFinite(explicitIndex) ? explicitIndex : index,
  };
}

export function getRunPathCandidate(runOrPath) {
  if (Array.isArray(runOrPath)) return runOrPath;
  if (!runOrPath || typeof runOrPath !== "object") return [];

  for (const field of PATH_FIELD_CANDIDATES) {
    const candidate = runOrPath[field];
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }

  const nestedCandidates = [
    runOrPath.metadata?.path,
    runOrPath.metadata?.coords,
    runOrPath.summary?.path,
    runOrPath.summary?.coords,
  ];

  return nestedCandidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0) || [];
}

export function normalizeRunPath(runOrPath) {
  const rawPath = getRunPathCandidate(runOrPath);

  return (Array.isArray(rawPath) ? rawPath : [])
    .map(normalizePoint)
    .filter(Boolean);
}

export default normalizeRunPath;
