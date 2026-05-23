// src/services/ranking/compute.js
import { RANK_FIELDS } from "./constants.js";

const safeNum = (v, fallback = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;

export const DEFAULT_WEIGHTS = {
  zones: 1.0,
  area: 0.6,
  distance: 0.6,
  xp: 0.8,
  elo: 0.9,
  runs: 0.7,
  speed: 0.5,
  weeklyPoints: 1.2,   // boosters para modos
  monthlyPoints: 1.0,
  monthlyArea: 0.9,
  monthlyDistance: 0.9,
};

export function cleanUser(doc) {
  return {
    id: doc.id,
    name: doc.name || "Jogador",
    avatar: doc.avatar || doc.photoURL || null,
    city: doc.city || "",
    neighborhood: doc.neighborhood || "",

    zones: safeNum(doc.totalZones ?? doc.zones),
    area: safeNum(doc.totalArea ?? doc.area),
    distance: safeNum(doc.totalDistance ?? doc.distance),
    xp: safeNum(doc.xp),
    eloScore: safeNum(doc.eloScore, 1000),
    totalRuns: safeNum(doc.totalRuns),
    topSpeed: safeNum(doc.topSpeed),

    weeklyPoints: safeNum(doc.weeklyPoints),
    monthlyPoints: safeNum(doc.monthlyPoints),
    monthlyArea: safeNum(doc.monthlyArea ?? doc.totalArea ?? doc.area),
    monthlyDistance: safeNum(doc.monthlyDistance ?? doc.totalDistance ?? doc.distance),
    totalStolenAreaM2: safeNum(doc.totalStolenAreaM2),
    totalLostAreaM2: safeNum(doc.totalLostAreaM2),
    cellsLedCount: safeNum(doc.cellsLedCount),
    territoryCapturesCount: safeNum(doc.territoryCapturesCount),
    territoryStealsCount: safeNum(doc.territoryStealsCount),
    territoryConqueredCount: safeNum(doc.territoryConqueredCount),

    raw: doc,
  };
}

function zScoreNormalize(arr) {
  const n = arr.length;
  if (n === 0) return [];
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance) || 1;
  return arr.map((v) => (v - mean) / sd);
}

function assignPositions(arr) {
  const sorted = arr
    .slice()
    .sort((a, b) => safeNum(b.score) - safeNum(a.score));

  const positions = {};
  let position = 1;

  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].score < sorted[i - 1].score) {
      position = i + 1;
    }
    positions[sorted[i].id] = position;
  }
  return positions;
}

export function computeLeaderboard(rawUsers, { weights, primary }) {
  const cleaned = rawUsers.map(cleanUser);

  const metrics = Object.keys(weights);
  const arrays = {};

  metrics.forEach((m) => {
    const field = RANK_FIELDS[m] || m;
    arrays[m] = cleaned.map((u) => safeNum(u[field], 0));
  });

  const zscores = {};
  metrics.forEach((m) => (zscores[m] = zScoreNormalize(arrays[m])));

  const scored = cleaned.map((u, i) => {
    let score = 0;
    const components = {};

    metrics.forEach((m) => {
      const z = zscores[m][i] || 0;
      const w = weights[m] || 0;
      components[m] = { raw: arrays[m][i], z, w };
      score += z * w;
    });

    const rawPrimary = safeNum(u[primary], 0);
    score += rawPrimary * 1e-6;

    return { ...u, score, components };
  });

  scored.sort((a, b) => b.score - a.score);

  const positions = assignPositions(scored);

  return scored.map((s) => ({
    ...s,
    rank: positions[s.id],
  }));
}
