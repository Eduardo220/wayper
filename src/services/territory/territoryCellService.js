import { calculateGeometryBbox } from "./territoryGeometryService.js";

export const DEFAULT_TERRITORY_CELL_PRECISION = 0.005;

const MAX_CELLS_PER_BBOX = 2500;

function normalizePrecision(precision = DEFAULT_TERRITORY_CELL_PRECISION) {
  const value = Number(precision);
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TERRITORY_CELL_PRECISION;
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundBucket(value) {
  return Number(value.toFixed(6));
}

function getBucket(value, precision) {
  return roundBucket(Math.floor(value / precision) * precision);
}

function parseCellId(cellId) {
  if (typeof cellId !== "string") return null;
  const [latRaw, lngRaw] = cellId.split(":");
  const latitude = toFiniteNumber(latRaw);
  const longitude = toFiniteNumber(lngRaw);
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

function normalizeBbox(bbox) {
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const minLng = toFiniteNumber(bbox[0]);
    const minLat = toFiniteNumber(bbox[1]);
    const maxLng = toFiniteNumber(bbox[2]);
    const maxLat = toFiniteNumber(bbox[3]);
    if ([minLng, minLat, maxLng, maxLat].every((value) => value != null)) {
      return {
        minLng: Math.min(minLng, maxLng),
        minLat: Math.min(minLat, maxLat),
        maxLng: Math.max(minLng, maxLng),
        maxLat: Math.max(minLat, maxLat),
      };
    }
  }

  if (bbox && typeof bbox === "object") {
    const minLng = toFiniteNumber(bbox.minLng ?? bbox.west ?? bbox.longitudeMin);
    const minLat = toFiniteNumber(bbox.minLat ?? bbox.south ?? bbox.latitudeMin);
    const maxLng = toFiniteNumber(bbox.maxLng ?? bbox.east ?? bbox.longitudeMax);
    const maxLat = toFiniteNumber(bbox.maxLat ?? bbox.north ?? bbox.latitudeMax);
    if ([minLng, minLat, maxLng, maxLat].every((value) => value != null)) {
      return {
        minLng: Math.min(minLng, maxLng),
        minLat: Math.min(minLat, maxLat),
        maxLng: Math.max(minLng, maxLng),
        maxLat: Math.max(minLat, maxLat),
      };
    }
  }

  return null;
}

export function getCellIdForLocation(location, precision = DEFAULT_TERRITORY_CELL_PRECISION) {
  const latitude = toFiniteNumber(location?.latitude ?? location?.lat);
  const longitude = toFiniteNumber(location?.longitude ?? location?.lng ?? location?.lon);
  const safePrecision = normalizePrecision(precision);

  if (
    latitude == null ||
    longitude == null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return `${getBucket(latitude, safePrecision)}:${getBucket(longitude, safePrecision)}`;
}

export function getCellIdsForBbox(bbox, precision = DEFAULT_TERRITORY_CELL_PRECISION) {
  const normalized = normalizeBbox(bbox);
  if (!normalized) return [];

  const safePrecision = normalizePrecision(precision);
  const minLatBucket = getBucket(normalized.minLat, safePrecision);
  const maxLatBucket = getBucket(normalized.maxLat, safePrecision);
  const minLngBucket = getBucket(normalized.minLng, safePrecision);
  const maxLngBucket = getBucket(normalized.maxLng, safePrecision);
  const cellIds = [];

  for (
    let lat = minLatBucket;
    lat <= maxLatBucket + safePrecision / 2;
    lat = roundBucket(lat + safePrecision)
  ) {
    for (
      let lng = minLngBucket;
      lng <= maxLngBucket + safePrecision / 2;
      lng = roundBucket(lng + safePrecision)
    ) {
      cellIds.push(`${lat}:${lng}`);
      if (cellIds.length >= MAX_CELLS_PER_BBOX) return cellIds;
    }
  }

  return Array.from(new Set(cellIds));
}

export function getCellIdsForGeometry(geometry, precision = DEFAULT_TERRITORY_CELL_PRECISION) {
  const bbox = calculateGeometryBbox(geometry);
  return getCellIdsForBbox(bbox, precision);
}

export function getCellPolygon(cellId, precision = DEFAULT_TERRITORY_CELL_PRECISION) {
  const parsed = parseCellId(cellId);
  if (!parsed) return null;

  const safePrecision = normalizePrecision(precision);
  const minLat = parsed.latitude;
  const minLng = parsed.longitude;
  const maxLat = roundBucket(minLat + safePrecision);
  const maxLng = roundBucket(minLng + safePrecision);

  return {
    type: "Polygon",
    coordinates: [
      [
        [minLng, minLat],
        [minLng, maxLat],
        [maxLng, maxLat],
        [maxLng, minLat],
        [minLng, minLat],
      ],
    ],
  };
}

export function getCellCenter(cellId, precision = DEFAULT_TERRITORY_CELL_PRECISION) {
  const parsed = parseCellId(cellId);
  if (!parsed) return null;

  const safePrecision = normalizePrecision(precision);
  return {
    latitude: roundBucket(parsed.latitude + safePrecision / 2),
    longitude: roundBucket(parsed.longitude + safePrecision / 2),
  };
}

export default {
  DEFAULT_TERRITORY_CELL_PRECISION,
  getCellIdForLocation,
  getCellIdsForBbox,
  getCellIdsForGeometry,
  getCellPolygon,
  getCellCenter,
};

