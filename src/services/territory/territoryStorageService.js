import AsyncStorage from "@react-native-async-storage/async-storage";
import { calculateGeometryBbox, calculateGeometryCenter, normalizeGeometry } from "./territoryGeometryService.js";
import { getCellIdsForBbox, getCellIdsForGeometry } from "./territoryCellService.js";
import {
  TERRITORY_EVENT_TYPE,
  TERRITORY_STATUS,
} from "./territoryTypes.js";

export const TERRITORIES_STORAGE_KEY = "wayper_territories_v1";
export const TERRITORY_EVENTS_STORAGE_KEY = "wayper_territory_events_v1";
export const TERRITORY_SYNC_META_STORAGE_KEY = "wayper_territory_sync_meta_v1";

const TERRITORIES_COLLECTION = "territories";
const TERRITORY_EVENTS_COLLECTION = "territory_events";
const FIRESTORE_IN_CHUNK_SIZE = 10;

let firestoreBindings = null;

function uid(prefix = "territory") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function safeParse(raw, fallback = []) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[]";
  }
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIsoString(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      return fallback;
    }
  }
  if (Number.isFinite(Number(value?.seconds))) {
    return new Date(Number(value.seconds) * 1000).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function compareByUpdatedAt(a, b) {
  const aTime = new Date(a?.updatedAt || a?.capturedAt || a?.createdAt || 0).getTime();
  const bTime = new Date(b?.updatedAt || b?.capturedAt || b?.createdAt || 0).getTime();
  return bTime - aTime;
}

function dedupeById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item?.id) continue;
    const existing = map.get(item.id);
    if (!existing || compareByUpdatedAt(item, existing) <= 0) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values()).sort(compareByUpdatedAt);
}

function normalizeBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const values = bbox.slice(0, 4).map(toFiniteNumber);
  if (values.some((value) => value == null)) return null;
  return [
    Math.min(values[0], values[2]),
    Math.min(values[1], values[3]),
    Math.max(values[0], values[2]),
    Math.max(values[1], values[3]),
  ];
}

function intersectsBbox(territory, bbox) {
  const target = normalizeBbox(bbox);
  if (!target) return true;

  const source = normalizeBbox(territory?.bbox) || calculateGeometryBbox(territory?.geometry);
  if (!source) return false;

  return !(
    source[2] < target[0] ||
    source[0] > target[2] ||
    source[3] < target[1] ||
    source[1] > target[3]
  );
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function getFirestoreBindings() {
  if (firestoreBindings) return firestoreBindings;

  const firestore = await import("firebase/firestore");
  const firebaseConfig = await import("../../firebaseConfig.js");

  firestoreBindings = {
    db: firebaseConfig.db,
    auth: firebaseConfig.auth,
    collection: firestore.collection,
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    getDocs: firestore.getDocs,
    limit: firestore.limit,
    query: firestore.query,
    setDoc: firestore.setDoc,
    updateDoc: firestore.updateDoc,
    where: firestore.where,
  };

  return firestoreBindings;
}

export function normalizeTerritoryPayload(territory = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const existing = options.existing || null;
  const fromRemote = Boolean(options.fromRemote);
  const preserveVersion = Boolean(options.preserveVersion);
  const preserveTimestamps = Boolean(options.preserveTimestamps);
  const geometry = normalizeGeometry(territory.geometry);
  const bbox = normalizeBbox(territory.bbox) || calculateGeometryBbox(geometry);
  const center = territory.center || calculateGeometryCenter(geometry);
  const cellIds = Array.isArray(territory.cellIds) && territory.cellIds.length > 0
    ? Array.from(new Set(territory.cellIds.filter(Boolean).map(String)))
    : getCellIdsForGeometry(geometry);

  let version = Number(territory.version);
  if (!Number.isFinite(version) || version <= 0) version = 1;
  if (existing && !fromRemote && !preserveVersion) {
    version = Math.max(Number(existing.version || 1) + 1, version);
  }

  const status = territory.status || existing?.status || TERRITORY_STATUS.active;
  const capturedAt = toIsoString(territory.capturedAt || territory.createdAt || existing?.capturedAt, now);
  const updatedAt = preserveTimestamps
    ? toIsoString(territory.updatedAt || existing?.updatedAt || territory.capturedAt || existing?.capturedAt, capturedAt)
    : fromRemote
      ? toIsoString(territory.updatedAt || territory.capturedAt || territory.createdAt, capturedAt)
      : now;

  return {
    ...existing,
    ...territory,
    id: String(territory.id || existing?.id || uid("territory")),
    version,
    status,
    geometry,
    bbox,
    center,
    cellIds,
    capturedAt,
    updatedAt,
    ownerId: territory.ownerId || territory.userId || existing?.ownerId || null,
    userId: territory.userId || territory.ownerId || existing?.userId || null,
    areaM2: toFiniteNumber(territory.areaM2 ?? territory.area) ?? toFiniteNumber(existing?.areaM2) ?? 0,
    pendingSync: fromRemote
      ? false
      : territory.pendingSync ?? existing?.pendingSync ?? true,
    synced: fromRemote ? true : territory.synced ?? existing?.synced ?? false,
    syncConflict: Boolean(territory.syncConflict ?? existing?.syncConflict ?? false),
  };
}

export function normalizeTerritoryEventPayload(event = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const existing = options.existing || null;
  const fromRemote = Boolean(options.fromRemote);
  const preserveVersion = Boolean(options.preserveVersion);
  const preserveTimestamps = Boolean(options.preserveTimestamps);

  let version = Number(event.version);
  if (!Number.isFinite(version) || version <= 0) version = 1;
  if (existing && !fromRemote && !preserveVersion) {
    version = Math.max(Number(existing.version || 1) + 1, version);
  }

  const createdAt = toIsoString(event.createdAt || event.timestamp || existing?.createdAt, now);
  const updatedAt = preserveTimestamps
    ? toIsoString(event.updatedAt || existing?.updatedAt || event.createdAt || existing?.createdAt, createdAt)
    : fromRemote
      ? toIsoString(event.updatedAt || event.createdAt || event.timestamp, createdAt)
      : now;

  return {
    ...existing,
    ...event,
    id: String(event.id || existing?.id || uid("territory_event")),
    type: event.type || existing?.type || TERRITORY_EVENT_TYPE.capture,
    territoryId: event.territoryId || existing?.territoryId || null,
    version,
    createdAt,
    updatedAt,
    pendingSync: fromRemote
      ? false
      : event.pendingSync ?? existing?.pendingSync ?? true,
    synced: fromRemote ? true : event.synced ?? existing?.synced ?? false,
    syncConflict: Boolean(event.syncConflict ?? existing?.syncConflict ?? false),
  };
}

export function normalizeTerritoryForRemote(territory = {}) {
  const normalized = normalizeTerritoryPayload(territory, { preserveVersion: true });
  const {
    pendingSync,
    synced,
    syncConflict,
    remoteVersion,
    ...payload
  } = normalized;
  return payload;
}

export function normalizeTerritoryEventForRemote(event = {}) {
  const normalized = normalizeTerritoryEventPayload(event, { preserveVersion: true });
  const {
    pendingSync,
    synced,
    syncConflict,
    remoteVersion,
    ...payload
  } = normalized;
  return payload;
}

export async function loadLocalTerritories() {
  try {
    const raw = await AsyncStorage.getItem(TERRITORIES_STORAGE_KEY);
    const parsed = safeParse(raw, []);
    if (!Array.isArray(parsed)) return [];
    return dedupeById(
      parsed.map((territory) =>
        normalizeTerritoryPayload(territory, {
          fromRemote: Boolean(territory?.synced && !territory?.pendingSync),
          preserveTimestamps: true,
          preserveVersion: true,
        })
      )
    );
  } catch {
    return [];
  }
}

export async function saveLocalTerritories(territories = [], options = {}) {
  try {
    const existing = options.replace ? [] : await loadLocalTerritories();
    const existingById = new Map(existing.map((territory) => [territory.id, territory]));
    const incoming = Array.isArray(territories) ? territories : [];
    const normalized = incoming.map((territory) =>
      normalizeTerritoryPayload(territory, {
        ...options,
        existing: existingById.get(String(territory?.id || "")),
      })
    );
    const next = dedupeById([...existing, ...normalized]);
    await AsyncStorage.setItem(TERRITORIES_STORAGE_KEY, safeStringify(next));
    return next;
  } catch {
    return [];
  }
}

export async function saveLocalTerritory(territory = {}, options = {}) {
  try {
    const saved = await saveLocalTerritories([territory], options);
    return saved.find((item) => item.id === String(territory.id || "")) || saved[0] || null;
  } catch {
    return null;
  }
}

export async function removeLocalTerritory(territoryId, options = {}) {
  try {
    const id = String(territoryId || "");
    if (!id) return null;

    const existing = await loadLocalTerritories();
    const found = existing.find((territory) => territory.id === id);
    if (!found) return null;

    if (options.hardDelete) {
      const next = existing.filter((territory) => territory.id !== id);
      await AsyncStorage.setItem(TERRITORIES_STORAGE_KEY, safeStringify(next));
      return { ...found, removed: true };
    }

    return saveLocalTerritory(
      {
        ...found,
        status: TERRITORY_STATUS.deleted,
        deleted: true,
        deletedAt: options.deletedAt || new Date().toISOString(),
        pendingSync: true,
        synced: false,
      },
      { preserveVersion: false }
    );
  } catch {
    return null;
  }
}

export async function loadLocalTerritoryEvents() {
  try {
    const raw = await AsyncStorage.getItem(TERRITORY_EVENTS_STORAGE_KEY);
    const parsed = safeParse(raw, []);
    if (!Array.isArray(parsed)) return [];
    return dedupeById(
      parsed.map((event) =>
        normalizeTerritoryEventPayload(event, {
          fromRemote: Boolean(event?.synced && !event?.pendingSync),
          preserveTimestamps: true,
          preserveVersion: true,
        })
      )
    );
  } catch {
    return [];
  }
}

export async function saveLocalTerritoryEvents(events = [], options = {}) {
  try {
    const existing = options.replace ? [] : await loadLocalTerritoryEvents();
    const existingById = new Map(existing.map((event) => [event.id, event]));
    const incoming = Array.isArray(events) ? events : [];
    const normalized = incoming.map((event) =>
      normalizeTerritoryEventPayload(event, {
        ...options,
        existing: existingById.get(String(event?.id || "")),
      })
    );
    const next = dedupeById([...existing, ...normalized]);
    await AsyncStorage.setItem(TERRITORY_EVENTS_STORAGE_KEY, safeStringify(next));
    return next;
  } catch {
    return [];
  }
}

export async function saveLocalTerritoryEvent(event = {}, options = {}) {
  try {
    const saved = await saveLocalTerritoryEvents([event], options);
    return saved.find((item) => item.id === String(event.id || "")) || saved[0] || null;
  } catch {
    return null;
  }
}

export async function loadTerritorySyncMeta() {
  try {
    const raw = await AsyncStorage.getItem(TERRITORY_SYNC_META_STORAGE_KEY);
    const parsed = safeParse(raw, {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveTerritorySyncMeta(meta = {}) {
  try {
    const existing = await loadTerritorySyncMeta();
    const next = { ...existing, ...meta, updatedAt: new Date().toISOString() };
    await AsyncStorage.setItem(TERRITORY_SYNC_META_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return {};
  }
}

export async function fetchTerritoryById(id) {
  try {
    const { db, doc, getDoc } = await getFirestoreBindings();
    const territoryId = String(id || "");
    if (!territoryId) return null;

    const snap = await getDoc(doc(db, TERRITORIES_COLLECTION, territoryId));
    if (!snap?.exists?.()) return null;

    return normalizeTerritoryPayload(
      { id: snap.id || territoryId, ...snap.data() },
      { fromRemote: true, preserveVersion: true }
    );
  } catch {
    return null;
  }
}

export async function fetchTerritoriesByCellIds(cellIds = [], options = {}) {
  try {
    const ids = Array.from(new Set((Array.isArray(cellIds) ? cellIds : []).filter(Boolean).map(String)));
    if (ids.length === 0) return [];

    const {
      db,
      collection,
      getDocs,
      limit,
      query,
      where,
    } = await getFirestoreBindings();

    const limitTo = Number(options.limitTo);
    const normalized = [];

    for (const chunk of chunkArray(ids, FIRESTORE_IN_CHUNK_SIZE)) {
      const constraints = [where("cellIds", "array-contains-any", chunk)];
      if (options.status) constraints.push(where("status", "==", options.status));
      if (Number.isFinite(limitTo) && limitTo > 0) constraints.push(limit(limitTo));

      const snap = await getDocs(query(collection(db, TERRITORIES_COLLECTION), ...constraints));
      snap?.docs?.forEach((docSnap) => {
        normalized.push(
          normalizeTerritoryPayload(
            { id: docSnap.id, ...docSnap.data() },
            { fromRemote: true, preserveVersion: true }
          )
        );
      });

      if (Number.isFinite(limitTo) && limitTo > 0 && normalized.length >= limitTo) break;
    }

    const filtered = dedupeById(normalized).filter((territory) =>
      options.bbox ? intersectsBbox(territory, options.bbox) : true
    );

    return Number.isFinite(limitTo) && limitTo > 0 ? filtered.slice(0, limitTo) : filtered;
  } catch {
    return [];
  }
}

export async function fetchTerritoriesByBbox(bbox, options = {}) {
  const cellIds = getCellIdsForBbox(bbox, options.precision);
  if (cellIds.length === 0) return [];
  return fetchTerritoriesByCellIds(cellIds, { ...options, bbox });
}

export async function fetchActiveTerritoriesNear({ bbox, cellIds, limitTo, precision } = {}) {
  const ids = Array.isArray(cellIds) && cellIds.length > 0
    ? cellIds
    : getCellIdsForBbox(bbox, precision);

  if (ids.length === 0) return [];

  return fetchTerritoriesByCellIds(ids, {
    bbox,
    limitTo,
    status: TERRITORY_STATUS.active,
  });
}

export async function saveTerritoryRemote(territory = {}) {
  try {
    const { auth, db, doc, getDoc, setDoc } = await getFirestoreBindings();
    const payload = normalizeTerritoryForRemote({
      ...territory,
      ownerId: territory.ownerId || territory.userId || auth?.currentUser?.uid || "offline",
      userId: territory.userId || territory.ownerId || auth?.currentUser?.uid || "offline",
    });
    const ref = doc(db, TERRITORIES_COLLECTION, payload.id);
    const existingSnap = await getDoc(ref);

    if (existingSnap?.exists?.()) {
      const remote = normalizeTerritoryPayload(
        { id: existingSnap.id, ...existingSnap.data() },
        { fromRemote: true, preserveVersion: true }
      );
      if (Number(remote.version || 0) > Number(payload.version || 0)) {
        return {
          ok: false,
          reason: "sync_conflict",
          territory: {
            ...territory,
            syncConflict: true,
            pendingSync: true,
            remoteVersion: remote.version,
          },
          remote,
        };
      }
    }

    await setDoc(ref, payload, { merge: true });
    return {
      ok: true,
      territory: { ...payload, pendingSync: false, synced: true, syncConflict: false },
      reason: null,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "firestore_error",
      error,
    };
  }
}

export async function saveTerritoryEventRemote(event = {}) {
  try {
    const { db, doc, setDoc } = await getFirestoreBindings();
    const payload = normalizeTerritoryEventForRemote(event);
    await setDoc(doc(db, TERRITORY_EVENTS_COLLECTION, payload.id), payload, { merge: true });
    return {
      ok: true,
      event: { ...payload, pendingSync: false, synced: true, syncConflict: false },
      reason: null,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "firestore_error",
      error,
    };
  }
}

export async function updateTerritoryRemote(id, patch = {}) {
  try {
    const { db, doc, getDoc, setDoc, updateDoc } = await getFirestoreBindings();
    const territoryId = String(id || patch.id || "");
    if (!territoryId) return { ok: false, reason: "invalid_territory_id" };

    const ref = doc(db, TERRITORIES_COLLECTION, territoryId);
    const existingSnap = await getDoc(ref);
    const existing = existingSnap?.exists?.()
      ? normalizeTerritoryPayload(
          { id: existingSnap.id, ...existingSnap.data() },
          { fromRemote: true, preserveVersion: true }
        )
      : null;

    const patchVersion = toFiniteNumber(patch.version);
    if (existing && patchVersion != null && Number(existing.version || 0) > patchVersion) {
      return {
        ok: false,
        reason: "sync_conflict",
        territory: {
          ...patch,
          id: territoryId,
          syncConflict: true,
          pendingSync: true,
          remoteVersion: existing.version,
        },
        remote: existing,
      };
    }

    const payload = normalizeTerritoryForRemote({
      ...existing,
      ...patch,
      id: territoryId,
      version: patchVersion ?? (Number(existing?.version || 0) + 1 || 1),
    });
    if (existing) await updateDoc(ref, payload);
    else await setDoc(ref, payload, { merge: true });

    return {
      ok: true,
      territory: { ...payload, pendingSync: false, synced: true, syncConflict: false },
      reason: null,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "firestore_error",
      error,
    };
  }
}

export async function markTerritoryDeletedRemote(id, patch = {}) {
  return updateTerritoryRemote(id, {
    ...patch,
    id,
    status: TERRITORY_STATUS.deleted,
    deleted: true,
    deletedAt: patch.deletedAt || new Date().toISOString(),
  });
}

export default {
  TERRITORIES_STORAGE_KEY,
  TERRITORY_EVENTS_STORAGE_KEY,
  TERRITORY_SYNC_META_STORAGE_KEY,
  loadLocalTerritories,
  saveLocalTerritory,
  saveLocalTerritories,
  removeLocalTerritory,
  loadLocalTerritoryEvents,
  saveLocalTerritoryEvent,
  saveLocalTerritoryEvents,
  loadTerritorySyncMeta,
  saveTerritorySyncMeta,
  fetchTerritoryById,
  fetchTerritoriesByCellIds,
  fetchTerritoriesByBbox,
  fetchActiveTerritoriesNear,
  saveTerritoryRemote,
  saveTerritoryEventRemote,
  updateTerritoryRemote,
  markTerritoryDeletedRemote,
  normalizeTerritoryPayload,
  normalizeTerritoryEventPayload,
  normalizeTerritoryForRemote,
  normalizeTerritoryEventForRemote,
};
