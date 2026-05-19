import { normalizeRunPath } from "./runPath.js";

const EARTH_RADIUS_M = 6371000;
const MAX_SECONDS_BEFORE_ASSUMING_MS = 24 * 60 * 60;

function toRad(value) {
  return (Number(value) * Math.PI) / 180;
}

export function calculateDistanceMeters(pointA, pointB) {
  if (!pointA || !pointB) return 0;

  const latA = Number(pointA.latitude);
  const latB = Number(pointB.latitude);
  const lonA = Number(pointA.longitude);
  const lonB = Number(pointB.longitude);
  if (![latA, latB, lonA, lonB].every(Number.isFinite)) return 0;

  const deltaLat = toRad(latB - latA);
  const deltaLon = toRad(lonB - lonA);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(deltaLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function calculatePathDistanceMeters(path = []) {
  const points = normalizeRunPath(path);
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += calculateDistanceMeters(points[index - 1], points[index]);
  }

  return total;
}

function normalizeDurationValue(value, { forceMs = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (forceMs) return number / 1000;
  return number > MAX_SECONDS_BEFORE_ASSUMING_MS ? number / 1000 : number;
}

export function getRunDurationSeconds(run = {}) {
  const candidates = [
    { value: run?.durationSeconds },
    { value: run?.elapsedSeconds },
    { value: run?.movingTimeSeconds },
    { value: run?.summary?.durationSeconds },
    { value: run?.metadata?.durationSeconds },
    { value: run?.duration },
    { value: run?.time },
    { value: run?.elapsedTime },
    { value: run?.durationMs, forceMs: true },
    { value: run?.elapsedMs, forceMs: true },
    { value: run?.summary?.durationMs, forceMs: true },
    { value: run?.metadata?.durationMs, forceMs: true },
  ];

  for (const candidate of candidates) {
    const seconds = normalizeDurationValue(candidate.value, candidate);
    if (seconds > 0) return seconds;
  }

  return 0;
}

export function getRunDistanceMeters(run = {}, fallbackMeters = 0) {
  const meterCandidates = [
    run?.distanceMeters,
    run?.totalMeters,
    run?.summary?.distanceMeters,
    run?.metadata?.distanceMeters,
    run?.distance,
    run?.totalDistance,
  ];

  for (const candidate of meterCandidates) {
    const meters = Number(candidate);
    if (Number.isFinite(meters) && meters > 0) return meters;
  }

  const kmCandidates = [
    run?.distanceKm,
    run?.km,
    run?.summary?.distanceKm,
    run?.metadata?.distanceKm,
  ];

  for (const candidate of kmCandidates) {
    const kilometers = Number(candidate);
    if (Number.isFinite(kilometers) && kilometers > 0) return kilometers * 1000;
  }

  return Number.isFinite(Number(fallbackMeters)) ? Number(fallbackMeters) : 0;
}

function parseTimestampCandidate(value, numericMode) {
  if (value == null) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (numericMode === "seconds") return value * 1000;
    if (numericMode === "milliseconds") return value;
    if (value > 1e12) return value;
    if (value > 1e8) return value * 1000;
    return value;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferNumericTimestampMode(points = []) {
  const numeric = points
    .map((point) => point?.timestamp)
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  if (numeric.length < 2) return "auto";

  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const range = max - min;
  const deltas = [];

  for (let index = 1; index < numeric.length; index += 1) {
    const delta = Math.abs(numeric[index] - numeric[index - 1]);
    if (delta > 0) deltas.push(delta);
  }

  const medianDelta = deltas.length
    ? deltas.slice().sort((a, b) => a - b)[Math.floor(deltas.length / 2)]
    : 0;

  if (max > 1e12) return "milliseconds";
  if (max > 1e8) return "seconds";
  if (medianDelta > 100) return "milliseconds";
  if (range > 10000) return "milliseconds";
  return "seconds";
}

function getTimestampTimeline(points = []) {
  const numericMode = inferNumericTimestampMode(points);
  const stamps = points.map((point) => parseTimestampCandidate(point?.timestamp, numericMode));
  const first = stamps.find((stamp) => Number.isFinite(stamp));
  const last = [...stamps].reverse().find((stamp) => Number.isFinite(stamp));

  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;

  const output = [];
  let previous = 0;

  for (const stamp of stamps) {
    if (!Number.isFinite(stamp)) {
      output.push(previous);
      continue;
    }

    previous = Math.max(previous, (stamp - first) / 1000);
    output.push(previous);
  }

  return output[output.length - 1] > 0 ? output : null;
}

export function buildRunReplayTimeline(runOrPath, options = {}) {
  const path = normalizeRunPath(runOrPath);
  if (path.length === 0) {
    return { path: [], timeline: [], totalMeters: 0, totalDurationSeconds: 0 };
  }

  const segments = [0];
  let totalMeters = 0;
  for (let index = 1; index < path.length; index += 1) {
    const meters = calculateDistanceMeters(path[index - 1], path[index]);
    segments[index] = meters;
    totalMeters += meters;
  }

  const timestampTimes = getTimestampTimeline(path);
  const runDuration = getRunDurationSeconds(options.run || (Array.isArray(runOrPath) ? {} : runOrPath));
  const fallbackDuration = path.length > 1 ? Math.max(1, (path.length - 1) * 0.25) : 0;
  const totalDurationSeconds =
    timestampTimes?.[timestampTimes.length - 1] ||
    runDuration ||
    fallbackDuration;

  const timeline = [];
  let cumulativeMeters = 0;

  for (let index = 0; index < path.length; index += 1) {
    if (index > 0) cumulativeMeters += segments[index] || 0;
    const cumulativeTime = timestampTimes
      ? timestampTimes[index]
      : totalMeters > 0
        ? (cumulativeMeters / totalMeters) * totalDurationSeconds
        : (index / Math.max(1, path.length - 1)) * totalDurationSeconds;

    timeline.push({
      ...path[index],
      cumulativeMeters,
      cumulativeTime,
    });
  }

  return {
    path,
    timeline,
    totalMeters,
    totalDurationSeconds: timeline[timeline.length - 1]?.cumulativeTime || totalDurationSeconds,
  };
}

export function getReplayIndexForElapsed(timeline = [], elapsedSeconds = 0) {
  if (!Array.isArray(timeline) || timeline.length === 0) return -1;
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
  let index = 0;

  while (index < timeline.length - 1 && Number(timeline[index + 1]?.cumulativeTime || 0) <= elapsed) {
    index += 1;
  }

  return index;
}

export function getReplayRunStats(run = {}, timeline = []) {
  const fallbackMeters = Number(timeline[timeline.length - 1]?.cumulativeMeters || 0);
  const fallbackSeconds = Number(timeline[timeline.length - 1]?.cumulativeTime || 0);
  const distanceMeters = getRunDistanceMeters(run, fallbackMeters);
  const durationSeconds = getRunDurationSeconds(run) || fallbackSeconds;

  return {
    distanceMeters,
    durationSeconds,
  };
}
