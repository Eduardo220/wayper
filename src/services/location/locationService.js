// src/services/location/locationService.js

import * as Location from "expo-location";

const DEFAULTS = {
  timeInterval: 1000, // ms
  distanceInterval: 1, // meters
  accuracy: Location.Accuracy.BestForNavigation,
  minAccuracy: 100, // meters - ignore readings worse than this by default
  debounceMillis: 500, // minimal time between emitted points to reduce floods
  maxSpikeDistance: 1000, // meters - ignore absurd jumps
  maxRetryAttempts: 3, // for optional read retry/backoff
  retryBackoffBaseMs: 300, // base ms for exponential backoff
  requestPermissionRationale: {
    title: "Permissão de localização",
    message: "O app precisa acessar sua localização para registrar corridas e zonas.",
    buttonPositive: "OK",
  },
};

let _cachedPermission = null; // 'granted' | 'denied' | null
let _debug = false;

/* --------------------- debug util --------------------- */
function debug(...args) {
  if (_debug) {
    // eslint-disable-next-line no-console
    console.log("[locationService]", ...args);
  }
}

/* --------------------- small helpers --------------------- */
const safeNum = (v, fallback = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;

function nowTs() {
  return Date.now();
}

function sanitizeCoordsFromLocationObj(loc) {
  if (!loc || !loc.coords) return null;
  const { latitude, longitude, accuracy } = loc.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude: Number(latitude),
    longitude: Number(longitude),
    accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
    timestamp: loc.timestamp || nowTs(),
  };
}

/* --------------------- Permission helpers --------------------- */
/**
 * requestLocationPermission(opts)
 * - opts: { force?: boolean } -> if force true, will request even if already cached
 * - returns: { granted: boolean, status: string }
 */
export async function requestLocationPermission(opts = {}) {
  try {
    const force = !!opts.force;
    if (!force && _cachedPermission === "granted") {
      return { granted: true, status: "granted" };
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    _cachedPermission = status;
    return { granted: status === "granted", status };
  } catch (e) {
    debug("requestLocationPermission error", e);
    return { granted: false, status: "unknown", error: e };
  }
}

/* --------------------- getCurrentPosition --------------------- */
/**
 * getCurrentPosition(opts)
 * opts: {
 *   accuracy, timeoutMs, maxRetryAttempts, retryBackoffBaseMs
 * }
 *
 * returns: { coords: {latitude,longitude,accuracy,timestamp}, raw, error }
 */
export async function getCurrentPosition(opts = {}) {
  const {
    accuracy = DEFAULTS.accuracy,
    timeoutMs = 8000,
    maxRetryAttempts = DEFAULTS.maxRetryAttempts,
    retryBackoffBaseMs = DEFAULTS.retryBackoffBaseMs,
  } = opts;

  try {
    // ensure permission first
    const perm = await requestLocationPermission({ force: false });
    if (!perm.granted) {
      return { coords: null, raw: null, error: new Error("permission_denied") };
    }

    let attempts = 0;
    let lastErr = null;
    while (attempts <= maxRetryAttempts) {
      attempts += 1;
      try {
        const p = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
        ]);
        const sanitized = sanitizeCoordsFromLocationObj(p);
        if (!sanitized) {
          lastErr = new Error("invalid_location");
          throw lastErr;
        }
        return { coords: sanitized, raw: p, error: null };
      } catch (e) {
        lastErr = e;
        debug("getCurrentPosition attempt failed", attempts, e);
        if (attempts > maxRetryAttempts) break;
        // exponential backoff
        const wait = retryBackoffBaseMs * 2 ** (attempts - 1);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => setTimeout(res, wait));
      }
    }
    return { coords: null, raw: null, error: lastErr || new Error("unknown") };
  } catch (err) {
    debug("getCurrentPosition catch", err);
    return { coords: null, raw: null, error: err };
  }
}

/* --------------------- watchPosition (advanced) --------------------- */
/**
 * watchPosition(onChange, opts)
 *
 * onChange receives sanitized coords: { latitude, longitude, accuracy, timestamp }
 *
 * opts:
 *  - accuracy (expo Location accuracy)
 *  - timeInterval (ms)
 *  - distanceInterval (meters)
 *  - minAccuracy (meters) -> ignore readings with worse accuracy
 *  - debounceMillis (ms) -> minimum interval between emitted points
 *  - minDistance (meters) -> minimal distance moved to emit
 *  - maxSpikeDistance (meters) -> ignore jumps > this
 *  - backoffOnFail: { enabled: boolean, maxAttempts }
 *
 * Returns watcher control:
 *  {
 *    remove: () => void,
 *    pause: () => void,
 *    resume: () => Promise<void>,
 *    isWatching: () => boolean
 *  }
 */
export async function watchPosition(onChange, opts = {}) {
  const config = {
    accuracy: opts.accuracy ?? DEFAULTS.accuracy,
    timeInterval: opts.timeInterval ?? DEFAULTS.timeInterval,
    distanceInterval: opts.distanceInterval ?? DEFAULTS.distanceInterval,
    minAccuracy: opts.minAccuracy ?? DEFAULTS.minAccuracy,
    debounceMillis: opts.debounceMillis ?? DEFAULTS.debounceMillis,
    minDistance: opts.minDistance ?? 0,
    maxSpikeDistance: opts.maxSpikeDistance ?? DEFAULTS.maxSpikeDistance,
    backoffOnFail: opts.backoffOnFail ?? { enabled: false, maxAttempts: DEFAULTS.maxRetryAttempts },
  };

  if (typeof onChange !== "function") {
    throw new Error("watchPosition: onChange must be a function");
  }

  // ensure permission
  const perm = await requestLocationPermission({ force: false });
  if (!perm.granted) {
    // return a dummy controller that does nothing but allows the caller to call remove()
    return {
      remove: () => {},
      pause: () => {},
      resume: async () => {},
      isWatching: () => false,
    };
  }

  let sub = null;
  let isPaused = false;
  let isRemoved = false;
  let lastEmitTs = 0;
  let lastEmitPoint = null;
  let failAttempts = 0;

  // internal emitter guard: apply filters and call onChange only when sane
  const tryEmit = (raw) => {
    try {
      const p = sanitizeCoordsFromLocationObj(raw);
      if (!p) return;

      const now = nowTs();

      // accuracy filter
      if (p.accuracy != null && config.minAccuracy != null && p.accuracy > config.minAccuracy) {
        debug("skip: accuracy too low", p.accuracy);
        return;
      }

      // spike filter
      if (lastEmitPoint) {
        const d = haversineDistance(lastEmitPoint, p);
        if (d > config.maxSpikeDistance) {
          debug("skip: spike detected", d);
          return;
        }
        if (d < (config.minDistance || 0)) {
          debug("skip: not moved enough", d);
          // but allow if enough time passed since last emit
          if (now - lastEmitTs < (config.debounceMillis || 0)) {
            return;
          }
        }
      }

      // debounce/time filter
      if (now - lastEmitTs < (config.debounceMillis || 0)) {
        debug("skip: debounce", now - lastEmitTs);
        return;
      }

      // ok -> emit
      lastEmitTs = now;
      lastEmitPoint = p;
      failAttempts = 0;
      try {
        onChange(p);
      } catch (e) {
        debug("onChange handler threw", e);
      }
    } catch (e) {
      debug("tryEmit error", e);
    }
  };

  // small haversine helper (local here for perf)
  function haversineDistance(a, b) {
    try {
      if (!a || !b) return Infinity;
      const R = 6371e3;
      const toRad = (d) => (d * Math.PI) / 180;
      const φ1 = toRad(safeNum(a.latitude));
      const φ2 = toRad(safeNum(b.latitude));
      const Δφ = toRad(safeNum(b.latitude) - safeNum(a.latitude));
      const Δλ = toRad(safeNum(b.longitude) - safeNum(a.longitude));
      const aa =
        Math.sin(Δφ / 2) ** 2 +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
      return R * c;
    } catch {
      return Infinity;
    }
  }

  // start the actual location watcher
  const startWatcher = async () => {
    try {
      if (isRemoved) return;
      if (sub) {
        // already started
        return;
      }
      debug("startWatcher", config);
      try {
        const subscription = await Location.watchPositionAsync(
          {
            accuracy: config.accuracy,
            timeInterval: config.timeInterval,
            distanceInterval: config.distanceInterval,
            mayShowUserSettingsDialog: true,
          },
          (loc) => {
            tryEmit(loc);
          }
        );
        sub = subscription;
      } catch (e) {
        debug("watchPositionAsync failed", e);
        // optional backoff retry
        if (config.backoffOnFail?.enabled && failAttempts < (config.backoffOnFail.maxAttempts || 3)) {
          failAttempts += 1;
          const wait = DEFAULTS.retryBackoffBaseMs * 2 ** (failAttempts - 1);
          debug("retrying watcher after", wait);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((res) => setTimeout(res, wait));
          if (!isRemoved) await startWatcher();
        }
      }
    } catch (e) {
      debug("startWatcher outer catch", e);
    }
  };

  // fallback: polling if watchPositionAsync not available/failed
  const startPolling = async () => {
    let pollId = null;
    try {
      debug("startPolling");
      pollId = setInterval(async () => {
        try {
          const p = await Location.getCurrentPositionAsync({ accuracy: config.accuracy });
          tryEmit(p);
        } catch (e) {
          debug("poll getCurrentPositionAsync failed", e);
        }
      }, config.timeInterval || 1000);
      return () => clearInterval(pollId);
    } catch (e) {
      debug("startPolling catch", e);
      if (pollId) clearInterval(pollId);
      return () => {};
    }
  };

  // start immediately
  await startWatcher();
  // if no sub after attempt, fallback to polling
  let pollingStopper = null;
  if (!sub) {
    pollingStopper = await startPolling();
  }

  const controller = {
    remove: () => {
      try {
        isRemoved = true;
        if (sub && typeof sub.remove === "function") {
          try {
            sub.remove();
          } catch (e) {
            debug("sub.remove error", e);
          }
        }
        if (pollingStopper) {
          try {
            pollingStopper();
          } catch {}
        }
        sub = null;
        pollingStopper = null;
        debug("watcher removed");
      } catch (e) {
        debug("controller.remove catch", e);
      }
    },
    pause: () => {
      try {
        if (isRemoved) return;
        isPaused = true;
        if (sub && typeof sub.remove === "function") {
          try {
            sub.remove();
          } catch (e) {
            debug("pause: sub.remove error", e);
          }
        }
        if (pollingStopper) {
          try {
            pollingStopper();
          } catch {}
        }
        sub = null;
      } catch (e) {
        debug("controller.pause catch", e);
      }
    },
    resume: async () => {
      try {
        if (isRemoved) return;
        if (!isPaused) return;
        isPaused = false;
        await startWatcher();
        if (!sub) {
          pollingStopper = await startPolling();
        }
      } catch (e) {
        debug("controller.resume catch", e);
      }
    },
    isWatching: () => !!sub,
  };

  return controller;
}

/* --------------------- debug toggle (helper for dev) --------------------- */
export function enableDebugging(enable = true) {
  _debug = !!enable;
}
