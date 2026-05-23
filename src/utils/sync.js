// src/utils/sync.ultimate.js
/**
 * sync.ultimate.js - Ultimate Power version
 * - Robust sanitization, safe pagination, retries, backoff
 * - Background task properly defined (TaskManager.defineTask after handler)
 * - No duplicate imports, clear defensive checks
 * - Idempotent schedulers, safe guards, and well-structured exports
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  writeBatch,
  doc,
  getDocs,
  query,
  orderBy,
  limit as firestoreLimit,
  startAfter,
  Timestamp,
} from "firebase/firestore";
import { db, auth } from "../firebaseConfig";
import zones from "./zones";
import { notifyActivitySubscribers } from "../services/notifications/notificationService";
import {
  loadLocalTerritories as loadStoredLocalTerritories,
  loadLocalTerritoryEvents as loadStoredLocalTerritoryEvents,
  markTerritoryDeletedRemote,
  saveLocalTerritories as saveStoredLocalTerritories,
  saveLocalTerritory as saveStoredLocalTerritory,
  saveLocalTerritoryEvent as saveStoredLocalTerritoryEvent,
  saveLocalTerritoryEvents as saveStoredLocalTerritoryEvents,
  saveTerritoryEventRemote,
  saveTerritoryRemote,
} from "../services/territory/territoryStorageService.js";

import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";
import { Platform } from "react-native";

// ----------------- Keys / Constants -----------------
const RUNS_KEY = "runs";
const ZONES_KEY = "zones";
const MEDALS_KEY = "medals"; // NEW

const SYNC_DEBOUNCE_MS = 2500;
const MAX_BATCH_WRITE = 400;
const MIN_ZONE_AREA_M2 = 5;
const REMOTE_PAGE_SIZE = 400;
const MAX_RETRY_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 1000 * 60 * 15;
const ROUTE_CAP = 5000;
const BG_TASK_NAME = "WAYPER_BACKGROUND_SYNC_TASK";
const AUTO_SYNC_INTERVAL_MS = 60 * 1000;

// runtime guards
let isSyncingRuns = false;
let isSyncingZones = false;
let isSyncingMedals = false;
let isSyncingTerritories = false;
let isSyncingTerritoryEvents = false;

let debounceRunsTimer = null;
let debounceZonesTimer = null;
let debounceMedalsTimer = null;
let debounceTerritoriesTimer = null;
let debounceTerritoryEventsTimer = null;
let autoSyncTimer = null;

const RETRY_META_RUNS = "wayper:retry:runs";
const RETRY_META_ZONES = "wayper:retry:zones";
const RETRY_META_MEDALS = "wayper:retry:medals";
const RETRY_META_TERRITORIES = "wayper:retry:territories";
const RETRY_META_TERRITORY_EVENTS = "wayper:retry:territory_events";

// ----------------- Small utilities -----------------
const safeParse = (s) => {
  try {
    return s ? JSON.parse(s) : [];
  } catch {
    return [];
  }
};
const safeStringify = (o) => {
  try {
    return JSON.stringify(o);
  } catch {
    return "[]";
  }
};
const uid = () => String(Date.now()) + "-" + Math.floor(Math.random() * 1e6);

const logError = (err, context = {}) => {
  try {
    console.error("[sync:error]", err, context);
  } catch (e) {
    try {
      console.error("[sync:error:logging-failed]", e);
    } catch {}
  }
};

const uniqueById = (arr = []) => {
  const m = new Map();
  for (const item of arr) {
    if (!item || !item.id) continue;
    m.set(item.id, item);
  }
  return Array.from(m.values());
};

function sanitizeCoordsArray(coords = []) {
  if (!Array.isArray(coords)) return [];
  return coords
    .map((p) => {
      if (!p) return null;
      // accept objects with latitude/longitude or arrays [lat, lon] or [lon, lat]
      let latitude = NaN;
      let longitude = NaN;
      if (Array.isArray(p)) {
        const a = Number(p[0]);
        const b = Number(p[1]);
        // prefer [lat, lon] but tolerate swapped by checking range
        if (Number.isFinite(a) && Math.abs(a) <= 90 && Number.isFinite(b) && Math.abs(b) <= 180) {
          latitude = a;
          longitude = b;
        } else if (Number.isFinite(b) && Math.abs(b) <= 90 && Number.isFinite(a) && Math.abs(a) <= 180) {
          latitude = b;
          longitude = a;
        }
      } else {
        latitude = Number(p.latitude ?? p.lat ?? NaN);
        longitude = Number(p.longitude ?? p.lon ?? p.lng ?? NaN);
      }

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      const timestamp = p.timestamp ?? p.time ?? p.t ?? null;
      const point = { latitude, longitude, timestamp: timestamp == null ? null : timestamp };
      [
        "accuracy",
        "altitude",
        "altitudeAccuracy",
        "speed",
        "heading",
        "source",
        "segmentId",
        "distanceFromPreviousMeters",
        "timeFromPreviousMs",
        "calculatedSpeedMps",
        "bearingFromPrevious",
        "qualityScore",
      ].forEach((key) => {
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
      const withSegmentId = (path = []) =>
        sanitizeCoordsArray(path).map((point) => ({
          ...point,
          segmentId: Number.isFinite(Number(point.segmentId)) ? Number(point.segmentId) : segmentId,
        }));

      return {
        id: String(segment?.id || `segment_${segmentId}`),
        index: segmentId,
        startedAt: segment?.startedAt || null,
        endedAt: segment?.endedAt || null,
        rawPath: withSegmentId(segment?.rawPath || []),
        trustedPath: withSegmentId(segment?.trustedPath || []),
        liveRenderPath: withSegmentId(segment?.liveRenderPath || []),
        summaryRenderPath: withSegmentId(segment?.summaryRenderPath || []),
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

// Retry meta storage helpers
async function _getRetryMeta(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : { attempts: 0, nextAt: 0 };
  } catch {
    return { attempts: 0, nextAt: 0 };
  }
}
async function _setRetryMeta(key, meta) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(meta));
  } catch {}
}

// ----------------- Local CRUD - Runs -----------------
export async function loadLocalRuns() {
  try {
    const raw = await AsyncStorage.getItem(RUNS_KEY);
    return safeParse(raw);
  } catch (err) {
    logError(err, { fn: "loadLocalRuns" });
    return [];
  }
}
export async function saveLocalRun(run = {}) {
  try {
    const existing = await loadLocalRuns();
    const now = new Date().toISOString();
    const trustedPath = sanitizeCoordsArray(run.trustedPath || run.path || run.coords || []);
    const renderPath = sanitizeCoordsArray(run.renderPath || run.displayPath || trustedPath);
    const rawPath = sanitizeCoordsArray(run.rawPoints || run.rawPath || []);
    const segments = sanitizeRunSegments(run.routeSegments || run.segments || []);
    const normalized = {
      id: run.id || uid(),
      path: trustedPath,
      trustedPath,
      rawPath,
      rawPoints: rawPath,
      segments,
      routeSegments: segments,
      liveRenderPath: sanitizeCoordsArray(run.liveRenderPath || []),
      renderPath,
      displayPath: sanitizeCoordsArray(run.displayPath || run.renderPath || renderPath),
      pathQuality: run.pathQuality || null,
      lowConfidenceSegments: Array.isArray(run.lowConfidenceSegments) ? run.lowConfidenceSegments : [],
      smoothingVersion: run.smoothingVersion || run.pathQuality?.smoothingVersion || null,
      distance: Number(run.distance ?? 0),
      distanceMeters: Number(run.distanceMeters ?? run.distance ?? 0),
      duration: Number(run.duration ?? 0),
      durationSeconds: Number(run.durationSeconds ?? run.duration ?? 0),
      avgSpeed: Number(run.avgSpeed ?? 0),
      maxSpeed: Number(run.maxSpeed ?? 0),
      avgPace: Number(run.avgPace ?? 0),
      date: run.date || now,
      startedAt: run.startedAt || null,
      endedAt: run.endedAt || run.date || now,
      pausedDurationSeconds: run.pausedDurationSeconds ?? null,
      status: run.status || "completed",
      synced: !!run.synced || false,
      name: run.name || `${run.mode === "zones" ? "Captura por zonas" : "Corrida"} ${new Date(now).toLocaleString()}`,
      effort: Number(run.effort ?? 5),
      notes: run.notes || "",
      tags: Array.isArray(run.tags) ? run.tags : [],
      photoUri: run.photoUri || null,
      mode: run.mode || run.type || "free",
      zoneId: run.zoneId || null,
      area: Number(run.area ?? 0),
      zoneCoords: sanitizeCoordsArray(run.zoneCoords || run.zone?.coords || []),
      zoneCount: Number(run.zoneCount ?? (Array.isArray(run.zoneCoords) && run.zoneCoords.length >= 3 ? 1 : 0)),
      visibility: run.visibility || "followers",
      subscriberNotificationSent: !!run.subscriberNotificationSent,
      subscriberNotificationSentAt: run.subscriberNotificationSentAt || null,
    };
    const sameZoneRunIndex =
      normalized.zoneId && (normalized.mode === "zones" || normalized.area > 0 || normalized.zoneCoords.length >= 3)
        ? existing.findIndex((item) => item?.zoneId === normalized.zoneId && (item?.mode === "zones" || Number(item?.area || 0) > 0))
        : -1;
    const sameRunIndex = existing.findIndex((item) => item?.id === normalized.id);
    const replaceIndex = sameZoneRunIndex >= 0 ? sameZoneRunIndex : sameRunIndex;

    const savedRecord =
      replaceIndex >= 0
        ? { ...existing[replaceIndex], ...normalized, id: existing[replaceIndex]?.id || normalized.id }
        : normalized;

    const next =
      replaceIndex >= 0
        ? existing.map((item, index) => (index === replaceIndex ? savedRecord : item))
        : [savedRecord, ...existing];

    const deduped = uniqueById(next);
    deduped.sort((a, b) => (a.date < b.date ? 1 : -1));
    await AsyncStorage.setItem(RUNS_KEY, safeStringify(deduped));
    return savedRecord;
  } catch (err) {
    logError(err, { fn: "saveLocalRun" });
    const now = new Date().toISOString();
    return {
      id: uid(),
      path: [],
      distance: 0,
      duration: 0,
      avgSpeed: 0,
      date: now,
      synced: false,
    };
  }
}

export async function deleteLocalRun(runId, options = {}) {
  try {
    const id = String(runId || "");
    if (!id) return { deleted: false, remoteDeleted: false };

    const existing = await loadLocalRuns();
    const next = (Array.isArray(existing) ? existing : []).filter((run) => String(run?.id || "") !== id);
    await AsyncStorage.setItem(RUNS_KEY, safeStringify(next));

    let remoteDeleted = false;
    if (options.deleteRemote !== false) {
      try {
        const uid = auth?.currentUser?.uid || null;
        const batch = writeBatch(db);
        batch.delete(doc(db, "runs", id));

        if (uid) {
          batch.delete(doc(db, "users", uid, "runs", id));
          batch.delete(doc(db, "activities", `run_${uid}_${id}`));
        }

        await batch.commit();
        remoteDeleted = true;
      } catch (remoteErr) {
        logError(remoteErr, { fn: "deleteLocalRun.remote", runId: id });
      }
    }

    return { deleted: true, remoteDeleted };
  } catch (err) {
    logError(err, { fn: "deleteLocalRun", runId });
    return { deleted: false, remoteDeleted: false, error: err };
  }
}

// ----------------- Local CRUD - Zones -----------------
export async function loadLocalZones() {
  try {
    const raw = await AsyncStorage.getItem(ZONES_KEY);
    return safeParse(raw);
  } catch (err) {
    logError(err, { fn: "loadLocalZones" });
    return [];
  }
}

export async function saveLocalZone(zone = {}) {
  try {
    const existing = await loadLocalZones();
    const now = new Date().toISOString();
    const normalized = {
      id: zone.id || uid(),
      coords: sanitizeCoordsArray(zone.coords || []),
      area: Number(zone.area ?? 0),
      date: zone.date || now,
      synced: !!zone.synced || false,
      userId: zone.userId || auth?.currentUser?.uid || "offline",
    };
    existing.unshift(normalized);
    const deduped = uniqueById(existing);
    deduped.sort((a, b) => (a.date < b.date ? 1 : -1));
    await AsyncStorage.setItem(ZONES_KEY, safeStringify(deduped));
    return normalized;
  } catch (err) {
    logError(err, { fn: "saveLocalZone" });
    const now = new Date().toISOString();
    return { id: uid(), coords: [], area: 0, date: now, synced: false };
  }
}

// ----------------- Zone pipeline convenience -----------------
export async function createAndSaveZoneFromPath(path = [], options = {}) {
  try {
    const raw = sanitizeCoordsArray(path || []);
    if (!Array.isArray(raw) || raw.length < 3) return null;

    const {
      simplifyTolerance = 0.00003,
      smoothIterations = 0,
      maxPoints = 300,
      compressMax = 300,
      closeDistanceM = 28,
      maxCloseDistanceM = Math.max(36, closeDistanceM * 1.6),
      requireClosedLoop = true,
      allowOpenFallback = false,
      minLoopPoints = 6,
    } = options;

    let poly = zones.buildCapturedZone(raw, {
      closeDistanceM,
      maxCloseDistanceM,
      requireClosedLoop,
      minLoopPoints,
      simplifyTolerance,
      smoothIterations,
      maxPoints,
    });

    if ((!zones.isValidPolygon(poly) || poly.length < 3) && (!requireClosedLoop || allowOpenFallback)) {
      poly = zones.buildConvexZone(raw, {
        simplifyTolerance,
        smoothIterations,
        maxPoints,
      });
    }

    if (!zones.isValidPolygon(poly) || poly.length < 3) return null;

    const area = zones.calcArea(poly);
    if (!Number.isFinite(area) || area < MIN_ZONE_AREA_M2) return null;

    let finalCoords = poly;
    if (Array.isArray(finalCoords) && finalCoords.length > compressMax) {
      finalCoords = zones.compressCoords(finalCoords, compressMax);
    }

    const zoneObj = {
      id: uid(),
      coords: finalCoords,
      area,
      date: new Date().toISOString(),
      synced: false,
    };

    const saved = await saveLocalZone(zoneObj);
    scheduleZonesSync();
    return saved;
  } catch (err) {
    logError(err, { fn: "createAndSaveZoneFromPath" });
    return null;
  }
}

// ----------------- Remote IDs fetch (paginated, safe) -----------------
async function fetchRemoteIds(collectionName) {
  try {
    const remoteIds = new Set();
    const colRef = collection(db, collectionName);
    let lastSnap = null;
    let pages = 0;
    while (true) {
      pages++;
      if (pages > 100) break; // safety
      let q;
      if (lastSnap) {
        q = query(
          colRef,
          orderBy("createdAt"),
          startAfter(lastSnap),
          firestoreLimit(REMOTE_PAGE_SIZE)
        );
      } else {
        q = query(colRef, orderBy("createdAt"), firestoreLimit(REMOTE_PAGE_SIZE));
      }
      const snap = await getDocs(q);
      if (!snap || snap.size === 0) break;
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data && data.id) remoteIds.add(data.id);
      });
      if (snap.size < REMOTE_PAGE_SIZE) break;
      lastSnap = snap.docs[snap.docs.length - 1];
    }
    return remoteIds;
  } catch (err) {
    try {
      const s = await getDocs(collection(db, collectionName));
      const set = new Set();
      s.docs.forEach((d) => {
        const data = d.data();
        if (data && data.id) set.add(data.id);
      });
      return set;
    } catch (e) {
      logError(err, { fn: "fetchRemoteIds", collectionName });
      return new Set();
    }
  }
}

// ----------------- Sync Zones to Firestore -----------------
export async function syncZonesToFirestore() {
  if (isSyncingZones) return;
  isSyncingZones = true;
  try {
    const local = await loadLocalZones();
    if (!Array.isArray(local) || local.length === 0) {
      isSyncingZones = false;
      return;
    }

    const unsynced = local.filter(
      (z) =>
        !z.synced &&
        Array.isArray(z.coords) &&
        z.coords.length >= 3 &&
        Number(z.area) >= MIN_ZONE_AREA_M2
    );
    if (unsynced.length === 0) {
      isSyncingZones = false;
      return;
    }

    const remoteSet = await fetchRemoteIds("zones");

    const batches = [];
    let batch = writeBatch(db);
    let opsInBatch = 0;

    for (const zone of unsynced) {
      if (remoteSet.has(zone.id)) {
        zone.synced = true;
        continue;
      }

      const coords = (zone.coords || [])
        .map((p) => ({
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
        }))
        .slice(0, 5000);

      const uid = auth?.currentUser?.uid || "offline";
      const payload = {
        id: zone.id,
        userId: uid,
        coords,
        area: Number(zone.area || 0),
        date: zone.date || new Date().toISOString(),
        createdAt: Timestamp.now(),
      };

      batch.set(doc(db, "zones", zone.id), payload, { merge: true });
      opsInBatch++;

      if (uid !== "offline") {
        batch.set(doc(db, "users", uid, "zones", zone.id), payload, { merge: true });
        batch.set(
          doc(db, "activities", `zone_${uid}_${zone.id}`),
          {
            id: `zone_${uid}_${zone.id}`,
            type: "zone",
            userId: uid,
            zoneId: zone.id,
            area: Number(zone.area || 0),
            description: `capturou ${Number(zone.area || 0).toFixed(0)} m²`,
            visibility: "followers",
            createdAt: Timestamp.now(),
            timestamp: Timestamp.now(),
          },
          { merge: true }
        );
        opsInBatch += 2;
      }

      zone.synced = true;

      if (opsInBatch >= MAX_BATCH_WRITE - 4) {
        batches.push(batch);
        batch = writeBatch(db);
        opsInBatch = 0;
      }
    }

    if (opsInBatch > 0) batches.push(batch);

    for (const b of batches) {
      let attempts = 0;
      while (attempts <= MAX_RETRY_ATTEMPTS) {
        try {
          await b.commit();
          break;
        } catch (err) {
          attempts++;
          const backoff = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
          logError(err, {
            fn: "syncZonesToFirestore.batch.commit",
            attempts,
            backoff,
          });
          await new Promise((r) => setTimeout(r, backoff));
          if (attempts > MAX_RETRY_ATTEMPTS) throw err;
        }
      }
    }

    await AsyncStorage.setItem(ZONES_KEY, safeStringify(local));
    await _setRetryMeta(RETRY_META_ZONES, { attempts: 0, nextAt: 0 });
  } catch (err) {
    logError(err, { fn: "syncZonesToFirestore" });
    const meta = (await _getRetryMeta(RETRY_META_ZONES)) || { attempts: 0 };
    const attempts = (meta.attempts || 0) + 1;
    const backoff = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
    await _setRetryMeta(RETRY_META_ZONES, {
      attempts,
      nextAt: Date.now() + backoff,
    });
    setTimeout(() => {
      syncZonesToFirestore().catch((e) =>
        logError(e, { fn: "syncZonesToFirestore.retry" })
      );
    }, backoff);
  } finally {
    isSyncingZones = false;
  }
}

// ----------------- Debounced schedulers -----------------
export function scheduleZonesSync(delay = SYNC_DEBOUNCE_MS) {
  if (debounceZonesTimer) clearTimeout(debounceZonesTimer);
  debounceZonesTimer = setTimeout(() => {
    syncZonesToFirestore().catch((e) =>
      logError(e, { fn: "scheduleZonesSync.inner" })
    );
  }, delay);
}

// ----------------- Sync Runs to Firestore -----------------
export async function syncRunsToFirestore() {
  if (isSyncingRuns) return;
  isSyncingRuns = true;
  try {
    const local = await loadLocalRuns();
    if (!Array.isArray(local) || local.length === 0) {
      isSyncingRuns = false;
      return;
    }

    const unsynced = local.filter((r) => !r.synced);
    if (unsynced.length === 0) {
      isSyncingRuns = false;
      return;
    }

    const batches = [];
    const pendingPostNotifications = [];
    let batch = writeBatch(db);
    let opsInBatch = 0;

    for (const run of unsynced) {
      const path = sanitizeCoordsArray(run.trustedPath || run.path || []).slice(0, ROUTE_CAP);
      const rawPath = sanitizeCoordsArray(run.rawPoints || run.rawPath || []).slice(0, ROUTE_CAP);
      const segments = sanitizeRunSegments(run.routeSegments || run.segments || []);
      const renderPath = sanitizeCoordsArray(run.renderPath || run.displayPath || path).slice(0, ROUTE_CAP);
      const displayPath = sanitizeCoordsArray(run.displayPath || run.renderPath || renderPath).slice(0, ROUTE_CAP);

      const uid = auth?.currentUser?.uid || "offline";
      const payload = {
        id: run.id,
        userId: uid,
        path,
        trustedPath: path,
        rawPath,
        rawPoints: rawPath,
        segments,
        routeSegments: segments,
        renderPath,
        displayPath,
        pathQuality: run.pathQuality || null,
        lowConfidenceSegments: Array.isArray(run.lowConfidenceSegments) ? run.lowConfidenceSegments : [],
        smoothingVersion: run.smoothingVersion || run.pathQuality?.smoothingVersion || null,
        distance: Number(run.distance || 0),
        distanceMeters: Number(run.distanceMeters ?? run.distance ?? 0),
        duration: Number(run.duration || 0),
        durationSeconds: Number(run.durationSeconds ?? run.duration ?? 0),
        avgSpeed: Number(run.avgSpeed || 0),
        maxSpeed: Number(run.maxSpeed || 0),
        avgPace: Number(run.avgPace || 0),
        area: Number(run.area || 0),
        mode: run.mode || "free",
        zoneId: run.zoneId || null,
        zoneCoords: sanitizeCoordsArray(run.zoneCoords || []).slice(0, 5000),
        zoneCount: Number(run.zoneCount || 0),
        name: run.name || "Corrida",
        effort: Number(run.effort || 0),
        notes: run.notes || "",
        tags: Array.isArray(run.tags) ? run.tags : [],
        photoUri: run.photoUri || null,
        visibility: run.visibility || "followers",
        date: run.date || new Date().toISOString(),
        startedAt: run.startedAt || null,
        endedAt: run.endedAt || run.date || null,
        pausedDurationSeconds: run.pausedDurationSeconds ?? null,
        status: run.status || "completed",
        createdAt: Timestamp.now(),
      };

      batch.set(doc(db, "runs", run.id), payload, { merge: true });
      opsInBatch++;

      if (uid !== "offline") {
        const activityId = `run_${uid}_${run.id}`;
        const activityType = run.mode === "zones" && Number(run.area || 0) > 0 ? "zone" : "run";
        batch.set(doc(db, "users", uid, "runs", run.id), payload, { merge: true });
        batch.set(
          doc(db, "activities", activityId),
          {
            id: activityId,
            type: activityType,
            userId: uid,
            runId: run.id,
            distance: Number(run.distance || 0),
            duration: Number(run.duration || 0),
            area: Number(run.area || 0),
            mode: run.mode || "free",
            zoneCount: Number(run.zoneCount || 0),
            name: run.name || "Corrida",
            description:
              run.mode === "zones" && Number(run.area || 0) > 0
                ? `capturou uma area e correu ${(Number(run.distance || 0) / 1000).toFixed(2)} km`
                : `correu ${(Number(run.distance || 0) / 1000).toFixed(2)} km`,
            visibility: run.visibility || "followers",
            createdAt: Timestamp.now(),
            timestamp: Timestamp.now(),
          },
          { merge: true }
        );
        opsInBatch += 2;

        if (!run.subscriberNotificationSent) {
          pendingPostNotifications.push({
            run,
            activityId,
            activityType,
            authorUid: uid,
            authorName: auth?.currentUser?.displayName || auth?.currentUser?.email?.split("@")?.[0] || "Atleta Wayper",
          });
        }
      }

      run.synced = true;

      if (opsInBatch >= MAX_BATCH_WRITE - 4) {
        batches.push(batch);
        batch = writeBatch(db);
        opsInBatch = 0;
      }
    }

    if (opsInBatch > 0) batches.push(batch);

    for (const b of batches) {
      let attempts = 0;
      while (attempts <= MAX_RETRY_ATTEMPTS) {
        try {
          await b.commit();
          break;
        } catch (err) {
          attempts++;
          const backoff = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
          logError(err, {
            fn: "syncRunsToFirestore.batch.commit",
            attempts,
            backoff,
          });
          await new Promise((r) => setTimeout(r, backoff));
          if (attempts > MAX_RETRY_ATTEMPTS) throw err;
        }
      }
    }

    for (const item of pendingPostNotifications) {
      try {
        await notifyActivitySubscribers(item);
        item.run.subscriberNotificationSent = true;
        item.run.subscriberNotificationSentAt = new Date().toISOString();
      } catch {}
    }

    await AsyncStorage.setItem(RUNS_KEY, safeStringify(local));
    await _setRetryMeta(RETRY_META_RUNS, { attempts: 0, nextAt: 0 });
  } catch (err) {
    logError(err, { fn: "syncRunsToFirestore" });
    const meta = (await _getRetryMeta(RETRY_META_RUNS)) || { attempts: 0 };
    const attempts = (meta.attempts || 0) + 1;
    const backoff = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
    await _setRetryMeta(RETRY_META_RUNS, {
      attempts,
      nextAt: Date.now() + backoff,
    });
    setTimeout(() => {
      syncRunsToFirestore().catch((e) =>
        logError(e, { fn: "syncRunsToFirestore.retry" })
      );
    }, backoff);
  } finally {
    isSyncingRuns = false;
  }
}

export function scheduleRunsSync(delay = SYNC_DEBOUNCE_MS) {
  if (debounceRunsTimer) clearTimeout(debounceRunsTimer);
  debounceRunsTimer = setTimeout(() => {
    syncRunsToFirestore().catch((e) =>
      logError(e, { fn: "scheduleRunsSync.inner" })
    );
  }, delay);
}

// ----------------- NEW: Medals local CRUD -----------------
export async function loadLocalMedals() {
  try {
    const raw = await AsyncStorage.getItem(MEDALS_KEY);
    return safeParse(raw);
  } catch (err) {
    logError(err, { fn: "loadLocalMedals" });
    return {};
  }
}

/**
 * saveLocalMedal(medal = { id, userId, date, meta })
 */
export async function saveLocalMedal(medal = {}) {
  try {
    if (!medal || !medal.id) {
      throw new Error("invalid_medal");
    }
    const existingRaw = await AsyncStorage.getItem(MEDALS_KEY);
    const existing = existingRaw ? JSON.parse(existingRaw) : {};
    const now = new Date().toISOString();
    const normalized = {
      id: medal.id,
      userId: medal.userId || auth?.currentUser?.uid || "unknown",
      date: medal.date || now,
      meta: medal.meta || {},
      synced: !!medal.synced || false,
    };
    existing[normalized.id] = normalized;
    await AsyncStorage.setItem(MEDALS_KEY, JSON.stringify(existing));
    scheduleMedalsSync();
    return normalized;
  } catch (err) {
    logError(err, { fn: "saveLocalMedal", medal });
    const now = new Date().toISOString();
    return {
      id: medal?.id || uid(),
      userId: auth?.currentUser?.uid || "unknown",
      date: now,
      meta: medal?.meta || {},
      synced: false,
    };
  }
}

// ----------------- NEW: Sync Medals to Firestore -----------------
export async function syncMedalsToFirestore() {
  if (isSyncingMedals) return;
  isSyncingMedals = true;
  try {
    const localObj = await loadLocalMedals();
    const keys = localObj && typeof localObj === "object" ? Object.keys(localObj) : [];
    if (keys.length === 0) {
      isSyncingMedals = false;
      return;
    }

    const unsyncedKeys = keys.filter((k) => !localObj[k]?.synced);
    if (unsyncedKeys.length === 0) {
      isSyncingMedals = false;
      return;
    }

    const remoteSet = await fetchRemoteIds("medals");

    const batches = [];
    let batch = writeBatch(db);
    let opsInBatch = 0;

    for (const key of unsyncedKeys) {
      const medal = localObj[key];
      if (!medal) continue;
      if (remoteSet.has(medal.id)) {
        medal.synced = true;
        continue;
      }

      const payload = {
        id: medal.id,
        userId: medal.userId || auth?.currentUser?.uid || "offline",
        date: medal.date || new Date().toISOString(),
        meta: medal.meta || {},
        createdAt: Timestamp.now(),
      };

      const ref = doc(collection(db, "medals"));
      batch.set(ref, payload);
      opsInBatch++;

      medal.synced = true;

      if (opsInBatch >= MAX_BATCH_WRITE) {
        batches.push(batch);
        batch = writeBatch(db);
        opsInBatch = 0;
      }
    }

    if (opsInBatch > 0) batches.push(batch);

    for (const b of batches) {
      let attempts = 0;
      while (attempts <= MAX_RETRY_ATTEMPTS) {
        try {
          await b.commit();
          break;
        } catch (err) {
          attempts++;
          const backoff = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
          logError(err, {
            fn: "syncMedalsToFirestore.batch.commit",
            attempts,
            backoff,
          });
          await new Promise((r) => setTimeout(r, backoff));
          if (attempts > MAX_RETRY_ATTEMPTS) throw err;
        }
      }
    }

    await AsyncStorage.setItem(MEDALS_KEY, JSON.stringify(localObj));
    await _setRetryMeta(RETRY_META_MEDALS, { attempts: 0, nextAt: 0 });
  } catch (err) {
    logError(err, { fn: "syncMedalsToFirestore" });
    const meta = (await _getRetryMeta(RETRY_META_MEDALS)) || { attempts: 0 };
    const attempts = (meta.attempts || 0) + 1;
    const backoff = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
    await _setRetryMeta(RETRY_META_MEDALS, {
      attempts,
      nextAt: Date.now() + backoff,
    });
    setTimeout(() => {
      syncMedalsToFirestore().catch((e) =>
        logError(e, { fn: "syncMedalsToFirestore.retry" })
      );
    }, backoff);
  } finally {
    isSyncingMedals = false;
  }
}

export function scheduleMedalsSync(delay = SYNC_DEBOUNCE_MS) {
  if (debounceMedalsTimer) clearTimeout(debounceMedalsTimer);
  debounceMedalsTimer = setTimeout(() => {
    syncMedalsToFirestore().catch((e) =>
      logError(e, { fn: "scheduleMedalsSync.inner" })
    );
  }, delay);
}

// ----------------- Convenience: getAllMedals -----------------
export async function getAllMedals() {
  try {
    const local = await loadLocalMedals();
    if (!local || typeof local !== "object") return [];
    return Object.keys(local).map((k) => local[k]);
  } catch (err) {
    logError(err, { fn: "getAllMedals" });
    return [];
  }
}

// ----------------- Territory local wrappers -----------------
export async function loadLocalTerritories() {
  return loadStoredLocalTerritories();
}

export async function saveLocalTerritory(territory = {}) {
  const saved = await saveStoredLocalTerritory(territory);
  scheduleTerritoriesSync();
  return saved;
}

export async function loadLocalTerritoryEvents() {
  return loadStoredLocalTerritoryEvents();
}

export async function saveLocalTerritoryEvent(event = {}) {
  const saved = await saveStoredLocalTerritoryEvent(event);
  scheduleTerritoryEventsSync();
  return saved;
}

export async function migrateLegacyZonesToTerritories(options = {}) {
  const migration = await import("../services/territory/territoryMigrationService.js");
  return migration.migrateLegacyZonesToTerritories(options);
}

// ----------------- Territory sync wrappers -----------------
export async function syncTerritoriesToFirestore() {
  if (isSyncingTerritories) return;
  isSyncingTerritories = true;
  try {
    const local = await loadStoredLocalTerritories();
    if (!Array.isArray(local) || local.length === 0) {
      isSyncingTerritories = false;
      return;
    }

    const next = [...local];
    let changed = false;

    for (let index = 0; index < next.length; index += 1) {
      const territory = next[index];
      if (!territory?.id || !territory.pendingSync) continue;

      const result =
        territory.status === "deleted" || territory.deleted
          ? await markTerritoryDeletedRemote(territory.id, territory)
          : await saveTerritoryRemote(territory);

      if (result?.ok) {
        next[index] = {
          ...territory,
          ...(result.territory || {}),
          pendingSync: false,
          synced: true,
          syncConflict: false,
        };
        changed = true;
      } else if (result?.reason === "sync_conflict") {
        next[index] = {
          ...territory,
          syncConflict: true,
          pendingSync: true,
          remoteVersion: result.remote?.version ?? result.territory?.remoteVersion ?? territory.remoteVersion,
        };
        changed = true;
      }
    }

    if (changed) {
      await saveStoredLocalTerritories(next, {
        replace: true,
        preserveTimestamps: true,
        preserveVersion: true,
      });
    }

    await _setRetryMeta(RETRY_META_TERRITORIES, { attempts: 0, nextAt: 0 });
  } catch (err) {
    logError(err, { fn: "syncTerritoriesToFirestore" });
    const meta = (await _getRetryMeta(RETRY_META_TERRITORIES)) || { attempts: 0 };
    const attempts = (meta.attempts || 0) + 1;
    const backoff = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
    await _setRetryMeta(RETRY_META_TERRITORIES, {
      attempts,
      nextAt: Date.now() + backoff,
    });
    setTimeout(() => {
      syncTerritoriesToFirestore().catch((e) =>
        logError(e, { fn: "syncTerritoriesToFirestore.retry" })
      );
    }, backoff);
  } finally {
    isSyncingTerritories = false;
  }
}

export async function syncTerritoryEventsToFirestore() {
  if (isSyncingTerritoryEvents) return;
  isSyncingTerritoryEvents = true;
  try {
    const local = await loadStoredLocalTerritoryEvents();
    if (!Array.isArray(local) || local.length === 0) {
      isSyncingTerritoryEvents = false;
      return;
    }

    const next = [...local];
    let changed = false;

    for (let index = 0; index < next.length; index += 1) {
      const event = next[index];
      if (!event?.id || !event.pendingSync) continue;

      const result = await saveTerritoryEventRemote(event);
      if (result?.ok) {
        next[index] = {
          ...event,
          ...(result.event || {}),
          pendingSync: false,
          synced: true,
          syncConflict: false,
        };
        changed = true;
      } else if (result?.reason === "sync_conflict") {
        next[index] = {
          ...event,
          syncConflict: true,
          pendingSync: true,
          remoteVersion: result.remote?.version ?? result.event?.remoteVersion ?? event.remoteVersion,
        };
        changed = true;
      }
    }

    if (changed) {
      await saveStoredLocalTerritoryEvents(next, {
        replace: true,
        preserveTimestamps: true,
        preserveVersion: true,
      });
    }

    await _setRetryMeta(RETRY_META_TERRITORY_EVENTS, { attempts: 0, nextAt: 0 });
  } catch (err) {
    logError(err, { fn: "syncTerritoryEventsToFirestore" });
    const meta = (await _getRetryMeta(RETRY_META_TERRITORY_EVENTS)) || { attempts: 0 };
    const attempts = (meta.attempts || 0) + 1;
    const backoff = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
    await _setRetryMeta(RETRY_META_TERRITORY_EVENTS, {
      attempts,
      nextAt: Date.now() + backoff,
    });
    setTimeout(() => {
      syncTerritoryEventsToFirestore().catch((e) =>
        logError(e, { fn: "syncTerritoryEventsToFirestore.retry" })
      );
    }, backoff);
  } finally {
    isSyncingTerritoryEvents = false;
  }
}

export function scheduleTerritoriesSync(delay = SYNC_DEBOUNCE_MS) {
  if (debounceTerritoriesTimer) clearTimeout(debounceTerritoriesTimer);
  debounceTerritoriesTimer = setTimeout(() => {
    syncTerritoriesToFirestore().catch((e) =>
      logError(e, { fn: "scheduleTerritoriesSync.inner" })
    );
  }, delay);
}

export function scheduleTerritoryEventsSync(delay = SYNC_DEBOUNCE_MS) {
  if (debounceTerritoryEventsTimer) clearTimeout(debounceTerritoryEventsTimer);
  debounceTerritoryEventsTimer = setTimeout(() => {
    syncTerritoryEventsToFirestore().catch((e) =>
      logError(e, { fn: "scheduleTerritoryEventsSync.inner" })
    );
  }, delay);
}

// ----------------- Sync All convenience -----------------
export async function syncAll() {
  // guard to avoid parallel runs
  if (
    isSyncingRuns ||
    isSyncingZones ||
    isSyncingMedals ||
    isSyncingTerritories ||
    isSyncingTerritoryEvents
  ) return;
  await Promise.all([
    syncRunsToFirestore(),
    syncZonesToFirestore(),
    syncMedalsToFirestore(),
    syncTerritoriesToFirestore(),
    syncTerritoryEventsToFirestore(),
  ]);
}

export async function syncNow() {
  return syncAll();
}

export function startAutoSync(intervalMs = AUTO_SYNC_INTERVAL_MS) {
  if (autoSyncTimer) return;
  syncAll().catch((e) => logError(e, { fn: "startAutoSync.initial" }));
  autoSyncTimer = setInterval(() => {
    syncAll().catch((e) => logError(e, { fn: "startAutoSync.tick" }));
  }, intervalMs);
}

export function stopAutoSync() {
  if (!autoSyncTimer) return;
  clearInterval(autoSyncTimer);
  autoSyncTimer = null;
}

// ----------------- Background sync task handler -----------------
async function _bgSyncHandler() {
  try {
    await syncAll();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (err) {
    logError(err, { fn: "_bgSyncHandler" });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
}

// Define the TaskManager task at module load (must be defined before register)
try {
  if (TaskManager && typeof TaskManager.defineTask === "function") {
    // if already defined, defineTask will throw; wrap to be safe
    try {
      TaskManager.defineTask(BG_TASK_NAME, async () => {
        return await _bgSyncHandler();
      });
    } catch (e) {
      // ignore if task already defined in the environment
      console.debug("[sync] Task defineTask skipped or already defined.", e?.message || e);
    }
  } else {
    console.warn("[sync] TaskManager.defineTask not available in this environment.");
  }
} catch (e) {
  console.warn("[sync] error while attempting to define task:", e);
}

/**
 * Register a background sync task using expo-background-fetch.
 * - idempotent
 * - returns boolean success
 */
export async function registerBackgroundSyncTask(options = { minimumInterval: 15 * 60 }) {
  try {
    if (!TaskManager || !BackgroundFetch) {
      console.warn("[sync] Background fetch not available in this environment.");
      return false;
    }

    // Ensure task was defined above (best-effort)
    if (!TaskManager || typeof TaskManager.defineTask !== "function") {
      console.warn("[sync] TaskManager.defineTask not available; cannot register.");
      return false;
    }

    const opts = {
      minimumInterval: options.minimumInterval || 15 * 60, // seconds
      stopOnTerminate: false,
      startOnBoot: true,
    };

    try {
      await BackgroundFetch.registerTaskAsync(BG_TASK_NAME, opts);
    } catch (err) {
      // ignore "already registered" style errors
      const msg = String(err || "");
      if (msg.toLowerCase().includes("already registered")) {
        return true;
      }
      logError(err, { fn: "registerBackgroundSyncTask" });
      return false;
    }

    return true;
  } catch (err) {
    logError(err, { fn: "registerBackgroundSyncTask" });
    return false;
  }
}

export async function unregisterBackgroundSyncTask() {
  try {
    if (!TaskManager || !BackgroundFetch) return false;
    if (typeof TaskManager.isTaskRegisteredAsync === "function") {
      const registered = await TaskManager.isTaskRegisteredAsync(BG_TASK_NAME);
      if (registered) {
        await BackgroundFetch.unregisterTaskAsync(BG_TASK_NAME);
      }
    } else {
      // best-effort unregister
      try {
        await BackgroundFetch.unregisterTaskAsync(BG_TASK_NAME);
      } catch {}
    }
    return true;
  } catch (err) {
    logError(err, { fn: "unregisterBackgroundSyncTask" });
    return false;
  }
}

// ----------------- Exports -----------------
export default {
  loadLocalRuns,
  saveLocalRun,
  deleteLocalRun,
  loadLocalZones,
  saveLocalZone,
  createAndSaveZoneFromPath,
  syncRunsToFirestore,
  syncZonesToFirestore,
  scheduleRunsSync,
  scheduleZonesSync,
  syncAll,
  syncNow,
  startAutoSync,
  stopAutoSync,
  // medals
  loadLocalMedals,
  saveLocalMedal,
  syncMedalsToFirestore,
  scheduleMedalsSync,
  getAllMedals,
  // territories
  loadLocalTerritories,
  saveLocalTerritory,
  loadLocalTerritoryEvents,
  saveLocalTerritoryEvent,
  migrateLegacyZonesToTerritories,
  syncTerritoriesToFirestore,
  syncTerritoryEventsToFirestore,
  scheduleTerritoriesSync,
  scheduleTerritoryEventsSync,
  // background]
  registerBackgroundSyncTask,
  unregisterBackgroundSyncTask,
};
