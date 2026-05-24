// src/services/run/runService.js
// WAYPER — RUN SERVICE (SUPREME ULTIMATE MASTER PRO)
// Features:
// - start/pause/resume/stop run controllers integrated with locationService
// - in-memory + persistent queue for unsynced runs (AsyncStorage)
// - robust uploader with exponential backoff and concurrency lock
// - path compression (Ramer-Douglas-Peucker) + chunking
// - calculation of distance, duration, avgSpeed, pace
// - idempotent persistRun / finalizeRun
// - events emitter for UI updates
// - safe auth checks and offline-first behaviour

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { auth, db } from "../firebaseConfig";
import {
  doc,
  setDoc,
  collection,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import * as locationService from "./location/locationService"; // assumes path
// If your locationService path differs, adjust import above.

const UNSYNCED_KEY = "wayper_unsynced_runs_v2";
const LOCAL_CACHE_KEY = "wayper_runs_cache_v2";
const RUN_STATE_KEY = "wayper_active_run_v1";

const ENABLE_LOGS = false;
function log(...args) {
  if (ENABLE_LOGS) console.log("[runService]", ...args);
}

/* =========================
   UTIL HELPERS
   ========================= */
function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function getAuthUid() {
  try {
    return auth?.currentUser?.uid || null;
  } catch {
    return null;
  }
}

/* =========================
   EVENTS (simple emitter)
   ========================= */
const listeners = {
  runsUpdated: new Set(), // callbacks receive runs list
  runState: new Set(), // callbacks receive current active run state
};

function emit(event, payload) {
  const set = listeners[event];
  if (!set) return;
  for (const cb of set) {
    try {
      cb(payload);
    } catch (e) {
      log("emitter error", e);
    }
  }
}

/* =========================
   Local storage helpers
   ========================= */
async function loadLocalRunsCache() {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    log("loadLocalRunsCache error", e);
    return [];
  }
}

async function saveLocalRunsCache(list = []) {
  try {
    await AsyncStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(list));
    emit("runsUpdated", list);
  } catch (e) {
    log("saveLocalRunsCache error", e);
  }
}

async function loadUnsyncedQueue() {
  try {
    const raw = await AsyncStorage.getItem(UNSYNCED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    log("loadUnsyncedQueue error", e);
    return [];
  }
}

async function saveUnsyncedQueue(queue = []) {
  try {
    await AsyncStorage.setItem(UNSYNCED_KEY, JSON.stringify(queue));
  } catch (e) {
    log("saveUnsyncedQueue error", e);
  }
}

/* =========================
   RDP Compression (Ramer-Douglas-Peucker)
   ========================= */
function perpendicularDistance(point, lineStart, lineEnd) {
  const x = point.latitude;
  const y = point.longitude;
  const x1 = lineStart.latitude;
  const y1 = lineStart.longitude;
  const x2 = lineEnd.latitude;
  const y2 = lineEnd.longitude;

  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return Math.hypot(x - x1, y - y1);
  }

  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

function rdp(points, epsilon) {
  if (!Array.isArray(points) || points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  function recurse(start, end) {
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > epsilon && index !== -1) {
      keep[index] = true;
      recurse(start, index);
      recurse(index, end);
    }
  }

  recurse(0, points.length - 1);
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/* =========================
   STATS HELPERS
   ========================= */
function computeDistanceMeters(path = []) {
  // simple haversine
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const φ1 = toRad(a.latitude);
    const φ2 = toRad(b.latitude);
    const Δφ = toRad(b.latitude - a.latitude);
    const Δλ = toRad(b.longitude - a.longitude);
    const aa =
      Math.sin(Δφ / 2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
    total += R * c;
  }
  return total;
}

function computeDuration(path = []) {
  if (!Array.isArray(path) || path.length === 0) return 0;
  const first = path[0].timestamp || Date.now();
  const last = path[path.length - 1].timestamp || Date.now();
  return Math.max(0, last - first); // ms
}

/* =========================
   PATH SANITIZER + CHUNKER
   ========================= */
function sanitizePath(rawPath = []) {
  // ensure consistent points: {latitude, longitude, accuracy?, timestamp?}
  return (rawPath || [])
    .map((p) => {
      if (!p) return null;
      const lat = Number(p.latitude);
      const lon = Number(p.longitude);
      const ts = p.timestamp ? Number(p.timestamp) : Date.now();
      const acc = p.accuracy != null ? Number(p.accuracy) : null;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const point = { latitude: lat, longitude: lon, accuracy: acc, timestamp: ts };
      ["altitude", "altitudeAccuracy", "speed", "heading", "source", "segmentId", "qualityScore"].forEach((key) => {
        if (p[key] !== undefined && p[key] !== null) point[key] = p[key];
      });
      return point;
    })
    .filter(Boolean);
}

function sanitizeRunSegments(segments = []) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment, index) => {
      const segmentId = Number.isFinite(Number(segment?.index ?? segment?.segmentId))
        ? Number(segment.index ?? segment.segmentId)
        : index;
      return {
        id: String(segment?.id || `segment_${segmentId}`),
        index: segmentId,
        reason: segment?.reason || "active",
        startTimestamp: segment?.startTimestamp ?? segment?.startedAt ?? null,
        endTimestamp: segment?.endTimestamp ?? segment?.endedAt ?? null,
        startedAt: segment?.startedAt || null,
        endedAt: segment?.endedAt || null,
        rawPath: sanitizePath(segment?.rawPath || segment?.rawPoints || []).map((point) => ({ ...point, segmentId })),
        rawPoints: sanitizePath(segment?.rawPoints || segment?.rawPath || []).map((point) => ({ ...point, segmentId })),
        trustedPath: sanitizePath(segment?.trustedPath || segment?.filteredPoints || []).map((point) => ({ ...point, segmentId })),
        filteredPoints: sanitizePath(segment?.filteredPoints || segment?.trustedPath || []).map((point) => ({ ...point, segmentId })),
        liveRenderPath: sanitizePath(segment?.liveRenderPath || []).map((point) => ({ ...point, segmentId })),
        summaryRenderPath: sanitizePath(segment?.summaryRenderPath || segment?.displayPoints || []).map((point) => ({ ...point, segmentId })),
        displayPoints: sanitizePath(segment?.displayPoints || segment?.summaryRenderPath || []).map((point) => ({ ...point, segmentId })),
      };
    })
    .filter(
      (segment) =>
        segment.rawPath.length > 0 ||
        segment.trustedPath.length > 0 ||
        segment.liveRenderPath.length > 0 ||
        segment.summaryRenderPath.length > 0
    );
}

function chunkArray(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =========================
   IN-MEMORY STATE (active run)
   ========================= */
let activeController = null; // { id, startedAt, path[], paused, ... }
let uploaderLock = false;

/* =========================
   API: startRun / pause / resume / stop
   Integration with locationService.watchPosition
   ========================= */

export async function startRun(opts = {}) {
  // returns controller with stop/pause/resume/getState
  if (activeController) {
    log("startRun: run already active, returning existing controller");
    return activeController.controllerAPI;
  }

  // create run object
  const id = makeId();
  const startedAt = nowIso();
  const run = {
    id,
    startedAt,
    path: [],
    meta: opts.meta || {},
    paused: false,
    pausedAt: null,
    totalPausedMs: 0,
  };

  // controller functions
  let watcher = null;
  let lastPauseTs = null;

  // onChange handler for location points
  const onPoint = (p) => {
    try {
      // p is expected as {latitude, longitude, accuracy, timestamp, distanceFromLast, speed, bearing, raw}
      // push sanitized minimal point
      run.path.push({
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy ?? null,
        timestamp: p.timestamp ?? Date.now(),
      });
      emit("runState", { running: true, runId: id, pathLength: run.path.length });
    } catch (e) {
      log("onPoint error", e);
    }
  };

  // start watcher with reasonable defaults; opts can override
  watcher = await locationService.watchPosition(onPoint, {
    accuracy: opts.accuracy,
    timeInterval: opts.timeInterval,
    distanceInterval: opts.distanceInterval,
    minAccuracy: opts.minAccuracy,
    debounceMillis: opts.debounceMillis,
    smoothingWindow: opts.smoothingWindow,
    maxSpikeDistance: opts.maxSpikeDistance,
    backoffOnFail: opts.backoffOnFail,
    enableLocalBuffer: false,
  });

  // build controller API
  const controllerAPI = {
    id,
    getRun: () => ({ ...run }),
    pause: async () => {
      if (!watcher) return;
      if (run.paused) return;
      run.paused = true;
      run.pausedAt = Date.now();
      lastPauseTs = run.pausedAt;
      try {
        watcher.pause();
      } catch (e) {
        log("pause watcher error", e);
      }
      emit("runState", { running: false, paused: true, runId: id });
    },
    resume: async () => {
      if (!watcher) return;
      if (!run.paused) return;
      const resumedAt = Date.now();
      run.paused = false;
      run.totalPausedMs += resumedAt - (run.pausedAt || resumedAt);
      run.pausedAt = null;
      lastPauseTs = null;
      try {
        await watcher.resume();
      } catch (e) {
        log("resume watcher error", e);
      }
      emit("runState", { running: true, paused: false, runId: id });
    },
    stop: async () => {
      // finalize run: compute stats, persist locally and queue for sync
      try {
        if (watcher && typeof watcher.remove === "function") {
          try {
            watcher.remove();
          } catch {}
        }
        watcher = null;
      } catch (e) {
        log("stop watcher error", e);
      }

      // compute stats
      const cleanedPath = sanitizePath(run.path);
      const compressed = rdp(cleanedPath, opts.compressEpsilon ?? 0.00012); // ~small tolerance
      const distanceMeters = computeDistanceMeters(compressed);
      const durationMs = computeDuration(cleanedPath) - (run.totalPausedMs || 0);
      const avgSpeed = durationMs > 0 ? distanceMeters / (durationMs / 1000) : 0;

      const finalRun = {
        id: run.id,
        date: run.startedAt,
        path: compressed,
        rawPathLength: cleanedPath.length,
        distance: Math.round(distanceMeters), // meters
        duration: Math.round(durationMs), // ms
        avgSpeed,
        meta: run.meta || {},
        createdAt: nowIso(),
      };

      // persist and enqueue
      const saved = await persistRun(finalRun);

      // clear active controller
      activeController = null;
      await AsyncStorage.removeItem(RUN_STATE_KEY);
      emit("runState", { running: false, stopped: true, runId: id });

      return saved;
    },
    isActive: () => !!watcher,
  };

  // store active run state persistently so background/resume can recover
  activeController = {
    run,
    controllerAPI,
  };
  try {
    await AsyncStorage.setItem(RUN_STATE_KEY, JSON.stringify({ id, startedAt }));
  } catch (e) {
    log("persist RUN_STATE_KEY failed", e);
  }

  emit("runState", { running: true, runId: id, pathLength: 0 });

  return controllerAPI;
}

/* =========================
   persistRun / finalizeRun (local queue + immediate try to sync)
   ========================= */

function normalizeRun(run) {
  const id = run.id || makeId();
  const date = run.date || nowIso();
  const path = sanitizePath(run.trustedPath || run.path || []);
  const renderPath = sanitizePath(run.renderPath || run.displayPath || path);
  const segments = sanitizeRunSegments(run.routeSegments || run.segments || []);
  const rawPath = sanitizePath(run.rawPoints || run.rawPath || []);
  const distance = Number(run.distance || 0);
  const duration = Number(run.duration || 0);
  return {
    id,
    date,
    path,
    trustedPath: path,
    filteredPoints: sanitizePath(run.filteredPoints || path),
    rawPath,
    rawPoints: rawPath,
    segments,
    routeSegments: segments,
    renderPath,
    displayPath: sanitizePath(run.displayPath || run.renderPath || renderPath),
    displayPoints: sanitizePath(run.displayPoints || run.displayPath || run.renderPath || renderPath),
    pathQuality: run.pathQuality || null,
    gpsQualitySummary: run.gpsQualitySummary || run.pathQuality || null,
    smoothingVersion: run.smoothingVersion || run.pathQuality?.smoothingVersion || null,
    filterVersion: run.filterVersion || run.pathQuality?.filterVersion || run.gpsQualitySummary?.filterVersion || null,
    distance,
    duration,
    avgSpeed: Number(run.avgSpeed || 0),
    maxSpeed: Number(run.maxSpeed || 0),
    meta: run.meta || {},
    createdAt: nowIso(),
    endedAt: run.endedAt || run.date || nowIso(),
    status: run.status || "completed",
    synced: false,
  };
}

export async function persistRun(runLike) {
  try {
    const r = normalizeRun(runLike);

    // save to local cache (UI)
    const cache = await loadLocalRunsCache();
    cache.unshift(r);
    // keep limit e.g., 200
    const trimmed = cache.slice(0, 200);
    await saveLocalRunsCache(trimmed);

    // add to unsynced queue (persist)
    const q = await loadUnsyncedQueue();
    q.push(r);
    await saveUnsyncedQueue(q);

    // try immediate sync if online
    const state = await NetInfo.fetch();
    if (state.isConnected) {
      // attempt in background (non-blocking)
      syncUnsyncedRuns().catch((e) => log("sync immediate failed", e));
    }

    return r;
  } catch (e) {
    log("persistRun error", e);
    throw e;
  }
}

/* =========================
   uploader: uploadRunToFirestore
   - uses users/{uid}/runs/{id}
   - uses chunking if path > 1500 points (split into parts)
   - writes run metadata/doc + optional subcollection 'chunks' with compressed points
   ========================= */
async function uploadRunToFirestore(run, attempt = 0) {
  const uid = await getAuthUid();
  if (!uid) throw new Error("not-authenticated");

  // prepare doc refs
  const userRunsColl = collection(db, `users/${uid}/runs`);
  const runRef = doc(userRunsColl, run.id);

  // sanitize path
  const path = sanitizePath(run.path);
  const renderPath = sanitizePath(run.renderPath || run.displayPath || path);
  const segments = sanitizeRunSegments(run.routeSegments || run.segments || []);
  const rawPath = sanitizePath(run.rawPoints || run.rawPath || []);
  const MAX_POINTS_INLINE = 800; // keep doc size reasonable
  const chunks = chunkArray(path, MAX_POINTS_INLINE);

  try {
    if (chunks.length <= 1) {
      // write single doc with path inline
      const payload = {
        id: run.id,
        date: run.date,
        path: chunks[0] || [],
        trustedPath: chunks[0] || [],
        filteredPoints: chunks[0] || [],
        rawPath,
        rawPoints: rawPath,
        renderPath,
        segments,
        routeSegments: segments,
        displayPath: sanitizePath(run.displayPath || run.renderPath || renderPath),
        displayPoints: sanitizePath(run.displayPoints || run.displayPath || run.renderPath || renderPath),
        pathQuality: run.pathQuality || null,
        gpsQualitySummary: run.gpsQualitySummary || run.pathQuality || null,
        smoothingVersion: run.smoothingVersion || run.pathQuality?.smoothingVersion || null,
        filterVersion: run.filterVersion || run.pathQuality?.filterVersion || run.gpsQualitySummary?.filterVersion || null,
        distance: Number(run.distance || 0),
        duration: Number(run.duration || 0),
        avgSpeed: Number(run.avgSpeed || 0),
        maxSpeed: Number(run.maxSpeed || 0),
        meta: run.meta || {},
        createdAt: serverTimestamp(),
        endedAt: run.endedAt || run.date || null,
        status: run.status || "completed",
      };
      await setDoc(runRef, payload);
    } else {
      // write metadata doc + chunks subcollection atomically via batch where possible (batch cannot write subcollections atomically with root doc in Firestore,
      // but we can write main doc then write chunk docs)
      // write metadata (without path)
      await setDoc(runRef, {
        id: run.id,
        date: run.date,
        distance: Number(run.distance || 0),
        duration: Number(run.duration || 0),
        avgSpeed: Number(run.avgSpeed || 0),
        maxSpeed: Number(run.maxSpeed || 0),
        renderPath,
        segments,
        routeSegments: segments,
        displayPath: sanitizePath(run.displayPath || run.renderPath || renderPath),
        displayPoints: sanitizePath(run.displayPoints || run.displayPath || run.renderPath || renderPath),
        pathQuality: run.pathQuality || null,
        gpsQualitySummary: run.gpsQualitySummary || run.pathQuality || null,
        smoothingVersion: run.smoothingVersion || run.pathQuality?.smoothingVersion || null,
        filterVersion: run.filterVersion || run.pathQuality?.filterVersion || run.gpsQualitySummary?.filterVersion || null,
        meta: run.meta || {},
        chunkCount: chunks.length,
        createdAt: serverTimestamp(),
        endedAt: run.endedAt || run.date || null,
        status: run.status || "completed",
        _chunked: true,
      });

      // write each chunk as documents under runs/{runId}/chunks/{partIndex}
      // Use setDoc individually (could parallelize)
      const promises = chunks.map((c, idx) =>
        setDoc(doc(runRef, "chunks", `${idx}`), {
          index: idx,
          points: c,
          createdAt: serverTimestamp(),
        })
      );
      await Promise.all(promises);
    }
    log("uploadRunToFirestore ok", run.id);
    return true;
  } catch (e) {
    log("uploadRunToFirestore error", { id: run.id, attempt, err: e });
    throw e;
  }
}

/* =========================
   syncUnsyncedRuns (robust queue processor)
   - single worker (uploaderLock)
   - retries with exponential backoff
   - marks local cache items as synced
   ========================= */
export async function syncUnsyncedRuns() {
  if (uploaderLock) {
    log("syncUnsyncedRuns: worker busy");
    return;
  }
  uploaderLock = true;
  try {
    log("syncUnsyncedRuns start");
    const uid = await getAuthUid();
    if (!uid) {
      log("syncUnsyncedRuns abort: not authenticated");
      uploaderLock = false;
      return;
    }

    let queue = await loadUnsyncedQueue();
    if (!queue || queue.length === 0) {
      log("syncUnsyncedRuns nothing to do");
      uploaderLock = false;
      return;
    }

    const remaining = [];

    for (let i = 0; i < queue.length; i++) {
      const run = queue[i];
      let ok = false;
      let attempt = 0;
      const maxAttempts = 6;

      while (!ok && attempt < maxAttempts) {
        try {
          attempt++;
          await uploadRunToFirestore(run, attempt);

          // mark as synced in local cache
          const cache = await loadLocalRunsCache();
          const idx = cache.findIndex((r) => r.id === run.id);
          if (idx !== -1) {
            cache[idx] = { ...cache[idx], synced: true };
            await saveLocalRunsCache(cache);
          }

          ok = true;
          log("sync uploaded", run.id, "attempt", attempt);
        } catch (err) {
          log("upload attempt failed", run.id, "attempt", attempt, err?.message || err);
          const delay = Math.min(120000, 1000 * 2 ** attempt); // cap 2 min
          // wait before next try
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      if (!ok) {
        remaining.push(run);
        log("keeping in queue", run.id);
      }
    }

    await saveUnsyncedQueue(remaining);
    log("syncUnsyncedRuns done, remaining", remaining.length);
  } catch (e) {
    log("syncUnsyncedRuns catch", e);
  } finally {
    uploaderLock = false;
  }
}

/* =========================
   initRunSyncOnStart: register NetInfo listener + immediate try
   ========================= */
let netUnsub = null;
export function initRunSyncOnStart() {
  try {
    if (netUnsub) return;
    netUnsub = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        log("NetInfo: online -> trying sync");
        syncUnsyncedRuns().catch((e) => log("sync on net event failed", e));
      }
    });

    // initial attempt
    NetInfo.fetch().then((state) => {
      if (state.isConnected) syncUnsyncedRuns().catch((e) => log("initial sync failed", e));
    });

    log("initRunSyncOnStart ok");
  } catch (e) {
    log("initRunSyncOnStart error", e);
  }
}

/* =========================
   Recover active run on app start (if any)
   - attempts to restore activeController state from storage
   ========================= */
export async function recoverActiveRunIfAny() {
  try {
    const raw = await AsyncStorage.getItem(RUN_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id) return null;
    // We don't persist full path to avoid heavy storage; app may re-start tracking anew.
    // Inform caller that there was an interrupted run.
    return parsed; // { id, startedAt }
  } catch (e) {
    log("recoverActiveRunIfAny error", e);
    return null;
  }
}

/* =========================
   finalizeRun helper — convenience wrapper that accepts raw runLike
   ========================= */
export async function finalizeRun(runLike) {
  // provide compatibility with previous code
  return persistRun(runLike);
}

/* =========================
   clear state on sign out
   ========================= */
export async function clearRunServiceState() {
  try {
    await saveUnsyncedQueue([]);
    await saveLocalRunsCache([]);
    await AsyncStorage.removeItem(RUN_STATE_KEY);
    log("clearRunServiceState done");
  } catch (e) {
    log("clearRunServiceState error", e);
  }
}

/* =========================
   PUBLIC API export
   ========================= */
export function onRunsUpdated(cb) {
  listeners.runsUpdated.add(cb);
  return () => listeners.runsUpdated.delete(cb);
}
export function onRunState(cb) {
  listeners.runState.add(cb);
  return () => listeners.runState.delete(cb);
}

export default {
  startRun,
  persistRun,
  finalizeRun,
  syncUnsyncedRuns,
  initRunSyncOnStart,
  loadLocalRunsCache,
  clearRunServiceState,
  recoverActiveRunIfAny,
  onRunsUpdated,
  onRunState,
};
