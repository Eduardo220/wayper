import { getGpsQualityLevel, summarizeGpsQuality } from "./gpsQuality.js";
import { normalizeTrackPoint } from "./pointFilters.js";

export const RUN_WATCH_TIME_INTERVAL_MS = 1000;
export const RUN_WATCH_DISTANCE_INTERVAL_M = 2.5;
export const GPS_WARMUP_DEFAULT_MS = 5500;

export function getBestRunAccuracy(Location) {
  return Location?.Accuracy?.BestForNavigation ??
    Location?.Accuracy?.Highest ??
    Location?.Accuracy?.High;
}

export function getRunWatchPositionOptions(Location, overrides = {}) {
  return {
    accuracy: getBestRunAccuracy(Location),
    timeInterval: RUN_WATCH_TIME_INTERVAL_MS,
    distanceInterval: RUN_WATCH_DISTANCE_INTERVAL_M,
    mayShowUserSettingsDialog: true,
    ...overrides,
  };
}

export function getRunBackgroundLocationOptions(Location, notificationBody, overrides = {}) {
  const {
    notificationColor,
    useForegroundService = true,
    ...locationOverrides
  } = overrides;

  const options = {
    accuracy: getBestRunAccuracy(Location),
    timeInterval: RUN_WATCH_TIME_INTERVAL_MS,
    distanceInterval: RUN_WATCH_DISTANCE_INTERVAL_M,
    deferredUpdatesInterval: RUN_WATCH_TIME_INTERVAL_MS,
    deferredUpdatesDistance: 0,
    pausesUpdatesAutomatically: false,
    activityType: Location?.ActivityType?.Fitness,
    ...locationOverrides,
  };

  if (useForegroundService) {
    options.foregroundService = {
      notificationTitle: "Wayper registrando corrida",
      notificationBody: notificationBody || "Sua corrida esta sendo salva mesmo com a tela bloqueada.",
      notificationColor,
      killServiceOnDestroy: false,
    };
  }

  return options;
}

export async function enableNetworkProviderForRun(Location, Platform) {
  if (Platform?.OS !== "android" || typeof Location?.enableNetworkProviderAsync !== "function") {
    return false;
  }

  try {
    await Location.enableNetworkProviderAsync();
    return true;
  } catch {
    return false;
  }
}

export async function warmUpGpsForRun(Location, options = {}) {
  const {
    durationMs = GPS_WARMUP_DEFAULT_MS,
    acceptableAccuracyM = 25,
    poorAccuracyM = 35,
    onPoint,
  } = options;

  const points = [];
  let subscription = null;
  const startedAt = Date.now();
  const pushPoint = (location) => {
    const point = normalizeTrackPoint(location);
    if (!point) return;
    points.push(point);
    if (typeof onPoint === "function") onPoint(point);
  };

  try {
    subscription = await Location.watchPositionAsync(
      getRunWatchPositionOptions(Location, { distanceInterval: 0, timeInterval: 1000 }),
      pushPoint
    );
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  } catch {
    while (Date.now() - startedAt < durationMs) {
      try {
        const point = await Location.getCurrentPositionAsync({ accuracy: getBestRunAccuracy(Location) });
        pushPoint(point);
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  } finally {
    try {
      subscription?.remove?.();
    } catch {}
  }

  const accuracies = points
    .map((point) => Number(point.accuracy))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const bestAccuracy = accuracies.length > 0 ? Math.min(...accuracies) : null;
  const bestPoint = bestAccuracy == null
    ? points[points.length - 1] || null
    : points.find((point) => Number(point.accuracy) === bestAccuracy) || points[points.length - 1] || null;
  const averageAccuracy = accuracies.length > 0
    ? accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length
    : null;
  const qualityLevel = getGpsQualityLevel(bestAccuracy);
  const quality = summarizeGpsQuality({
    rawPoints: points,
    filteredPoints: bestPoint ? [bestPoint] : [],
  });

  return {
    points,
    bestPoint,
    bestAccuracy,
    averageAccuracy,
    qualityLevel,
    quality,
    ok: bestAccuracy != null && bestAccuracy <= acceptableAccuracyM,
    poor: bestAccuracy == null || bestAccuracy > poorAccuracyM,
  };
}

export default {
  GPS_WARMUP_DEFAULT_MS,
  RUN_WATCH_DISTANCE_INTERVAL_M,
  RUN_WATCH_TIME_INTERVAL_MS,
  enableNetworkProviderForRun,
  getBestRunAccuracy,
  getRunBackgroundLocationOptions,
  getRunWatchPositionOptions,
  warmUpGpsForRun,
};
