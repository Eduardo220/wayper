// src/utils/geo.js
import * as turf from "@turf/turf";

/* -----------------------------------------------------
   CONSTANTES REUTILIZADAS (evita alocação repetida)
------------------------------------------------------ */
const R = 6371e3;                  // raio da terra em metros
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/* -----------------------------------------------------
   SANITIZAÇÃO (evita crash por dados quebrados)
------------------------------------------------------ */
const isValidNumber = (n) => typeof n === "number" && Number.isFinite(n);

/* -----------------------------------------------------
   HAVERSINE SUPER OTIMIZADO (100% exato e rápido)
   - evita allocations
   - evita trigonometria repetida
   - protege contra NaN
------------------------------------------------------ */
export function getDistance(lat1, lon1, lat2, lon2) {
  if (
    !isValidNumber(lat1) ||
    !isValidNumber(lon1) ||
    !isValidNumber(lat2) ||
    !isValidNumber(lon2)
  )
    return 0;

  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;

  const dφ = (lat2 - lat1) * DEG_TO_RAD;
  const dλ = (lon2 - lon1) * DEG_TO_RAD;

  const sin_dφ = Math.sin(dφ * 0.5);
  const sin_dλ = Math.sin(dλ * 0.5);

  const a =
    sin_dφ * sin_dφ +
    Math.cos(φ1) * Math.cos(φ2) * sin_dλ * sin_dλ;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c || 0;
}

/* -----------------------------------------------------
   MEMOIZADOR MICRO (melhora eficiência do MapScreen)
   melhor para apps que chamam getDistance MUITO
   ex: "running", que calcula 1-2x por segundo
------------------------------------------------------ */
const _memo = new Map();
export function getDistanceMemo(lat1, lon1, lat2, lon2) {
  const key =
    lat1.toFixed(6) +
    "|" +
    lon1.toFixed(6) +
    "|" +
    lat2.toFixed(6) +
    "|" +
    lon2.toFixed(6);

  const cached = _memo.get(key);
  if (cached) return cached;

  const result = getDistance(lat1, lon1, lat2, lon2);
  _memo.set(key, result);

  // tamanho máximo (evita memory leak em rotas longas)
  if (_memo.size > 5000) _memo.clear();

  return result;
}

/* -----------------------------------------------------
   CALCULAR ÁREA – versão ultra estável
   - protege contra coords inválidas
   - corrige loops abertos
   - fallback caso o Turf falhe
------------------------------------------------------ */
export function calculateArea(coords = []) {
  try {
    if (!Array.isArray(coords) || coords.length < 3) return 0;

    // sanitizar
    const clean = coords
      .filter(
        (p) =>
          p &&
          isValidNumber(p.latitude) &&
          isValidNumber(p.longitude)
      )
      .map((p) => [p.longitude, p.latitude]);

    if (clean.length < 3) return 0;

    // garantir polígono fechado (Turf exige)
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      clean.push([first[0], first[1]]);
    }

    const poly = turf.polygon([clean]);
    const area = turf.area(poly);

    if (!isValidNumber(area) || area < 0) return 0;

    return area;
  } catch (err) {
    // fallback manual (shoelace spherical approximation)
    try {
      let total = 0;
      for (let i = 0, l = coords.length; i < l - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        total += p1.longitude * p2.latitude - p2.longitude * p1.latitude;
      }
      return Math.abs(total * DEG_TO_RAD * DEG_TO_RAD * R * R) || 0;
    } catch {
      return 0;
    }
  }
}

/* -----------------------------------------------------
   FORMATAR ÁREA – seguro e rápido
------------------------------------------------------ */
export function formatArea(area) {
  if (!isValidNumber(area) || area <= 0) return "-";

  if (area > 1e6) return `${(area / 1e6).toFixed(2)} km²`;

  return `${Math.round(area)} m²`;
}
