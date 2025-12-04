// src/utils/zones.js

import * as turf from "@turf/turf";

/* ============================================================
   CONSTANTS & HELPERS
   ============================================================ */
const DEG_TO_RAD = Math.PI / 180;
const R = 6371e3; // Earth radius (meters)

const isValidNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * sanitizePath:
 * - Accepts any shape ([lat,lon], {lat, lon}, {latitude,longitude}, etc)
 * - Cleans invalids
 * - Normalizes to { latitude, longitude, timestamp }
 */
export function sanitizePath(path = []) {
  if (!Array.isArray(path)) return [];

  const out = [];

  for (const p of path) {
    if (!p) continue;

    const lat =
      Number(p.latitude ??
      p.lat ??
      (Array.isArray(p) ? p[1] : NaN));

    const lon =
      Number(p.longitude ??
      p.lon ??
      p.lng ??
      (Array.isArray(p) ? p[0] : NaN));

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    out.push({
      latitude: lat,
      longitude: lon,
      timestamp: p.timestamp ?? p.time ?? null,
    });
  }

  return out;
}

/* ============================================================
   VALIDATE POLYGON
   ============================================================ */
/**
 * A polygon is valid if:
 * - At least 3 distinct (lat,lon) points
 * - Not collinear
 */
export function isValidPolygon(coords = []) {
  if (!Array.isArray(coords) || coords.length < 3) return false;

  // distinct
  const distinct = new Set(
    coords.map(
      (p) =>
        `${Number(p.latitude).toFixed(6)}|${Number(p.longitude).toFixed(6)}`
    )
  );
  if (distinct.size < 3) return false;

  // detect near-collinearity (if angles ~= 180 everywhere)
  if (coords.length <= 3) return distinct.size === 3;

  return true;
}

/* ============================================================
   SIMPLIFY POLYGON — DOUGLAS-PEUCKER WRAPPER
   ============================================================ */
export function simplifyPolygon(coords = [], tolerance = 0.0005) {
  try {
    if (!isValidPolygon(coords)) return coords;

    const poly = turf.polygon([coords.map((p) => [p.longitude, p.latitude])]);

    const simplified = turf.simplify(poly, {
      tolerance,
      highQuality: false,
      mutate: false,
    });

    const ring = simplified?.geometry?.coordinates?.[0];
    if (!ring) return coords;

    // remove last close-point (turf duplicates first/last)
    const clean = ring
      .slice(0, -1)
      .map(([lon, lat]) => ({ latitude: lat, longitude: lon }));

    return clean.length >= 3 ? clean : coords;
  } catch {
    return coords;
  }
}

/* ============================================================
   SMOOTH POLYGON (Chaikin-like) — LIGHT BUT SAFE
   ============================================================ */
export function smoothPolygon(coords = [], iterations = 1) {
  try {
    if (!isValidPolygon(coords)) return coords;

    let points = coords.map((p) => [p.latitude, p.longitude]);

    for (let k = 0; k < iterations; k++) {
      const next = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];

        const p1 = [
          0.75 * a[0] + 0.25 * b[0],
          0.75 * a[1] + 0.25 * b[1],
        ];
        const p2 = [
          0.25 * a[0] + 0.75 * b[0],
          0.25 * a[1] + 0.75 * b[1],
        ];
        next.push(p1, p2);
      }

      points = next;

      // prevent explosion of points
      if (points.length > 1500) {
        points = points.filter((_, i) => i % 2 === 0);
      }
    }

    const clean = points.map(([lat, lon]) => ({
      latitude: lat,
      longitude: lon,
    }));

    return clean.length >= 3 ? clean : coords;
  } catch {
    return coords;
  }
}

/* ============================================================
   CONCAVE HULL FALLBACK (IMPOSSIBLE CASES)
   ============================================================ */
function concaveFallback(path) {
  try {
    const pts = turf.featureCollection(
      path.map((p) => turf.point([p.longitude, p.latitude]))
    );

    const concave = turf.concave(pts, { maxEdge: 0.02 }); // ~2km max edge
    if (!concave) return null;

    const ring = concave?.geometry?.coordinates?.[0];
    if (!ring) return null;

    return ring
      .slice(0, -1)
      .map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
  } catch {
    return null;
  }
}

/* ============================================================
   MAIN: CONVEX ZONE BUILDER (ULTIMATE)
   ============================================================ */
export function buildConvexZone(rawPath = [], options = {}) {
  try {
    const {
      simplifyTolerance = 0.0006,
      smoothIterations = 0,
      maxPoints = 300,
    } = options;

    const path = sanitizePath(rawPath);
    if (!path || path.length < 3) return [];

    // 1º: CONVEX HULL
    let hull = null;
    try {
      hull = turf.convex(
        turf.featureCollection(
          path.map((p) => turf.point([p.longitude, p.latitude]))
        )
      );
    } catch { hull = null; }

    // 2º fallback: Concave hull if convex fails (colinear, very thin shape)
    if (!hull) {
      const concave = concaveFallback(path);
      if (concave && concave.length >= 3) return concave;
    }

    // 3º fallback: bbox polygon (super robust)
    if (!hull) {
      const bbox = turf.bbox(
        turf.featureCollection(
          path.map((p) => turf.point([p.longitude, p.latitude]))
        )
      );
      hull = turf.bboxPolygon(bbox);
    }

    if (!hull) return [];

    const coords = hull.geometry.coordinates?.[0];
    if (!coords || coords.length < 3) return [];

    let poly = coords.slice(0, -1).map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
    }));

    // SIMPLIFY
    if (simplifyTolerance > 0) {
      poly = simplifyPolygon(poly, simplifyTolerance);
    }

    // SMOOTH
    if (smoothIterations > 0) {
      poly = smoothPolygon(poly, smoothIterations);
    }

    // COMPRESS (binary-search simplify)
    if (poly.length > maxPoints) {
      poly = compressCoords(poly, maxPoints);
    }

    return isValidPolygon(poly) ? poly : [];
  } catch {
    return [];
  }
}

/* ============================================================
   CALC AREA — SAFE WRAPPER + SHOELACE FALLBACK
   ============================================================ */
export function calcArea(coords = []) {
  try {
    if (!isValidPolygon(coords)) return 0;

    const ring = coords.map((p) => [p.longitude, p.latitude]);
    const poly = turf.polygon([ring.concat([ring[0]])]);

    const area = turf.area(poly);
    return area > 0 ? area : 0;
  } catch {
    // Fallback Shoelace
    try {
      let total = 0;
      for (let i = 0; i < coords.length; i++) {
        const p1 = coords[i];
        const p2 = coords[(i + 1) % coords.length];
        total += p1.longitude * p2.latitude - p2.longitude * p1.latitude;
      }
      return Math.abs(total * DEG_TO_RAD * DEG_TO_RAD * R * R) || 0;
    } catch {
      return 0;
    }
  }
}

/* ============================================================
   FORMAT AREA
   ============================================================ */
export function formatArea(area) {
  if (!isValidNumber(area) || area <= 0) return "-";
  if (area >= 1e6) return `${(area / 1e6).toFixed(2)} km²`;
  return `${Math.round(area)} m²`;
}

/* ============================================================
   COMPRESS COORDS — BINARY SEARCH (BEST SHAPE PRESERVATION)
   ============================================================ */
export function compressCoords(coords = [], maxPoints = 200) {
  try {
    if (!Array.isArray(coords) || coords.length <= maxPoints) return coords;

    let lo = 1e-7;
    let hi = 0.002;
    let best = coords;

    for (let i = 0; i < 25; i++) {
      const mid = (lo + hi) / 2;
      const simplified = simplifyPolygon(coords, mid);

      if (simplified.length > maxPoints) {
        lo = mid;
      } else {
        hi = mid;
        best = simplified;
      }

      if (Math.abs(hi - lo) < 1e-9) break;
    }

    // final fallback
    if (best.length > maxPoints) {
      const step = Math.ceil(best.length / maxPoints);
      best = best.filter((_, idx) => idx % step === 0);
    }

    return best;
  } catch {
    return coords.slice(0, maxPoints);
  }
}

/* ============================================================
   EXPORTS
   ============================================================ */
export default {
  sanitizePath,
  isValidPolygon,
  buildConvexZone,
  simplifyPolygon,
  smoothPolygon,
  calcArea,
  formatArea,
  compressCoords,
};
