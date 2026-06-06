// src/services/location/locationService.js
// WAYPER — LOCATION SERVICE (SUPREME ULTIMATE MASTER PRO)
// - expo-location based
// - robust permissions handling
// - getCurrentPosition with retries + timeout
// - watchPosition with debounce, smoothing, spike filtering, polling fallback
// - event emitter (subscribe/unsubscribe)
// - pause/resume/remove controls
// - optional local buffer (in-memory) for sync (opt-in)
// - does NOT persist sensitive data by default
//
// Usage examples:
// const controller = await watchPosition(point => {...}, opts)
// controller.pause(); controller.resume(); controller.remove();
// const now = await getCurrentPosition({...})
// subscribe/unsubscribe for global events: on('position', cb), off('position', cb)

import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage"; // optional use
import {
  checkLocationPermission,
  requestLocationPermission as requestAppLocationPermission,
} from "../permissions";
import logger, { LOG_CATEGORIES } from "../../utils/logger.js";
import { recordLocationPointEvent, recordRunEvent } from "../diagnostics/runDiagnosticsService.js";
// no other side effects

/* ===========================
   DEFAULT CONFIG
   =========================== */
const DEFAULTS = {
  timeInterval: 1000, // ms
  distanceInterval: 2.5, // meters
  accuracy: Location.Accuracy.BestForNavigation || Location.Accuracy.Highest || Location.Accuracy.High,
  minAccuracy: 50, // meters - override legacy tolerance for premium run tracking
  debounceMillis: 500, // minimal time between emitted points
  smoothingWindow: 3, // number of points to smooth (simple moving average)
  maxSpikeDistance: 1000, // meters - ignore absurd jumps
  maxRetryAttempts: 3,
  retryBackoffBaseMs: 300,
  pollingFallback: true,
  pollingMultiplier: 1, // polling interval = timeInterval * pollingMultiplier
  permissionRationale: {
    title: "Permissão de localização",
    message: "Precisamos da sua localização para registrar corridas e zonas.",
    buttonPositive: "OK",
  },
  enableLocalBuffer: false, // set true to enable in-memory buffer (not persisted)
  localBufferMax: 1000,
};

let _debug = false;
let _cachedPermission = null; // 'granted' | 'denied' | 'undetermined' | null

/* ===========================
   DEBUG
   =========================== */
function debug(...args) {
  if (_debug) logger.debug(LOG_CATEGORIES.LOCATION, "locationService", { args });
}

/* ===========================
   UTIL HELPERS
   =========================== */
const safeNum = (v, fallback = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;

function nowTs() {
  return Date.now();
}

function sanitizeLocationObj(loc) {
  if (!loc || !loc.coords) return null;
  const { latitude, longitude, accuracy } = loc.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude: Number(latitude),
    longitude: Number(longitude),
    accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
    timestamp: loc.timestamp || nowTs(),
    raw: loc,
  };
}

// haversine distance in meters
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

function calcBearing(a, b) {
  try {
    if (!a || !b) return null;
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    let brng = toDeg(Math.atan2(y, x));
    brng = (brng + 360) % 360;
    return brng;
  } catch {
    return null;
  }
}

function smoothPoints(points = [], window = 3) {
  if (!Array.isArray(points) || points.length === 0) return points;
  const w = Math.max(1, Math.min(points.length, window));
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - w + 1);
    const slice = points.slice(start, i + 1);
    const lat = slice.reduce((s, p) => s + p.latitude, 0) / slice.length;
    const lon = slice.reduce((s, p) => s + p.longitude, 0) / slice.length;
    const acc = slice.reduce((s, p) => s + (p.accuracy || 0), 0) / slice.length;
    const ts = slice[slice.length - 1].timestamp || nowTs();
    out.push({ latitude: lat, longitude: lon, accuracy: acc, timestamp: ts });
  }
  return out;
}

/* ===========================
   EVENT EMITTER (simple)
   =========================== */
const listeners = {
  position: new Set(), // callbacks receive point object
  permission: new Set(), // callbacks receive { granted, status }
};

function emitPosition(point) {
  listeners.position.forEach((cb) => {
    try {
      cb(point);
    } catch (e) {
      debug("listener position error", e);
    }
  });
}
function emitPermission(info) {
  listeners.permission.forEach((cb) => {
    try {
      cb(info);
    } catch (e) {
      debug("listener permission error", e);
    }
  });
}

/* ===========================
   PERMISSION HELPERS
   =========================== */
export async function requestLocationPermission({ force = false } = {}) {
  try {
    if (!force && _cachedPermission === "granted") {
      return { granted: true, status: "granted" };
    }

    const permission = force
      ? await requestAppLocationPermission()
      : await checkLocationPermission();
    _cachedPermission = permission.status;
    const granted = permission.granted;
    const status = permission.status;
    emitPermission({ granted, status });
    recordRunEvent(granted ? "LOCATION_PERMISSION_GRANTED" : "LOCATION_PERMISSION_DENIED", {
      permissionName: "locationForeground",
      status,
      source: "locationService",
    });
    return { granted, status, canAskAgain: permission.canAskAgain };
  } catch (err) {
    debug("requestLocationPermission error", err);
    recordRunEvent("LOCATION_PERMISSION_DENIED", {
      permissionName: "locationForeground",
      status: "error",
      source: "locationService",
      error: err,
    });
    return { granted: false, status: "unknown", error: err };
  }
}

export async function getPermissionStatus() {
  if (_cachedPermission) return _cachedPermission;
  try {
    const { status } = await checkLocationPermission();
    _cachedPermission = status;
    return status;
  } catch {
    return "unknown";
  }
}

/* ===========================
   getCurrentPosition with retries + timeout
   =========================== */
export async function getCurrentPosition(opts = {}) {
  const {
    accuracy = DEFAULTS.accuracy,
    timeoutMs = 8000,
    maxRetryAttempts = DEFAULTS.maxRetryAttempts,
    retryBackoffBaseMs = DEFAULTS.retryBackoffBaseMs,
  } = opts;

  const perm = await checkLocationPermission();
  if (!perm.granted) {
    recordRunEvent("LOCATION_PERMISSION_DENIED", {
      permissionName: "locationForeground",
      status: perm.status,
      source: "locationService.getCurrentPosition",
    });
    return { coords: null, raw: null, error: new Error("permission_denied") };
  }

  let attempts = 0;
  let lastErr = null;
  while (attempts < maxRetryAttempts) {
    attempts += 1;
    try {
      const p = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy }),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), timeoutMs)
        ),
      ]);
      const s = sanitizeLocationObj(p);
      if (!s) throw new Error("invalid_location");
      recordLocationPointEvent("LOCATION_POINT_RECEIVED", s, {
        source: "locationService.getCurrentPosition",
      });
      // enrich: optionally compute accuracy/heading later
      return { coords: s, raw: p, error: null };
    } catch (err) {
      lastErr = err;
      debug("getCurrentPosition attempt failed", attempts, err);
      if (attempts >= maxRetryAttempts) break;
      const wait = retryBackoffBaseMs * 2 ** (attempts - 1);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return { coords: null, raw: null, error: lastErr || new Error("unknown") };
}

/* ===========================
   watchPosition core factory
   =========================== */
export async function watchPosition(onChange, userOpts = {}) {
  if (typeof onChange !== "function")
    throw new Error("watchPosition: onChange must be a function");

  const opts = {
    ...DEFAULTS,
    ...userOpts,
  };

  // permission guard. Do not open the native prompt from a watcher.
  const perm = await checkLocationPermission();
  if (!perm.granted) {
    debug("watchPosition: permission denied");
    recordRunEvent("LOCATION_PERMISSION_DENIED", {
      permissionName: "locationForeground",
      status: perm.status,
      source: "locationService.watchPosition",
    });
    // return a no-op controller
    return {
      remove: () => {},
      pause: () => {},
      resume: async () => {},
      isWatching: () => false,
    };
  }

  // internal state
  let subscription = null;
  let pollingStopper = null;
  let removed = false;
  let paused = false;
  let lastEmitTs = 0;
  let lastPoint = null;
  let buffer = []; // in-memory buffer of emitted points (if enableLocalBuffer)
  const smoothingWindow = Math.max(1, opts.smoothingWindow || 1);

  // small emitter that applies filters then calls onChange and global listeners
  const emitIfValid = (raw) => {
    try {
      const p = sanitizeLocationObj(raw);
      if (!p) return;
      recordLocationPointEvent("LOCATION_POINT_RECEIVED", p, {
        source: "locationService.watchPosition",
      });

      const now = nowTs();

      // accuracy filter
      if (
        p.accuracy != null &&
        opts.minAccuracy != null &&
        p.accuracy > opts.minAccuracy
      ) {
        debug("skip: bad accuracy", p.accuracy);
        return;
      }

      // spike detection
      if (lastPoint) {
        const d = haversineDistance(lastPoint, p);
        if (d > (opts.maxSpikeDistance || DEFAULTS.maxSpikeDistance)) {
          debug("skip: spike", d);
          return;
        }
        // if movement is very small and debounce not passed, skip
        if (d < (opts.minDistance || 0) && now - lastEmitTs < opts.debounceMillis) {
          debug("skip: too small movement", d);
          return;
        }
      }

      // debounce time
      if (now - lastEmitTs < (opts.debounceMillis || 0)) {
        debug("skip: debounce time");
        return;
      }

      // smoothing: we keep last N raw points, smooth and emit last smoothed
      buffer.push(p);
      if (buffer.length > smoothingWindow) buffer.shift();
      const smoothed = smoothPoints(buffer, smoothingWindow).slice(-1)[0] || p;

      // compute derived metrics if possible: distance, speed, bearing
      let distanceFromLast = null;
      let speed = null;
      let bearing = null;
      if (lastPoint) {
        distanceFromLast = haversineDistance(lastPoint, smoothed); // meters
        const dt = Math.max(1, (smoothed.timestamp || now) - (lastPoint.timestamp || now));
        speed = distanceFromLast / (dt / 1000); // m/s
        bearing = calcBearing(lastPoint, smoothed);
      }

      const pointOut = {
        latitude: smoothed.latitude,
        longitude: smoothed.longitude,
        accuracy: smoothed.accuracy,
        timestamp: smoothed.timestamp,
        distanceFromLast,
        speed,
        bearing,
        raw: smoothed.raw || null,
      };

      // emit to caller
      try {
        onChange(pointOut);
      } catch (e) {
        debug("watch onChange handler threw", e);
      }
      // emit global listeners
      emitPosition(pointOut);

      lastEmitTs = now;
      lastPoint = smoothed;

      // keep buffer trimmed for local storage
      if (opts.enableLocalBuffer) {
        // push to tail; keep bounded
        _localBufferPush(pointOut, opts.localBufferMax || DEFAULTS.localBufferMax);
      }
    } catch (e) {
      debug("emitIfValid error", e);
    }
  };

  // start native watcher
  const startNativeWatcher = async () => {
    try {
      if (subscription) return;
      debug("startNativeWatcher", opts);
      const accuracyCandidates = [
        opts.accuracy,
        Location.Accuracy.BestForNavigation,
        Location.Accuracy.Highest,
        Location.Accuracy.High,
      ].filter((value, index, arr) => value != null && arr.indexOf(value) === index);
      let lastError = null;
      for (const accuracy of accuracyCandidates) {
        try {
          subscription = await Location.watchPositionAsync(
            {
              accuracy,
              timeInterval: opts.timeInterval,
              distanceInterval: opts.distanceInterval,
              mayShowUserSettingsDialog: true,
            },
            (loc) => emitIfValid(loc)
          );
          break;
        } catch (watchError) {
          lastError = watchError;
          subscription = null;
        }
      }
      if (!subscription && lastError) throw lastError;
      debug("native watcher started");
      recordRunEvent("LOCATION_WATCHER_STARTED", {
        watcherStatus: "native_started",
        source: "locationService",
      });
    } catch (err) {
      debug("startNativeWatcher failed", err);
      recordRunEvent("LOCATION_WATCHER_RESTARTED", {
        watcherStatus: "native_start_failed",
        source: "locationService",
        error: err,
      });
      subscription = null;
      // allow fallback to polling
    }
  };

  // polling fallback (lower fidelity)
  const startPolling = async () => {
    debug("startPolling fallback");
    let timer = null;
    try {
      timer = setInterval(async () => {
        try {
          const p = await Location.getCurrentPositionAsync({ accuracy: opts.accuracy });
          emitIfValid(p);
        } catch (e) {
          debug("poll failure", e);
        }
      }, Math.max(500, opts.timeInterval * (opts.pollingMultiplier || 1)));
      recordRunEvent("LOCATION_WATCHER_STARTED", {
        watcherStatus: "polling_started",
        source: "locationService",
        timeInterval: Math.max(500, opts.timeInterval * (opts.pollingMultiplier || 1)),
      });
      return () => clearInterval(timer);
    } catch (e) {
      debug("startPolling catch", e);
      if (timer) clearInterval(timer);
      return () => {};
    }
  };

  // start
  await startNativeWatcher();
  if (!subscription && opts.pollingFallback) {
    pollingStopper = await startPolling();
  }

  // controller API
  const controller = {
    remove: () => {
      try {
        removed = true;
        if (subscription && typeof subscription.remove === "function") {
          try {
            subscription.remove();
          } catch (e) {
            debug("subscription.remove error", e);
          }
        }
        if (pollingStopper) {
          try {
            pollingStopper();
          } catch (_) {}
        }
        subscription = null;
        pollingStopper = null;
        buffer = [];
        debug("watcher removed");
        recordRunEvent("LOCATION_WATCHER_STOPPED", {
          watcherStatus: "removed",
          source: "locationService",
        });
      } catch (e) {
        debug("controller.remove catch", e);
      }
    },
    pause: () => {
      try {
        if (removed) return;
        paused = true;
        if (subscription && typeof subscription.remove === "function") {
          try {
            subscription.remove();
          } catch (e) {
            debug("pause subscription.remove error", e);
          }
        }
        if (pollingStopper) {
          try {
            pollingStopper();
          } catch (_) {}
        }
        subscription = null;
        pollingStopper = null;
        debug("watcher paused");
        recordRunEvent("LOCATION_WATCHER_STOPPED", {
          watcherStatus: "paused",
          source: "locationService",
        });
      } catch (e) {
        debug("controller.pause catch", e);
      }
    },
    resume: async () => {
      try {
        if (removed) return;
        if (!paused) return;
        paused = false;
        await startNativeWatcher();
        if (!subscription && opts.pollingFallback) {
          pollingStopper = await startPolling();
        }
        debug("watcher resumed");
        recordRunEvent("LOCATION_WATCHER_RESTARTED", {
          watcherStatus: "resumed",
          source: "locationService",
        });
      } catch (e) {
        debug("controller.resume catch", e);
      }
    },
    isWatching: () => !!subscription,
  };

  return controller;
}

/* ===========================
   LOCAL BUFFER (optional in-memory)
   - used only if enableLocalBuffer = true
   - not persisted, bounded length
   =========================== */
const _localBuffer = []; // global in-memory buffer (not persisted)
function _localBufferPush(point, max = DEFAULTS.localBufferMax) {
  try {
    _localBuffer.push(point);
    if (_localBuffer.length > max) _localBuffer.shift();
  } catch (e) {
    debug("localBufferPush err", e);
  }
}
export function getLocalBufferSnapshot() {
  return _localBuffer.slice();
}
export function clearLocalBuffer() {
  _localBuffer.length = 0;
}

/* ===========================
   GLOBAL SUBSCRIBE/UNSUBSCRIBE HELPERS
   =========================== */
export function on(eventName = "position", cb) {
  if (!listeners[eventName]) throw new Error("unknown_event");
  listeners[eventName].add(cb);
  return () => off(eventName, cb);
}
export function off(eventName = "position", cb) {
  if (!listeners[eventName]) return;
  listeners[eventName].delete(cb);
}

/* ===========================
   Debug toggle
   =========================== */
export function enableDebugging(enable = true) {
  _debug = !!enable;
}

/* ===========================
   Export other helpers
   =========================== */
export { haversineDistance as distanceBetween };
export { calcBearing as bearingBetween };

/* ===========================
   NOTES / INTEGRATION
   ===========================
 - This module does NOT persist location data by default. If you need to buffer
   to disk for later sync, implement explicit save/flush using getLocalBufferSnapshot()
   and your secure persistence layer (prefer encrypted storage).
 - For background tracking you may integrate with expo-task-manager and
   BackgroundFetch/Location.startLocationUpdatesAsync — those require extra
   permissions and manifest changes (Android foreground service). I can add a
   safe background module once you confirm target behaviour.
 - Keeps sensitive data in-memory only; optional persistence is opt-in.
=========================== */
