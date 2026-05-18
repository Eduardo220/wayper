export const MIN_DISTANCE_FOR_PACE_KM = 0.1;

export function calculatePaceSecondsPerKm(
  durationSeconds,
  distanceKm,
  minDistanceKm = MIN_DISTANCE_FOR_PACE_KM
) {
  const duration = Number(durationSeconds);
  const distance = Number(distanceKm);

  if (
    !Number.isFinite(duration) ||
    !Number.isFinite(distance) ||
    duration <= 0 ||
    distance <= 0 ||
    distance < minDistanceKm
  ) {
    return null;
  }

  return Math.round(duration / distance);
}

export function formatPaceFromSeconds(paceSecondsPerKm) {
  const pace = Number(paceSecondsPerKm);

  if (!Number.isFinite(pace) || pace <= 0) {
    return "--:--";
  }

  const total = Math.round(pace);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function getFormattedPace(durationSeconds, distanceKm, options = {}) {
  const {
    minDistanceKm = MIN_DISTANCE_FOR_PACE_KM,
    suffix = "",
    fallback = "--:--",
  } = options;

  const paceSecondsPerKm = calculatePaceSecondsPerKm(
    durationSeconds,
    distanceKm,
    minDistanceKm
  );

  if (paceSecondsPerKm === null) {
    return fallback;
  }

  return `${formatPaceFromSeconds(paceSecondsPerKm)}${suffix}`;
}
