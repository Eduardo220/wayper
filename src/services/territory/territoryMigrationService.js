import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "../../firebaseConfig.js";
import { TERRITORY_CONFIG } from "./territoryConfig.js";
import { getCellIdsForGeometry } from "./territoryCellService.js";
import {
  calculateGeometryAreaM2,
  calculateGeometryBbox,
  calculateGeometryCenter,
  geometryToPreviewCoords,
  normalizeGeometry,
} from "./territoryGeometryService.js";
import { loadLocalTerritories, saveLocalTerritories } from "./territoryStorageService.js";
import { TERRITORY_SOURCE, TERRITORY_STATUS } from "./territoryTypes.js";

const LEGACY_ZONES_KEY = "zones";
const DEFAULT_LIMIT = 500;

const safeParse = (raw, fallback = []) => {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const toNumber = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toIsoString = (value, fallback = new Date().toISOString()) => {
  if (!value) return fallback;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value.toISOString();
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      return fallback;
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

function normalizeCoord(point) {
  if (!point) return null;
  if (Array.isArray(point)) {
    const first = Number(point[0]);
    const second = Number(point[1]);
    if (Number.isFinite(first) && Number.isFinite(second)) {
      if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return { latitude: first, longitude: second };
      if (Math.abs(second) <= 90 && Math.abs(first) <= 180) return { latitude: second, longitude: first };
    }
    return null;
  }

  const latitude = toNumber(point.latitude ?? point.lat);
  const longitude = toNumber(point.longitude ?? point.lng ?? point.lon);
  if (latitude == null || longitude == null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function normalizeZoneCoords(zone = {}) {
  const source = Array.isArray(zone.coords)
    ? zone.coords
    : Array.isArray(zone.zoneCoords)
      ? zone.zoneCoords
      : [];

  const coords = source.map(normalizeCoord).filter(Boolean);
  if (coords.length < 3) return [];

  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first.latitude !== last.latitude || first.longitude !== last.longitude) {
    coords.push({ ...first });
  }

  return coords;
}

function geometrySignature(geometry) {
  const normalized = normalizeGeometry(geometry);
  if (!normalized?.coordinates) return null;
  try {
    return JSON.stringify(normalized.coordinates).replace(/-?\d+\.\d+/g, (match) =>
      Number(match).toFixed(5)
    );
  } catch {
    return null;
  }
}

function makeLegacyTerritoryId(zone = {}, signature = "") {
  const base = zone.id || signature || Date.now();
  return `territory_legacy_${String(base).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`;
}

export function buildTerritoryFromLegacyZone(zone = {}, options = {}) {
  const coords = normalizeZoneCoords(zone);
  if (coords.length < 4) {
    return { ok: false, reason: "invalid_coords", zone };
  }

  const ring = coords.map((point) => [point.longitude, point.latitude]);
  const geometry = normalizeGeometry({
    type: "Polygon",
    coordinates: [ring],
  });

  if (!geometry) {
    return { ok: false, reason: "invalid_geometry", zone };
  }

  const areaM2 = calculateGeometryAreaM2(geometry);
  if (!Number.isFinite(areaM2) || areaM2 < TERRITORY_CONFIG.minAreaM2) {
    return { ok: false, reason: "area_too_small", zone, areaM2 };
  }

  const ownerId = zone.userId || zone.ownerId || options.userId || auth?.currentUser?.uid || "offline";
  const capturedAt = toIsoString(zone.date || zone.createdAt || zone.updatedAt);
  const signature = geometrySignature(geometry);
  const id = zone.migratedToTerritoryId || makeLegacyTerritoryId(zone, signature);

  return {
    ok: true,
    territory: {
      id,
      ownerId,
      userId: ownerId,
      ownerName: zone.ownerName || zone.userName || options.userName || "Atleta Wayper",
      ownerAvatar: zone.ownerAvatar || zone.userAvatar || null,
      runId: zone.runId || null,
      geometry,
      areaM2,
      bbox: calculateGeometryBbox(geometry),
      center: calculateGeometryCenter(geometry),
      coordsPreview: geometryToPreviewCoords(geometry, TERRITORY_CONFIG.maxPoints),
      cellIds: getCellIdsForGeometry(geometry),
      status: TERRITORY_STATUS.active,
      source: TERRITORY_SOURCE.closed_loop,
      visibility: zone.visibility || "followers",
      capturedAt,
      updatedAt: toIsoString(zone.updatedAt || zone.date || zone.createdAt, capturedAt),
      version: 1,
      migratedFromZoneId: zone.id || null,
      migrationSignature: signature,
      pendingSync: true,
      synced: false,
    },
    signature,
  };
}

async function loadLocalLegacyZones(limitTo) {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_ZONES_KEY);
    const parsed = safeParse(raw, []);
    return (Array.isArray(parsed) ? parsed : []).slice(0, limitTo);
  } catch {
    return [];
  }
}

async function fetchRemoteLegacyZones(limitTo) {
  try {
    const firestore = await import("firebase/firestore");
    const firebase = await import("../../firebaseConfig.js");
    const snap = await firestore.getDocs(
      firestore.query(
        firestore.collection(firebase.db, "zones"),
        firestore.limit(limitTo)
      )
    );
    return (snap?.docs || []).map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  } catch {
    return [];
  }
}

function dedupeZones(zones = []) {
  const map = new Map();
  for (const zone of zones) {
    if (!zone) continue;
    const key = zone.id ? `id:${zone.id}` : `sig:${JSON.stringify(normalizeZoneCoords(zone)).slice(0, 200)}`;
    if (!map.has(key)) map.set(key, zone);
  }
  return Array.from(map.values());
}

async function scheduleMigrationSync() {
  try {
    const sync = await import("../../utils/sync.js");
    sync.scheduleTerritoriesSync?.();
  } catch {
    // Best effort only. Local migration must not depend on online sync.
  }
}

export async function migrateLegacyZonesToTerritories({
  dryRun = true,
  userId = null,
  limitTo = DEFAULT_LIMIT,
  includeRemote = true,
  legacyZones = null,
} = {}) {
  const limit = Math.max(1, Number(limitTo) || DEFAULT_LIMIT);
  const errors = [];
  const skippedDetails = [];
  const territoriesToSave = [];

  const localZones = Array.isArray(legacyZones) ? legacyZones : await loadLocalLegacyZones(limit);
  const remainingRemoteLimit = Math.max(0, limit - localZones.length);
  const remoteZones = includeRemote && remainingRemoteLimit > 0
    ? await fetchRemoteLegacyZones(remainingRemoteLimit)
    : [];
  const zones = dedupeZones([...localZones, ...remoteZones]).slice(0, limit);

  const existingTerritories = await loadLocalTerritories();
  const migratedZoneIds = new Set(
    existingTerritories
      .map((territory) => territory.migratedFromZoneId)
      .filter(Boolean)
      .map(String)
  );
  const migratedSignatures = new Set(
    existingTerritories
      .map((territory) => territory.migrationSignature)
      .filter(Boolean)
      .map(String)
  );

  for (const zone of zones) {
    try {
      if (zone?.migratedToTerritoryId) {
        skippedDetails.push({ zoneId: zone.id || null, reason: "already_marked_migrated" });
        continue;
      }

      if (zone?.id && migratedZoneIds.has(String(zone.id))) {
        skippedDetails.push({ zoneId: zone.id, reason: "already_migrated_zone_id" });
        continue;
      }

      const built = buildTerritoryFromLegacyZone(zone, { userId });
      if (!built.ok) {
        skippedDetails.push({ zoneId: zone?.id || null, reason: built.reason });
        continue;
      }

      if (built.signature && migratedSignatures.has(String(built.signature))) {
        skippedDetails.push({ zoneId: zone?.id || null, reason: "duplicate_geometry" });
        continue;
      }

      territoriesToSave.push(built.territory);
      if (zone?.id) migratedZoneIds.add(String(zone.id));
      if (built.signature) migratedSignatures.add(String(built.signature));
    } catch (error) {
      errors.push({
        zoneId: zone?.id || null,
        error: error?.message || String(error),
      });
    }
  }

  if (!dryRun && territoriesToSave.length > 0) {
    await saveLocalTerritories(territoriesToSave, {
      preserveTimestamps: true,
      preserveVersion: true,
    });
    await scheduleMigrationSync();
  }

  return {
    dryRun,
    scanned: zones.length,
    migrated: territoriesToSave.length,
    skipped: skippedDetails.length,
    errors,
    territories: territoriesToSave,
    skippedDetails,
  };
}

export default {
  buildTerritoryFromLegacyZone,
  migrateLegacyZonesToTerritories,
};
