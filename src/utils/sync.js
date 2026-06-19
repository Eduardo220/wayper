// src/utils/sync.ultimate.js
/**
 * sync.ultimate.js - Ultimate Power version
 * - Robust sanitization, safe pagination, retries, backoff
 * - Background task properly defined (TaskManager.defineTask after handler)
 * - No duplicate imports, clear defensive checks
 * - Idempotent schedulers, safe guards, and well-structured exports
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  collection,
  writeBatch,
  doc,
  getDocs,
  query,
  where,
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
import { AppState, Platform } from "react-native";
import logger, { LOG_CATEGORIES } from "./logger.js";
import { recordRunEvent } from "../services/diagnostics/runDiagnosticsService.js";

// ----------------- Keys / Constants -----------------
const RUNS_KEY = "runs";
const ZONES_KEY = "zones";
const MEDALS_KEY = "medals"; // NEW
export const RUN_SYNC_STATUS = {
  PENDING: "PENDING",
  SYNCING: "SYNCING",
  SYNCED: "SYNCED",
  FAILED: "FAILED",
};

export const RUN_OFFLINE_STATUS = {
  LOCAL_ONLY: "LOCAL_ONLY",
  PENDING_SYNC: "PENDING_SYNC",
  SYNCING: "SYNCING",
  SYNCED: "SYNCED",
  SYNC_FAILED: "SYNC_FAILED",
};

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
let debounceAllTimer = null;
let autoSyncTimer = null;
let netInfoUnsubscribe = null;
let appStateUnsubscribe = null;

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
    logger.error(LOG_CATEGORIES.SYNC, "SYNC_ERROR", {
      ...context,
      error: err,
    });
  } catch (e) {
    try {
      logger.error(LOG_CATEGORIES.SYNC, "SYNC_ERROR_LOGGING_FAILED", {
        error: e,
      });
    } catch {}
  }
};

async function hasNetworkConnection() {
  try {
    const state = await NetInfo.fetch();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  } catch {
    return true;
  }
}

function getRemoteRunStatus(status) {
  if (["PENDING_SYNC", "SYNCING", "SYNC_FAILED", "SYNCED"].includes(status)) {
    return "completed";
  }
  return status || "completed";
}

const ACTIVE_RUN_HISTORY_STATUSES = new Set([
  "ACTIVE",
  "RUNNING",
  "PAUSED",
  "RECOVERING",
  "FINISHING",
  "CANCELLED",
  "CANCELED",
]);

const FINISHED_RUN_HISTORY_STATUSES = new Set([
  "COMPLETED",
  "COMPLETE",
  "FINISHED",
  "FINISHED_LOCAL",
  "PENDING",
  "FAILED",
  "SYNCING",
  "PENDING_SYNC",
  "SYNC_FAILED",
  "SYNCED",
  "LOCAL_ONLY",
]);

const SYNC_STATUS_VALUES = new Set(Object.values(RUN_SYNC_STATUS));
const OFFLINE_STATUS_VALUES = new Set(Object.values(RUN_OFFLINE_STATUS));
const QUEUEABLE_SYNC_STATUSES = new Set([
  RUN_SYNC_STATUS.PENDING,
  RUN_SYNC_STATUS.SYNCING,
  RUN_SYNC_STATUS.FAILED,
]);
const QUEUEABLE_OFFLINE_STATUSES = new Set([
  RUN_OFFLINE_STATUS.LOCAL_ONLY,
  RUN_OFFLINE_STATUS.PENDING_SYNC,
  RUN_OFFLINE_STATUS.SYNCING,
  RUN_OFFLINE_STATUS.SYNC_FAILED,
]);

const normalizeStatusText = (value) => String(value || "").trim().toUpperCase();

function toIsoString(value, fallback = null) {
  try {
    if (!value) return fallback;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value.toISOString();
    if (typeof value?.toDate === "function") return value.toDate().toISOString();
    if (Number.isFinite(Number(value?.seconds))) return new Date(Number(value.seconds) * 1000).toISOString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  } catch {
    return fallback;
  }
}

function dateMs(value) {
  const date = toIsoString(value);
  return date ? new Date(date).getTime() : 0;
}

function getRunIdentityCandidates(run = {}) {
  return [
    run.id,
    run.localRunId,
    run.remoteRunId,
    run.runId,
    run.activeRunId,
    run.legacyId,
    run.clientRunId,
  ]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .map((value) => String(value));
}

function hasSharedRunIdentity(left = {}, right = {}) {
  const leftIds = new Set(getRunIdentityCandidates(left));
  if (leftIds.size === 0) return false;
  return getRunIdentityCandidates(right).some((id) => leftIds.has(id));
}

function getStableRunId(run = {}) {
  const candidates = getRunIdentityCandidates(run);
  if (candidates.length > 0) return candidates[0];
  const date = toIsoString(run.finishedAt || run.endedAt || run.date || run.createdAt);
  return date ? `run_${date}` : null;
}

function isFinishedHistoryRun(run = {}) {
  const status = normalizeStatusText(run.status || run.runStatus || run.state);
  if (ACTIVE_RUN_HISTORY_STATUSES.has(status)) return false;

  const offlineStatus = normalizeStatusText(run.offlineStatus || run.localStatus);
  if (offlineStatus === "FINISHING") return false;

  if (FINISHED_RUN_HISTORY_STATUSES.has(status) || FINISHED_RUN_HISTORY_STATUSES.has(offlineStatus)) return true;
  if (run.finishedAt || run.endedAt || run.date) return true;
  return Number(run.distance ?? run.distanceMeters ?? 0) > 0 || Number(run.duration ?? run.durationSeconds ?? 0) > 0;
}

function hasSyncError(run = {}) {
  return Boolean(run.syncError || run.lastSyncError);
}

function normalizeRunMode(mode = "free") {
  const raw = String(mode || "free").toLowerCase();
  if (raw === "zones" || raw === "territory" || raw === "zone") return "zones";
  return "free";
}

function normalizeRunSyncStatus(run = {}) {
  const syncStatus = normalizeStatusText(run.syncStatus);
  if (run.pendingSync === true) {
    if (syncStatus === RUN_SYNC_STATUS.SYNCING || syncStatus === RUN_OFFLINE_STATUS.SYNCING) {
      return RUN_SYNC_STATUS.SYNCING;
    }
    if (syncStatus === RUN_SYNC_STATUS.FAILED || syncStatus === RUN_OFFLINE_STATUS.SYNC_FAILED) {
      return RUN_SYNC_STATUS.FAILED;
    }
    return RUN_SYNC_STATUS.PENDING;
  }
  if (run.synced === false && syncStatus === RUN_SYNC_STATUS.SYNCED) {
    return RUN_SYNC_STATUS.PENDING;
  }
  if (SYNC_STATUS_VALUES.has(syncStatus)) return syncStatus;
  if (syncStatus === RUN_OFFLINE_STATUS.PENDING_SYNC || syncStatus === RUN_OFFLINE_STATUS.LOCAL_ONLY) {
    return RUN_SYNC_STATUS.PENDING;
  }
  if (syncStatus === RUN_OFFLINE_STATUS.SYNC_FAILED) return RUN_SYNC_STATUS.FAILED;

  const offlineStatus = normalizeStatusText(run.offlineStatus || run.localStatus);
  if (offlineStatus === RUN_OFFLINE_STATUS.SYNCED) return RUN_SYNC_STATUS.SYNCED;
  if (offlineStatus === RUN_OFFLINE_STATUS.SYNC_FAILED) return RUN_SYNC_STATUS.FAILED;
  if (offlineStatus === RUN_OFFLINE_STATUS.SYNCING) return RUN_SYNC_STATUS.SYNCING;
  if (offlineStatus === RUN_OFFLINE_STATUS.PENDING_SYNC || offlineStatus === RUN_OFFLINE_STATUS.LOCAL_ONLY) {
    return RUN_SYNC_STATUS.PENDING;
  }

  if (run.synced === false) return RUN_SYNC_STATUS.PENDING;
  if (run.synced) return RUN_SYNC_STATUS.SYNCED;
  if (run.remoteRunId && !hasSyncError(run)) return RUN_SYNC_STATUS.SYNCED;
  return RUN_SYNC_STATUS.PENDING;
}

function normalizeRunOfflineStatus(run = {}, syncStatus = normalizeRunSyncStatus(run)) {
  const offlineStatus = normalizeStatusText(run.offlineStatus || run.localStatus);
  if (OFFLINE_STATUS_VALUES.has(offlineStatus)) {
    if (offlineStatus === RUN_OFFLINE_STATUS.SYNCED && syncStatus !== RUN_SYNC_STATUS.SYNCED) {
      return syncStatus === RUN_SYNC_STATUS.FAILED
        ? RUN_OFFLINE_STATUS.SYNC_FAILED
        : RUN_OFFLINE_STATUS.PENDING_SYNC;
    }
    return offlineStatus;
  }
  if (syncStatus === RUN_SYNC_STATUS.SYNCED) return RUN_OFFLINE_STATUS.SYNCED;
  if (syncStatus === RUN_SYNC_STATUS.SYNCING) return RUN_OFFLINE_STATUS.SYNCING;
  if (syncStatus === RUN_SYNC_STATUS.FAILED) return RUN_OFFLINE_STATUS.SYNC_FAILED;
  return RUN_OFFLINE_STATUS.PENDING_SYNC;
}

function preferArray(primary = [], fallback = []) {
  const left = Array.isArray(primary) ? primary : [];
  const right = Array.isArray(fallback) ? fallback : [];
  return left.length > 0 ? left : right;
}

function syncMetadataMs(run = {}) {
  return Math.max(
    dateMs(run.lastSyncAttemptAt),
    dateMs(run.lastSyncedAt),
    dateMs(run.syncedAt),
    dateMs(run.syncUpdatedAt)
  );
}

function hasExplicitPendingSyncIntent(run = {}) {
  const syncStatus = normalizeRunSyncStatus(run);
  const offlineStatus = normalizeRunOfflineStatus(run, syncStatus);
  return (
    run.pendingSync === true ||
    run.synced === false ||
    QUEUEABLE_SYNC_STATUSES.has(syncStatus) ||
    QUEUEABLE_OFFLINE_STATUSES.has(offlineStatus)
  );
}

function shouldPreserveExistingSyncFields(existing = {}, incoming = {}) {
  const existingSyncMs = syncMetadataMs(existing);
  const incomingSyncMs = syncMetadataMs(incoming);
  if (!existingSyncMs || incomingSyncMs >= existingSyncMs) return false;

  const incomingUpdatedMs = dateMs(incoming.updatedAt);
  if (incomingUpdatedMs > existingSyncMs && hasExplicitPendingSyncIntent(incoming)) {
    return false;
  }
  return true;
}

function runCompletenessScore(run = {}) {
  const routeScore =
    (Array.isArray(run.trustedPath) ? run.trustedPath.length : 0) * 3 +
    (Array.isArray(run.renderPath) ? run.renderPath.length : 0) * 2 +
    (Array.isArray(run.rawPath) ? run.rawPath.length : 0) +
    (Array.isArray(run.segments) ? run.segments.length : 0) * 5;
  const idScore = getRunIdentityCandidates(run).length * 4;
  const syncScore = (run.remoteRunId ? 8 : 0) + (run.localRunId ? 8 : 0) + (run.syncStatus ? 3 : 0);
  const metricsScore = (Number(run.distance ?? run.distanceMeters ?? 0) > 0 ? 4 : 0) +
    (Number(run.duration ?? run.durationSeconds ?? 0) > 0 ? 4 : 0);
  return routeScore + idScore + syncScore + metricsScore + dateMs(run.updatedAt);
}

function mergeLocalRunRecords(existing = {}, incoming = {}) {
  const incomingIsContentNewer = dateMs(incoming.updatedAt) >= dateMs(existing.updatedAt);
  const primary = incomingIsContentNewer ? incoming : existing;
  const fallback = incomingIsContentNewer ? existing : incoming;
  const trustedPath = preferArray(primary.trustedPath || primary.path, fallback.trustedPath || fallback.path);
  const renderPath = preferArray(primary.renderPath || primary.displayPath, fallback.renderPath || fallback.displayPath);
  const rawPath = preferArray(primary.rawPath || primary.rawPoints, fallback.rawPath || fallback.rawPoints);
  const filteredPoints = preferArray(primary.filteredPoints, fallback.filteredPoints || trustedPath);
  const displayPath = preferArray(primary.displayPath, fallback.displayPath || renderPath || trustedPath);
  const displayPoints = preferArray(primary.displayPoints, fallback.displayPoints || displayPath);
  const segments = preferArray(primary.segments || primary.routeSegments, fallback.segments || fallback.routeSegments);
  const createdAt = existing.createdAt || incoming.createdAt || incoming.date || existing.date || new Date().toISOString();
  const updatedAt = dateMs(incoming.updatedAt) >= dateMs(existing.updatedAt)
    ? incoming.updatedAt || existing.updatedAt
    : existing.updatedAt || incoming.updatedAt;
  const preserveExistingSync = shouldPreserveExistingSyncFields(existing, incoming);
  const syncSource = preserveExistingSync ? existing : incoming;
  const syncStatus = normalizeRunSyncStatus(syncSource);
  const offlineStatus = normalizeRunOfflineStatus(syncSource, syncStatus);
  const remoteRunId = incoming.remoteRunId || existing.remoteRunId || null;

  return {
    ...fallback,
    ...primary,
    id: incoming.localRunId || existing.localRunId || existing.id || incoming.id || incoming.remoteRunId || existing.remoteRunId,
    localRunId: incoming.localRunId || existing.localRunId || existing.id || incoming.id || null,
    remoteRunId,
    trustedPath,
    path: trustedPath,
    filteredPoints,
    renderPath,
    displayPath,
    displayPoints,
    rawPath,
    rawPoints: rawPath,
    segments,
    routeSegments: segments,
    synced: syncStatus === RUN_SYNC_STATUS.SYNCED,
    pendingSync:
      syncSource.pendingSync !== undefined
        ? !!syncSource.pendingSync
        : syncStatus !== RUN_SYNC_STATUS.SYNCED || QUEUEABLE_OFFLINE_STATUSES.has(offlineStatus),
    syncStatus,
    offlineStatus,
    syncAttempts: Number(syncSource.syncAttempts ?? syncSource.retryCount ?? incoming.syncAttempts ?? existing.syncAttempts ?? 0),
    retryCount: Number(syncSource.retryCount ?? syncSource.syncAttempts ?? incoming.retryCount ?? existing.retryCount ?? 0),
    lastSyncAttemptAt: syncSource.lastSyncAttemptAt || null,
    lastSyncedAt: syncSource.lastSyncedAt || syncSource.syncedAt || null,
    syncedAt: syncSource.syncedAt || syncSource.lastSyncedAt || null,
    lastSyncError: syncStatus === RUN_SYNC_STATUS.SYNCED ? null : (syncSource.lastSyncError || syncSource.syncError || null),
    syncError: syncStatus === RUN_SYNC_STATUS.SYNCED ? null : (syncSource.syncError || syncSource.lastSyncError || null),
    syncErrorType: syncStatus === RUN_SYNC_STATUS.SYNCED ? null : (syncSource.syncErrorType || null),
    syncErrorRecoverable: syncStatus === RUN_SYNC_STATUS.SYNCED
      ? true
      : syncSource.syncErrorRecoverable !== undefined
        ? !!syncSource.syncErrorRecoverable
        : true,
    createdAt,
    updatedAt: updatedAt || new Date().toISOString(),
  };
}

function dedupeLocalRunRecords(runs = []) {
  const output = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run) continue;
    const index = output.findIndex((item) => hasSharedRunIdentity(item, run));
    if (index < 0) {
      output.push(run);
      continue;
    }
    const merged = mergeLocalRunRecords(output[index], run);
    output[index] = runCompletenessScore(run) > runCompletenessScore(output[index])
      ? mergeLocalRunRecords(run, output[index])
      : merged;
  }
  return output;
}

const uniqueById = (arr = []) => {
  const m = new Map();
  for (const item of arr) {
    if (!item || !item.id) continue;
    const existing = m.get(item.id);
    m.set(item.id, existing ? mergeLocalRunRecords(existing, item) : item);
  }
  return dedupeLocalRunRecords(Array.from(m.values()));
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
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
      if (latitude === 0 && longitude === 0) return null;
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
        reason: segment?.reason || "active",
        startTimestamp: segment?.startTimestamp ?? segment?.startedAt ?? null,
        endTimestamp: segment?.endTimestamp ?? segment?.endedAt ?? null,
        startedAt: segment?.startedAt || null,
        endedAt: segment?.endedAt || null,
        rawPath: withSegmentId(segment?.rawPath || []),
        rawPoints: withSegmentId(segment?.rawPoints || segment?.rawPath || []),
        trustedPath: withSegmentId(segment?.trustedPath || segment?.filteredPoints || []),
        filteredPoints: withSegmentId(segment?.filteredPoints || segment?.trustedPath || []),
        liveRenderPath: withSegmentId(segment?.liveRenderPath || []),
        summaryRenderPath: withSegmentId(segment?.summaryRenderPath || segment?.displayPoints || []),
        displayPoints: withSegmentId(segment?.displayPoints || segment?.summaryRenderPath || []),
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

function normalizeLocalRunRecord(run = {}, { now = new Date().toISOString(), forHistory = false } = {}) {
  if (!run || typeof run !== "object") return null;

  const stableId = getStableRunId(run);
  if (!stableId) return null;
  if (forHistory && !isFinishedHistoryRun(run)) return null;

  const trustedPath = sanitizeCoordsArray(run.trustedPath || run.path || run.coords || run.filteredPoints || []);
  const renderPath = sanitizeCoordsArray(run.renderPath || run.displayPath || run.displayPoints || trustedPath);
  const rawPath = sanitizeCoordsArray(run.rawPoints || run.rawPath || []);
  const segments = sanitizeRunSegments(run.routeSegments || run.segments || []);
  const syncStatus = normalizeRunSyncStatus(run);
  const offlineStatus = normalizeRunOfflineStatus(run, syncStatus);
  const pendingSync = run.pendingSync !== undefined
    ? !!run.pendingSync
    : syncStatus !== RUN_SYNC_STATUS.SYNCED || QUEUEABLE_OFFLINE_STATUSES.has(offlineStatus);
  const finishedAt = toIsoString(run.finishedAt || run.endedAt || run.date, null);
  const createdAt = toIsoString(run.createdAt || run.startedAt || run.date, now);
  const updatedAt = toIsoString(run.updatedAt, now);
  const date = finishedAt || toIsoString(run.date || run.createdAt || run.updatedAt, now);
  const inferredMode = normalizeRunMode(
    run.mode ||
    run.type ||
    run.runMode ||
    (Number(run.area ?? run.areaM2 ?? 0) > 0 || sanitizeCoordsArray(run.zoneCoords || run.zone?.coords || []).length >= 3 ? "zones" : "free")
  );
  const isZoneRun = inferredMode === "zones";
  const zoneCoords = isZoneRun ? sanitizeCoordsArray(run.zoneCoords || run.zone?.coords || []) : [];

  return {
    ...run,
    id: String(run.id || stableId),
    userId: run.userId || run.ownerId || auth?.currentUser?.uid || "offline",
    localRunId: run.localRunId || run.id || stableId,
    remoteRunId: run.remoteRunId || null,
    legacyId: run.legacyId || run.runId || null,
    path: trustedPath,
    trustedPath,
    filteredPoints: sanitizeCoordsArray(run.filteredPoints || trustedPath),
    rawPath,
    rawPoints: rawPath,
    segments,
    routeSegments: segments,
    liveRenderPath: sanitizeCoordsArray(run.liveRenderPath || []),
    renderPath,
    displayPath: sanitizeCoordsArray(run.displayPath || run.renderPath || renderPath),
    displayPoints: sanitizeCoordsArray(run.displayPoints || run.displayPath || run.renderPath || renderPath),
    pathQuality: run.pathQuality || null,
    gpsQualitySummary: run.gpsQualitySummary || run.pathQuality || null,
    lowConfidenceSegments: Array.isArray(run.lowConfidenceSegments) ? run.lowConfidenceSegments : [],
    smoothingVersion: run.smoothingVersion || run.pathQuality?.smoothingVersion || null,
    filterVersion: run.filterVersion || run.pathQuality?.filterVersion || run.gpsQualitySummary?.filterVersion || null,
    distance: Number(run.distance ?? run.distanceMeters ?? 0),
    distanceMeters: Number(run.distanceMeters ?? run.distance ?? 0),
    duration: Number(run.duration ?? run.durationSeconds ?? 0),
    durationSeconds: Number(run.durationSeconds ?? run.duration ?? 0),
    avgSpeed: Number(run.avgSpeed ?? 0),
    maxSpeed: Number(run.maxSpeed ?? 0),
    avgPace: Number(run.avgPace ?? 0),
    date,
    startedAt: toIsoString(run.startedAt, null),
    finishedAt,
    endedAt: finishedAt,
    pausedDurationSeconds: run.pausedDurationSeconds ?? null,
    status: run.status && !ACTIVE_RUN_HISTORY_STATUSES.has(normalizeStatusText(run.status)) ? run.status : "completed",
    synced: syncStatus === RUN_SYNC_STATUS.SYNCED,
    pendingSync,
    syncStatus,
    offlineStatus,
    syncAttempts: Number(run.syncAttempts ?? run.retryCount ?? 0),
    retryCount: Number(run.retryCount ?? run.syncAttempts ?? 0),
    lastSyncAttemptAt: toIsoString(run.lastSyncAttemptAt, null),
    lastSyncError: syncStatus === RUN_SYNC_STATUS.SYNCED ? null : (run.lastSyncError || run.syncError || null),
    syncError: syncStatus === RUN_SYNC_STATUS.SYNCED ? null : (run.syncError || run.lastSyncError || null),
    syncErrorType: syncStatus === RUN_SYNC_STATUS.SYNCED ? null : (run.syncErrorType || null),
    syncErrorRecoverable: run.syncErrorRecoverable !== undefined ? !!run.syncErrorRecoverable : true,
    lastSyncedAt: toIsoString(run.lastSyncedAt || run.syncedAt, null),
    syncedAt: toIsoString(run.syncedAt || run.lastSyncedAt, null),
    schemaVersion: Number(run.schemaVersion || 1),
    createdAt,
    updatedAt,
    name: run.name || run.title || `${inferredMode === "zones" ? "Captura por zonas" : "Corrida"} ${new Date(date).toLocaleString()}`,
    title: run.title || run.name || null,
    effort: Number(run.effort ?? 5),
    notes: run.notes || "",
    tags: Array.isArray(run.tags) ? run.tags : [],
    photoUri: run.photoUri || null,
    mode: inferredMode,
    zoneId: isZoneRun ? (run.zoneId || null) : null,
    area: isZoneRun ? Number(run.area ?? run.areaM2 ?? 0) : 0,
    areaM2: isZoneRun ? Number(run.areaM2 ?? run.area ?? 0) : 0,
    zoneCoords,
    territorySummary: isZoneRun ? (run.territorySummary || run.zoneSummary || null) : null,
    territoryEvents: isZoneRun && Array.isArray(run.territoryEvents) ? run.territoryEvents : [],
    color: isZoneRun ? (run.color || run.zoneColor || run.territoryColor || "#00E676") : null,
    strokeColor: isZoneRun ? (run.strokeColor || run.color || "#00E676") : null,
    fillOpacity: isZoneRun ? Number(run.fillOpacity ?? 0.22) : null,
    geometry: isZoneRun ? (run.geometry || run.zoneGeometry || null) : null,
    routeGeometry: isZoneRun ? (run.routeGeometry || null) : null,
    zoneCount: isZoneRun ? Number(run.zoneCount ?? (zoneCoords.length >= 3 ? 1 : 0)) : 0,
    visibility: run.visibility || "followers",
    subscriberNotificationSent: !!run.subscriberNotificationSent,
    subscriberNotificationSentAt: run.subscriberNotificationSentAt || null,
  };
}

function normalizeLocalRunsForHistory(runs = []) {
  return dedupeLocalRunRecords(
    (Array.isArray(runs) ? runs : [])
      .map((run) => normalizeLocalRunRecord(run, { forHistory: true }))
      .filter(Boolean)
  ).sort((a, b) => dateMs(b.finishedAt || b.date || b.createdAt) - dateMs(a.finishedAt || a.date || a.createdAt));
}

function findRunInListByAnyId(runs = [], lookup) {
  const ids = getRunIdentityCandidates(
    typeof lookup === "object"
      ? lookup
      : { id: lookup, localRunId: lookup, remoteRunId: lookup, runId: lookup, legacyId: lookup }
  );
  if (ids.length === 0) return null;
  const set = new Set(ids);
  return (Array.isArray(runs) ? runs : []).find((run) =>
    getRunIdentityCandidates(run).some((id) => set.has(id))
  ) || null;
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
    return normalizeLocalRunsForHistory(safeParse(raw));
  } catch (err) {
    logError(err, { fn: "loadLocalRuns" });
    return [];
  }
}

export async function loadLocalRunHistory() {
  return loadLocalRuns();
}

export async function findLocalRunById(lookup) {
  try {
    const local = await loadLocalRuns();
    return findRunInListByAnyId(local, lookup);
  } catch (err) {
    logError(err, { fn: "findLocalRunById", lookup });
    return null;
  }
}

export async function saveLocalRun(run = {}) {
  recordRunEvent("RUN_SAVE_STARTED", {
    runId: run.id || run.runId || null,
    localRunId: run.localRunId || null,
    pointsCount: run.trustedPath?.length || run.path?.length || 0,
    segmentsCount: run.routeSegments?.length || run.segments?.length || 0,
  });
  try {
    const existing = await loadLocalRuns();
    const now = new Date().toISOString();
    const normalized = normalizeLocalRunRecord(
      {
        ...run,
        id: run.id || run.localRunId || uid(),
        date: run.finishedAt || run.endedAt || run.date || now,
        status: run.status || "completed",
      },
      { now }
    );
    if (!normalized) throw new Error("invalid_run");

    const sameZoneRunIndex =
      normalized.zoneId && (normalized.mode === "zones" || normalized.area > 0 || normalized.zoneCoords.length >= 3)
        ? existing.findIndex((item) => item?.zoneId === normalized.zoneId && (item?.mode === "zones" || Number(item?.area || 0) > 0))
        : -1;
    const sameRunIndex = existing.findIndex((item) => hasSharedRunIdentity(item, normalized));
    const replaceIndex = sameZoneRunIndex >= 0 ? sameZoneRunIndex : sameRunIndex;

    const savedRecord =
      replaceIndex >= 0
        ? mergeLocalRunRecords(existing[replaceIndex], normalized)
        : normalized;

    const next =
      replaceIndex >= 0
        ? existing.map((item, index) => (index === replaceIndex ? savedRecord : item))
        : [savedRecord, ...existing];

    const deduped = normalizeLocalRunsForHistory(uniqueById(next));
    await AsyncStorage.setItem(RUNS_KEY, safeStringify(deduped));
    recordRunEvent("RUN_SAVED_LOCAL", {
      runId: savedRecord.id,
      localRunId: savedRecord.localRunId || savedRecord.id,
      status: savedRecord.status,
      syncStatus: savedRecord.syncStatus,
      pointsCount: savedRecord.trustedPath?.length || savedRecord.path?.length || 0,
      segmentsCount: savedRecord.routeSegments?.length || savedRecord.segments?.length || 0,
      distance: savedRecord.distanceMeters ?? savedRecord.distance ?? 0,
    });
    return savedRecord;
  } catch (err) {
    logError(err, { fn: "saveLocalRun" });
    recordRunEvent("RUN_SAVE_FAILED", {
      runId: run.id || run.runId || null,
      localRunId: run.localRunId || null,
      reason: err?.message || "save_local_run_failed",
    }, { skipRemote: true });
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
    const next = (Array.isArray(existing) ? existing : []).filter((run) =>
      !getRunIdentityCandidates(run).includes(id)
    );
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

function logRunSync(event, context = {}, level = "debug") {
  try {
    const method = logger[level] || logger.debug;
    method(LOG_CATEGORIES.SYNC, event, context);
  } catch {}
}

function getLocalRunId(run = {}) {
  const id = run.localRunId || run.id || run.runId || run.legacyId || null;
  return id == null ? null : String(id).trim();
}

function isValidFirestoreDocId(value) {
  const id = String(value || "").trim();
  return Boolean(id) && id.length <= 500 && !id.includes("/") && !/^__.*__$/.test(id);
}

function getRunQueueDecision(run = {}) {
  const normalized = normalizeLocalRunRecord(run, { forHistory: true }) || run;
  const syncStatus = normalizeRunSyncStatus(normalized);
  const offlineStatus = normalizeRunOfflineStatus(normalized, syncStatus);
  const localRunId = getLocalRunId(normalized);
  const mode = normalizeRunMode(normalized.mode);
  const pathCount = sanitizeCoordsArray(normalized.trustedPath || normalized.path || []).length;
  const renderPathCount = sanitizeCoordsArray(normalized.renderPath || normalized.displayPath || []).length;
  const segmentCount = sanitizeRunSegments(normalized.routeSegments || normalized.segments || []).length;
  const zoneCoordsCount = mode === "zones" ? sanitizeCoordsArray(normalized.zoneCoords || []).length : 0;
  const hasTerritory = mode === "zones" && (
    Number(normalized.area ?? normalized.areaM2 ?? 0) > 0 ||
    zoneCoordsCount >= 3 ||
    Boolean(normalized.geometry)
  );
  const hasMinimumPayload =
    pathCount > 0 ||
    renderPathCount > 0 ||
    segmentCount > 0 ||
    Number(normalized.distance ?? normalized.distanceMeters ?? 0) > 0 ||
    Number(normalized.duration ?? normalized.durationSeconds ?? 0) > 0 ||
    hasTerritory;

  if (!localRunId) return { queue: false, reason: "missing_local_run_id", run: normalized };
  if (!isFinishedHistoryRun(normalized)) return { queue: false, reason: "not_finished_history_run", run: normalized };
  if (!hasMinimumPayload) return { queue: false, reason: "missing_minimum_payload", run: normalized };
  if (normalized.syncErrorRecoverable === false) return { queue: false, reason: "sync_error_not_recoverable", run: normalized };
  if (syncStatus === RUN_SYNC_STATUS.SYNCED && offlineStatus === RUN_OFFLINE_STATUS.SYNCED && normalized.pendingSync !== true) {
    return { queue: false, reason: "already_synced", run: normalized };
  }
  if (
    normalized.pendingSync === true ||
    normalized.synced === false ||
    QUEUEABLE_SYNC_STATUSES.has(syncStatus) ||
    QUEUEABLE_OFFLINE_STATUSES.has(offlineStatus)
  ) {
    return { queue: true, reason: `${syncStatus}:${offlineStatus}`, run: normalized };
  }
  return { queue: false, reason: "not_queueable_status", run: normalized };
}

export function isRunQueuedForSync(run = {}) {
  return getRunQueueDecision(run).queue;
}

function sanitizeFirestoreValue(value, depth = 0) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value !== "object") return value;
  if (typeof value?.toDate === "function" && Number.isFinite(Number(value?.seconds))) return value;
  if (depth > 8) return undefined;

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeFirestoreValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    const sanitized = sanitizeFirestoreValue(entry, depth + 1);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

function capRemoteArray(values = [], cap = ROUTE_CAP) {
  const list = Array.isArray(values) ? values : [];
  return {
    values: list.slice(0, cap),
    originalCount: list.length,
    truncated: list.length > cap,
  };
}

function classifyRunSyncError(error = {}) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "sync_error");
  const lower = message.toLowerCase();

  if (
    lower.includes("invalid_remote_run_id") ||
    lower.includes("missing_local_run_id") ||
    lower.includes("missing_minimum_payload") ||
    lower.includes("invalid_run_payload") ||
    lower.includes("too large") ||
    lower.includes("document size") ||
    lower.includes("payload")
  ) {
    return { type: "validation", recoverable: false, message };
  }
  if (code.includes("permission-denied") || lower.includes("permission")) {
    return { type: "permission_denied", recoverable: false, message };
  }
  if (lower.includes("auth_required") || lower.includes("not-authenticated")) {
    return { type: "auth_required", recoverable: true, message };
  }
  if (
    code.includes("unavailable") ||
    code.includes("deadline-exceeded") ||
    code.includes("resource-exhausted") ||
    lower.includes("unavailable") ||
    lower.includes("timeout") ||
    lower.includes("network") ||
    lower.includes("offline")
  ) {
    return { type: "temporary", recoverable: true, message };
  }
  return { type: code || "unknown", recoverable: true, message };
}

async function findRemoteRunIdByLocalRunId(localRunId, uid) {
  if (!localRunId || !uid || uid === "offline") return null;
  try {
    const snap = await getDocs(query(
      collection(db, "runs"),
      where("localRunId", "==", String(localRunId)),
      firestoreLimit(1)
    ));
    const docSnap = snap?.docs?.[0] || null;
    if (!docSnap) return null;
    const data = typeof docSnap.data === "function" ? docSnap.data() : {};
    const remoteRunId = data?.remoteRunId || data?.id || docSnap.id || null;
    if (!remoteRunId || !isValidFirestoreDocId(remoteRunId)) return null;
    logRunSync("RUN_SYNC_REMOTE_DEDUPE_FOUND", {
      localRunId,
      remoteRunId,
      source: "localRunId_lookup",
    });
    return String(remoteRunId);
  } catch (error) {
    logRunSync("RUN_SYNC_REMOTE_DEDUPE_LOOKUP_SKIPPED", {
      localRunId,
      errorType: classifyRunSyncError(error).type,
    }, "warn");
    return null;
  }
}

async function resolveRemoteRunDocumentId(run = {}, uid) {
  const localRunId = getLocalRunId(run);
  if (!localRunId) throw new Error("missing_local_run_id");

  if (run.remoteRunId) {
    const remoteRunId = String(run.remoteRunId).trim();
    if (!isValidFirestoreDocId(remoteRunId)) throw new Error("invalid_remote_run_id");
    return { remoteRunId, source: "remoteRunId" };
  }

  const dedupedRemoteRunId = await findRemoteRunIdByLocalRunId(localRunId, uid);
  if (dedupedRemoteRunId) return { remoteRunId: dedupedRemoteRunId, source: "localRunId_lookup" };

  if (!isValidFirestoreDocId(localRunId)) throw new Error("invalid_local_run_id");
  return { remoteRunId: localRunId, source: "localRunId" };
}

function buildRunFirestorePayload(run = {}, { remoteRunId, uid, now = new Date().toISOString() } = {}) {
  const localRunId = getLocalRunId(run);
  if (!localRunId || !remoteRunId) throw new Error("invalid_run_payload");

  const mode = normalizeRunMode(run.mode);
  const isZoneRun = mode === "zones";
  const path = capRemoteArray(sanitizeCoordsArray(run.trustedPath || run.path || []));
  const rawPath = capRemoteArray(sanitizeCoordsArray(run.rawPath || run.rawPoints || []));
  const renderPath = capRemoteArray(sanitizeCoordsArray(run.renderPath || run.displayPath || path.values));
  const displayPath = capRemoteArray(sanitizeCoordsArray(run.displayPath || run.renderPath || renderPath.values));
  const filteredPoints = capRemoteArray(sanitizeCoordsArray(run.filteredPoints || path.values));
  const displayPoints = capRemoteArray(sanitizeCoordsArray(run.displayPoints || run.displayPath || run.renderPath || displayPath.values));
  const segments = sanitizeRunSegments(run.routeSegments || run.segments || []);
  const zoneCoords = isZoneRun ? capRemoteArray(sanitizeCoordsArray(run.zoneCoords || []), 5000) : { values: [], originalCount: 0, truncated: false };
  const routeLimit = {
    routePointLimit: ROUTE_CAP,
    trustedPathOriginalCount: path.originalCount,
    trustedPathTruncated: path.truncated,
    rawPathOriginalCount: rawPath.originalCount,
    rawPathTruncated: rawPath.truncated,
    renderPathOriginalCount: renderPath.originalCount,
    renderPathTruncated: renderPath.truncated,
    zoneCoordsOriginalCount: zoneCoords.originalCount,
    zoneCoordsTruncated: zoneCoords.truncated,
  };

  if (Object.values(routeLimit).some((value) => value === true)) {
    logRunSync("RUN_SYNC_REMOTE_PAYLOAD_TRUNCATED", {
      localRunId,
      remoteRunId,
      trustedPathOriginalCount: routeLimit.trustedPathOriginalCount,
      rawPathOriginalCount: routeLimit.rawPathOriginalCount,
      renderPathOriginalCount: routeLimit.renderPathOriginalCount,
      zoneCoordsOriginalCount: routeLimit.zoneCoordsOriginalCount,
    }, "warn");
  }

  const payload = {
    id: remoteRunId,
    localRunId,
    remoteRunId,
    runId: localRunId,
    legacyId: run.legacyId || run.runId || null,
    userId: uid,
    path: path.values,
    trustedPath: path.values,
    filteredPoints: filteredPoints.values,
    rawPath: rawPath.values,
    rawPoints: rawPath.values,
    segments,
    routeSegments: segments,
    renderPath: renderPath.values,
    displayPath: displayPath.values,
    displayPoints: displayPoints.values,
    pathQuality: run.pathQuality || null,
    gpsQualitySummary: run.gpsQualitySummary || run.pathQuality || null,
    lowConfidenceSegments: Array.isArray(run.lowConfidenceSegments) ? run.lowConfidenceSegments : [],
    smoothingVersion: run.smoothingVersion || run.pathQuality?.smoothingVersion || null,
    filterVersion: run.filterVersion || run.pathQuality?.filterVersion || run.gpsQualitySummary?.filterVersion || null,
    distance: Number(run.distance ?? run.distanceMeters ?? 0),
    distanceMeters: Number(run.distanceMeters ?? run.distance ?? 0),
    duration: Number(run.duration ?? run.durationSeconds ?? 0),
    durationSeconds: Number(run.durationSeconds ?? run.duration ?? 0),
    pace: Number(run.pace ?? run.avgPace ?? 0),
    avgSpeed: Number(run.avgSpeed ?? run.averageSpeed ?? 0),
    averageSpeed: Number(run.averageSpeed ?? run.avgSpeed ?? 0),
    maxSpeed: Number(run.maxSpeed || 0),
    avgPace: Number(run.avgPace ?? run.pace ?? 0),
    averagePace: Number(run.averagePace ?? run.avgPace ?? run.pace ?? 0),
    area: isZoneRun ? Number(run.area ?? run.areaM2 ?? 0) : 0,
    areaM2: isZoneRun ? Number(run.areaM2 ?? run.area ?? 0) : 0,
    mode,
    zoneId: isZoneRun ? (run.zoneId || null) : null,
    zoneCoords: zoneCoords.values,
    color: isZoneRun ? (run.color || run.zoneColor || "#00E676") : null,
    strokeColor: isZoneRun ? (run.strokeColor || run.color || "#00E676") : null,
    fillOpacity: isZoneRun ? Number(run.fillOpacity ?? 0.22) : null,
    geometry: isZoneRun ? (run.geometry || run.zoneGeometry || null) : null,
    routeGeometry: isZoneRun ? (run.routeGeometry || null) : null,
    zoneCount: isZoneRun ? Number(run.zoneCount || (zoneCoords.values.length >= 3 ? 1 : 0)) : 0,
    territorySummary: isZoneRun ? (run.territorySummary || run.zoneSummary || null) : null,
    territoryEvents: isZoneRun && Array.isArray(run.territoryEvents) ? run.territoryEvents : [],
    name: run.name || "Corrida",
    title: run.title || run.name || null,
    effort: Number(run.effort || 0),
    notes: run.notes || "",
    tags: Array.isArray(run.tags) ? run.tags : [],
    photoUri: run.photoUri || null,
    visibility: run.visibility || "followers",
    date: toIsoString(run.date || run.finishedAt || run.endedAt || now, now),
    startedAt: toIsoString(run.startedAt, null),
    finishedAt: toIsoString(run.finishedAt || run.endedAt || run.date, null),
    endedAt: toIsoString(run.endedAt || run.finishedAt || run.date, null),
    pausedDurationSeconds: run.pausedDurationSeconds ?? null,
    status: getRemoteRunStatus(run.status),
    schemaVersion: Number(run.schemaVersion || 1),
    createdAt: toIsoString(run.createdAt || run.date, now),
    updatedAt: now,
    syncedAt: now,
    lastSyncAttemptAt: run.lastSyncAttemptAt || now,
    remoteRouteLimits: routeLimit,
  };

  return sanitizeFirestoreValue(payload);
}

async function commitRunToFirestore(run = {}, { attemptAt = new Date().toISOString() } = {}) {
  const uid = auth?.currentUser?.uid || null;
  if (!uid || uid === "offline") throw new Error("auth_required_for_run_sync");

  const { remoteRunId, source } = await resolveRemoteRunDocumentId(run, uid);
  const payload = buildRunFirestorePayload(run, { remoteRunId, uid, now: attemptAt });
  const batch = writeBatch(db);
  batch.set(doc(db, "runs", remoteRunId), payload, { merge: true });
  batch.set(doc(db, "users", uid, "runs", remoteRunId), payload, { merge: true });

  const isZoneActivity = payload.mode === "zones" && (Number(payload.area || 0) > 0 || (Array.isArray(payload.zoneCoords) && payload.zoneCoords.length >= 3));
  const activityId = `run_${uid}_${remoteRunId}`;
  const activityType = isZoneActivity ? "zone" : "run";
  batch.set(
    doc(db, "activities", activityId),
    sanitizeFirestoreValue({
      id: activityId,
      type: activityType,
      userId: uid,
      runId: remoteRunId,
      localRunId: payload.localRunId,
      remoteRunId,
      distance: Number(payload.distance || 0),
      duration: Number(payload.duration || 0),
      area: isZoneActivity ? Number(payload.area || 0) : 0,
      mode: payload.mode,
      zoneCount: isZoneActivity ? Number(payload.zoneCount || 0) : 0,
      name: payload.name || "Corrida",
      description: isZoneActivity
        ? `capturou uma area e correu ${(Number(payload.distance || 0) / 1000).toFixed(2)} km`
        : `correu ${(Number(payload.distance || 0) / 1000).toFixed(2)} km`,
      visibility: payload.visibility || "followers",
      createdAt: attemptAt,
      timestamp: attemptAt,
    }),
    { merge: true }
  );

  await batch.commit();
  return {
    remoteRunId,
    remoteIdSource: source,
    uid,
    activityId,
    activityType,
    payload,
  };
}

// ----------------- Sync Runs to Firestore -----------------
export async function syncRunsToFirestore() {
  if (isSyncingRuns) {
    logRunSync("RUN_SYNC_CONCURRENT_IGNORED", { source: "syncRunsToFirestore" });
    recordRunEvent("RUN_SYNC_QUEUED", {
      source: "syncRunsToFirestore",
      reason: "already_syncing",
    });
    return { skipped: true, reason: "already_syncing" };
  }

  isSyncingRuns = true;
  const summary = {
    attempted: 0,
    synced: 0,
    failed: 0,
    recoverableFailures: 0,
    skipped: 0,
    offline: false,
    runIds: [],
  };

  try {
    const online = await hasNetworkConnection();
    if (!online) {
      summary.offline = true;
      logRunSync("RUN_SYNC_SKIPPED_OFFLINE", { source: "syncRunsToFirestore" });
      return summary;
    }

    const local = await loadLocalRuns();
    if (!Array.isArray(local) || local.length === 0) return summary;

    const queued = [];
    for (const run of local) {
      const decision = getRunQueueDecision(run);
      if (decision.queue) {
        queued.push(decision.run);
      } else {
        summary.skipped += 1;
        logRunSync("RUN_SYNC_ITEM_SKIPPED", {
          localRunId: getLocalRunId(decision.run || run),
          remoteRunId: decision.run?.remoteRunId || run?.remoteRunId || null,
          reason: decision.reason,
        });
      }
    }

    if (queued.length === 0) return summary;

    recordRunEvent("RUN_SYNC_QUEUED", {
      count: queued.length,
      runIds: queued.map((run) => run.id || run.localRunId).filter(Boolean).slice(0, 20),
    });
    logRunSync("RUN_SYNC_STARTED", {
      count: queued.length,
      runIds: queued.map((run) => run.id || run.localRunId).filter(Boolean).slice(0, 20),
    }, "info");

    for (const queuedRun of queued) {
      const lookup = {
        id: queuedRun.id,
        localRunId: queuedRun.localRunId,
        remoteRunId: queuedRun.remoteRunId,
        runId: queuedRun.runId,
        legacyId: queuedRun.legacyId,
      };
      const attemptAt = new Date().toISOString();
      let currentRun = null;
      let syncingRun = null;

      try {
        currentRun = (await findLocalRunById(lookup)) || queuedRun;
        const decision = getRunQueueDecision(currentRun);
        if (!decision.queue) {
          summary.skipped += 1;
          logRunSync("RUN_SYNC_ITEM_SKIPPED", {
            localRunId: getLocalRunId(currentRun),
            remoteRunId: currentRun?.remoteRunId || null,
            reason: decision.reason,
          });
          continue;
        }

        const attempts = Number(currentRun.syncAttempts ?? currentRun.retryCount ?? 0) + 1;
        syncingRun = await saveLocalRun({
          ...currentRun,
          synced: false,
          pendingSync: true,
          syncStatus: RUN_SYNC_STATUS.SYNCING,
          offlineStatus: RUN_OFFLINE_STATUS.SYNCING,
          syncAttempts: attempts,
          retryCount: attempts,
          lastSyncAttemptAt: attemptAt,
          lastSyncError: null,
          syncError: null,
          syncErrorType: null,
          syncErrorRecoverable: true,
          updatedAt: attemptAt,
        });

        summary.attempted += 1;
        summary.runIds.push(syncingRun.id || syncingRun.localRunId);
        logRunSync("RUN_SYNC_ITEM_STARTED", {
          localRunId: syncingRun.localRunId,
          remoteRunId: syncingRun.remoteRunId || null,
          syncAttempts: attempts,
        });

        const remoteResult = await commitRunToFirestore(syncingRun, { attemptAt });
        const syncedAt = new Date().toISOString();
        const latest = (await findLocalRunById({
          ...lookup,
          localRunId: syncingRun.localRunId,
          remoteRunId: remoteResult.remoteRunId,
        })) || syncingRun;
        const localChangedAfterAttempt =
          dateMs(latest.updatedAt) > dateMs(attemptAt);

        const saved = await saveLocalRun({
          ...latest,
          remoteRunId: remoteResult.remoteRunId,
          synced: !localChangedAfterAttempt,
          pendingSync: localChangedAfterAttempt,
          syncStatus: localChangedAfterAttempt ? RUN_SYNC_STATUS.PENDING : RUN_SYNC_STATUS.SYNCED,
          offlineStatus: localChangedAfterAttempt ? RUN_OFFLINE_STATUS.PENDING_SYNC : RUN_OFFLINE_STATUS.SYNCED,
          lastSyncError: null,
          syncError: null,
          syncErrorType: null,
          syncErrorRecoverable: true,
          lastSyncedAt: syncedAt,
          syncedAt,
          updatedAt: localChangedAfterAttempt ? latest.updatedAt : syncedAt,
        });

        if (!localChangedAfterAttempt && !saved.subscriberNotificationSent) {
          try {
            await notifyActivitySubscribers({
              run: saved,
              activityId: remoteResult.activityId,
              activityType: remoteResult.activityType,
              authorUid: remoteResult.uid,
              authorName: auth?.currentUser?.displayName || auth?.currentUser?.email?.split("@")?.[0] || "Atleta Wayper",
            });
            await saveLocalRun({
              ...saved,
              subscriberNotificationSent: true,
              subscriberNotificationSentAt: new Date().toISOString(),
            });
          } catch (notificationError) {
            logRunSync("RUN_SYNC_NOTIFICATION_SKIPPED", {
              localRunId: saved.localRunId,
              remoteRunId: saved.remoteRunId,
              errorType: classifyRunSyncError(notificationError).type,
            }, "warn");
          }
        }

        summary.synced += 1;
        logRunSync("RUN_SYNC_ITEM_SUCCESS", {
          localRunId: saved.localRunId,
          remoteRunId: saved.remoteRunId,
          remoteIdSource: remoteResult.remoteIdSource,
          pendingLocalChanges: localChangedAfterAttempt,
        }, "info");
      } catch (error) {
        const failedAt = new Date().toISOString();
        const failure = classifyRunSyncError(error);
        const failedRun = syncingRun || currentRun || queuedRun;
        summary.failed += 1;
        if (failure.recoverable) summary.recoverableFailures += 1;
        logError(error, {
          fn: "syncRunsToFirestore.item",
          localRunId: getLocalRunId(failedRun),
          remoteRunId: failedRun?.remoteRunId || null,
          errorType: failure.type,
          recoverable: failure.recoverable,
        });
        recordRunEvent("RUN_SYNC_FAILED", {
          runId: failedRun?.id || null,
          localRunId: getLocalRunId(failedRun),
          remoteRunId: failedRun?.remoteRunId || null,
          errorType: failure.type,
          recoverable: failure.recoverable,
          error,
        });

        try {
          await saveLocalRun({
            ...failedRun,
            synced: false,
            pendingSync: failure.recoverable,
            syncStatus: RUN_SYNC_STATUS.FAILED,
            offlineStatus: RUN_OFFLINE_STATUS.SYNC_FAILED,
            lastSyncError: failure.message,
            syncError: failure.message,
            syncErrorType: failure.type,
            syncErrorRecoverable: failure.recoverable,
            updatedAt: failedAt,
          });
        } catch (statusError) {
          logError(statusError, {
            fn: "syncRunsToFirestore.markItemFailed",
            localRunId: getLocalRunId(failedRun),
          });
        }
      }
    }

    if (summary.recoverableFailures > 0) {
      const meta = (await _getRetryMeta(RETRY_META_RUNS)) || { attempts: 0 };
      const attempts = (meta.attempts || 0) + 1;
      const backoff = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
      await _setRetryMeta(RETRY_META_RUNS, {
        attempts,
        nextAt: Date.now() + backoff,
      });
      logRunSync("RUN_SYNC_RETRY_SCHEDULED", {
        attempts,
        backoffMs: backoff,
        recoverableFailures: summary.recoverableFailures,
      });
      setTimeout(() => {
        syncRunsToFirestore().catch((e) =>
          logError(e, { fn: "syncRunsToFirestore.retry" })
        );
      }, backoff);
    } else {
      await _setRetryMeta(RETRY_META_RUNS, { attempts: 0, nextAt: 0 });
    }

    recordRunEvent(summary.failed > 0 ? "RUN_SYNC_FAILED" : "RUN_SYNC_SUCCESS", {
      count: summary.attempted,
      synced: summary.synced,
      failed: summary.failed,
      recoverableFailures: summary.recoverableFailures,
      runIds: summary.runIds.slice(0, 20),
    });
    recordRunEvent("RUN_SYNC_COMPLETED", {
      count: summary.attempted,
      synced: summary.synced,
      failed: summary.failed,
      result: summary.failed > 0 ? "partial_failure" : "success",
    });

    return summary;
  } catch (err) {
    logError(err, { fn: "syncRunsToFirestore" });
    recordRunEvent("RUN_SYNC_FAILED", {
      count: summary.attempted,
      synced: summary.synced,
      failed: summary.failed,
      error: err,
    });
    recordRunEvent("RUN_SYNC_COMPLETED", {
      count: summary.attempted,
      synced: summary.synced,
      failed: summary.failed,
      result: "failure",
    });
    return {
      ...summary,
      error: err,
    };
  } finally {
    isSyncingRuns = false;
  }
}

export function scheduleRunsSync(delay = SYNC_DEBOUNCE_MS) {
  if (debounceRunsTimer) clearTimeout(debounceRunsTimer);
  recordRunEvent("RUN_SYNC_QUEUED", {
    delayMs: delay,
    source: "scheduleRunsSync",
  });
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

function scheduleAllSync(delay = SYNC_DEBOUNCE_MS, source = "scheduleAllSync") {
  if (debounceAllTimer) clearTimeout(debounceAllTimer);
  logRunSync("SYNC_ALL_QUEUED", { delayMs: delay, source });
  debounceAllTimer = setTimeout(() => {
    syncAll().catch((e) => logError(e, { fn: source }));
  }, delay);
}

export function startAutoSync(intervalMs = AUTO_SYNC_INTERVAL_MS) {
  if (!netInfoUnsubscribe) {
    netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        scheduleAllSync(SYNC_DEBOUNCE_MS, "startAutoSync.netInfo");
      }
    });
  }

  if (!appStateUnsubscribe && AppState?.addEventListener) {
    try {
      appStateUnsubscribe = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          scheduleAllSync(SYNC_DEBOUNCE_MS, "startAutoSync.appState");
        }
      });
    } catch (error) {
      logError(error, { fn: "startAutoSync.appState" });
    }
  }

  if (autoSyncTimer) return;
  scheduleAllSync(0, "startAutoSync.initial");
  autoSyncTimer = setInterval(() => {
    syncAll().catch((e) => logError(e, { fn: "startAutoSync.tick" }));
  }, intervalMs);
}

export function stopAutoSync() {
  if (debounceAllTimer) {
    clearTimeout(debounceAllTimer);
    debounceAllTimer = null;
  }
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (netInfoUnsubscribe) {
    try {
      netInfoUnsubscribe();
    } catch {}
    netInfoUnsubscribe = null;
  }
  if (appStateUnsubscribe) {
    try {
      appStateUnsubscribe.remove?.();
      if (typeof appStateUnsubscribe === "function") appStateUnsubscribe();
    } catch {}
    appStateUnsubscribe = null;
  }
}

export function getSyncRuntimeStatus() {
  return {
    isSyncingRuns,
    isSyncingZones,
    isSyncingMedals,
    isSyncingTerritories,
    isSyncingTerritoryEvents,
    hasRunsDebounce: Boolean(debounceRunsTimer),
    hasZonesDebounce: Boolean(debounceZonesTimer),
    hasMedalsDebounce: Boolean(debounceMedalsTimer),
    hasTerritoriesDebounce: Boolean(debounceTerritoriesTimer),
    hasTerritoryEventsDebounce: Boolean(debounceTerritoryEventsTimer),
    hasAllDebounce: Boolean(debounceAllTimer),
    autoSyncActive: Boolean(autoSyncTimer),
    netInfoListenerActive: Boolean(netInfoUnsubscribe),
    appStateListenerActive: Boolean(appStateUnsubscribe),
  };
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
      logger.debug(LOG_CATEGORIES.SYNC, "BACKGROUND_SYNC_TASK_DEFINE_SKIPPED", {
        error: e,
      });
    }
  } else {
    logger.warn(LOG_CATEGORIES.SYNC, "BACKGROUND_SYNC_TASK_MANAGER_UNAVAILABLE");
  }
} catch (e) {
  logger.warn(LOG_CATEGORIES.SYNC, "BACKGROUND_SYNC_TASK_DEFINE_FAILED", {
    error: e,
  });
}

/**
 * Register a background sync task using expo-background-fetch.
 * - idempotent
 * - returns boolean success
 */
export async function registerBackgroundSyncTask(options = { minimumInterval: 15 * 60 }) {
  try {
    if (!TaskManager || !BackgroundFetch) {
      logger.warn(LOG_CATEGORIES.SYNC, "BACKGROUND_FETCH_UNAVAILABLE");
      return false;
    }

    // Ensure task was defined above (best-effort)
    if (!TaskManager || typeof TaskManager.defineTask !== "function") {
      logger.warn(LOG_CATEGORIES.SYNC, "BACKGROUND_SYNC_TASK_MANAGER_UNAVAILABLE");
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
  loadLocalRunHistory,
  findLocalRunById,
  saveLocalRun,
  deleteLocalRun,
  loadLocalZones,
  saveLocalZone,
  createAndSaveZoneFromPath,
  syncRunsToFirestore,
  isRunQueuedForSync,
  syncZonesToFirestore,
  scheduleRunsSync,
  scheduleZonesSync,
  syncAll,
  syncNow,
  startAutoSync,
  stopAutoSync,
  getSyncRuntimeStatus,
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
