// src/utils/geo.js
import * as turf from "@turf/turf";

// meters
export function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculateArea(coords = []) {
  if (coords.length < 3) return 0;
  const poly = turf.polygon([coords.map((p) => [p.longitude, p.latitude])]);
  return turf.area(poly); // m²
}

export function formatArea(area) {
  if (!area) return "-";
  return area > 10000 ? `${(area / 1e6).toFixed(2)} km²` : `${Math.round(area)} m²`;
}
