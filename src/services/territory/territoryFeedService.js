import {
  collection,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "../../firebaseConfig.js";
import { loadLocalTerritoryEvents } from "./territoryStorageService.js";
import { generateTerritoryEventMessage } from "./territoryEventsService.js";
import { TERRITORY_EVENT_TYPE } from "./territoryTypes.js";

const TERRITORY_EVENTS_COLLECTION = "territory_events";
const DEFAULT_LIMIT = 80;

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toDateValue = (value) => {
  try {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value?.toDate === "function") return value.toDate();
    if (Number.isFinite(Number(value?.seconds))) return new Date(Number(value.seconds) * 1000);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
};

const isoDate = (value) => (toDateValue(value) || new Date(0)).toISOString();

const normalizeCoords = (coords = []) => {
  if (!Array.isArray(coords)) return [];
  return coords
    .map((point) => {
      if (!point) return null;
      if (Array.isArray(point)) {
        const lng = Number(point[0]);
        const lat = Number(point[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { latitude: lat, longitude: lng };
        return null;
      }
      const latitude = Number(point.latitude ?? point.lat);
      const longitude = Number(point.longitude ?? point.lng ?? point.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude };
    })
    .filter(Boolean);
};

function previewCoordsFromGeometry(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return normalizeCoords(geometry.coordinates?.[0] || []);
  }
  if (geometry.type === "MultiPolygon") {
    return normalizeCoords(geometry.coordinates?.[0]?.[0] || []);
  }
  return [];
}

function getRunZoneCoords(run = {}) {
  return normalizeCoords(run.zoneCoords || run.zone?.coords || []);
}

function getZoneCoords(zone = {}) {
  return normalizeCoords(zone.coords || zone.zoneCoords || []);
}

function eventTypeToFeedType(type) {
  switch (type) {
    case TERRITORY_EVENT_TYPE.capture:
      return "territory_capture";
    case TERRITORY_EVENT_TYPE.steal:
      return "territory_steal";
    case TERRITORY_EVENT_TYPE.conquered:
      return "territory_conquered";
    case TERRITORY_EVENT_TYPE.leader_changed:
    case TERRITORY_EVENT_TYPE.lost_lead:
    case TERRITORY_EVENT_TYPE.regained_lead:
      return "territory_leader_changed";
    default:
      return `territory_${type || "event"}`;
  }
}

function friendlyTitleForEvent(event = {}) {
  const actorName = event.actorName || event.actor?.name || "Atleta Wayper";
  const targetName = event.targetName || event.target?.name || "outro atleta";
  const area = Math.round(toNumber(event.affectedAreaM2 ?? event.areaM2));

  switch (event.type) {
    case TERRITORY_EVENT_TYPE.capture:
      return `${actorName} conquistou ${area}m2`;
    case TERRITORY_EVENT_TYPE.steal:
      return `${actorName} retomou ${area}m2 de ${targetName}`;
    case TERRITORY_EVENT_TYPE.conquered:
      return `${actorName} conquistou uma area disputada`;
    case TERRITORY_EVENT_TYPE.leader_changed:
      return `${actorName} assumiu lideranca nesta regiao`;
    case TERRITORY_EVENT_TYPE.regained_lead:
      return `${actorName} retomou a lideranca nesta regiao`;
    case TERRITORY_EVENT_TYPE.lost_lead:
      return `${targetName} perdeu a lideranca nesta regiao`;
    default:
      return generateTerritoryEventMessage(event).replace(/\.$/, "");
  }
}

function friendlySubtitleForEvent(event = {}) {
  const date = toDateValue(event.createdAt || event.updatedAt);
  const dateText = date ? date.toLocaleString() : "Agora";
  const cellId = Array.isArray(event.cellIds) && event.cellIds.length > 0 ? event.cellIds[0] : null;
  if (event.type === TERRITORY_EVENT_TYPE.leader_changed && cellId) return `Regiao ${cellId} - ${dateText}`;
  if (event.targetName && event.type === TERRITORY_EVENT_TYPE.steal) return `Disputa com ${event.targetName} - ${dateText}`;
  return dateText;
}

export function normalizeTerritoryEventForFeed(event = {}) {
  if (!event?.id && !event?.type) return null;
  const geometry = event.geometry || null;
  const coordsPreview = normalizeCoords(event.coordsPreview || event.previewCoords || []);
  const preview = coordsPreview.length > 0 ? coordsPreview : previewCoordsFromGeometry(geometry);
  const createdAt = event.createdAt || event.updatedAt || event.timestamp || new Date().toISOString();

  return {
    id: String(event.id || `${event.type}_${event.territoryId || event.createdAt || Date.now()}`),
    __type: eventTypeToFeedType(event.type),
    title: event.title || event.message || friendlyTitleForEvent(event),
    subtitle: event.subtitle || friendlySubtitleForEvent(event),
    userId: event.actorId || event.userId || event.ownerId || null,
    userName: event.actorName || event.userName || event.ownerName || "Atleta Wayper",
    userAvatar: event.actorAvatar || event.userAvatar || event.ownerAvatar || null,
    targetUserId: event.targetId || null,
    targetUserName: event.targetName || null,
    date: isoDate(createdAt),
    areaM2: toNumber(event.affectedAreaM2 ?? event.areaM2),
    distance: 0,
    duration: 0,
    geometry,
    coordsPreview: preview,
    visibility: event.visibility || "followers",
    eventType: event.type || null,
    territoryId: event.territoryId || null,
    affectedTerritoryId: event.affectedTerritoryId || null,
    cellIds: Array.isArray(event.cellIds) ? event.cellIds.filter(Boolean).map(String) : [],
    raw: event,
  };
}

export function normalizeRunForFeed(run = {}) {
  const zoneCoords = getRunZoneCoords(run);
  const areaM2 = toNumber(run.areaM2 ?? run.area);
  const isZoneRun = run.mode === "zones" || areaM2 > 0 || zoneCoords.length >= 3 || !!run.zoneId;
  const date = run.date || run.createdAt || run.updatedAt || new Date().toISOString();
  return {
    id: String(run.id || `run_${date}`),
    __type: "run",
    title: run.name || (isZoneRun ? "Captura por zonas" : "Corrida"),
    subtitle: isZoneRun ? "Corrida por zonas" : "Corrida livre",
    userId: run.userId || run.ownerId || auth?.currentUser?.uid || null,
    userName: run.userName || run.ownerName || "Voce",
    date: isoDate(date),
    areaM2,
    distance: toNumber(run.distance ?? run.distanceMeters ?? run.totalMeters),
    duration: toNumber(run.duration ?? run.durationSeconds),
    geometry: run.geometry || null,
    coordsPreview: zoneCoords,
    path: normalizeCoords(run.path || run.coords || []),
    visibility: run.visibility || "followers",
    eventType: null,
    zoneId: run.zoneId || null,
    raw: run,
  };
}

export function normalizeZoneForFeed(zone = {}) {
  const coords = getZoneCoords(zone);
  const date = zone.date || zone.createdAt || zone.updatedAt || new Date().toISOString();
  return {
    id: String(zone.id || `zone_${date}`),
    __type: "zone",
    title: `Zona - ${Math.round(toNumber(zone.areaM2 ?? zone.area))}m2`,
    subtitle: "Zona legada",
    userId: zone.userId || zone.ownerId || auth?.currentUser?.uid || null,
    userName: zone.userName || zone.ownerName || "Voce",
    date: isoDate(date),
    areaM2: toNumber(zone.areaM2 ?? zone.area),
    distance: 0,
    duration: 0,
    geometry: zone.geometry || null,
    coordsPreview: coords,
    visibility: zone.visibility || "followers",
    eventType: null,
    raw: zone,
  };
}

export function filterTerritoryEventsByPrivacy(events = [], currentUserId = null, friendsList = []) {
  const uid = currentUserId ? String(currentUserId) : null;
  const friends = new Set((Array.isArray(friendsList) ? friendsList : []).map(String));

  return (Array.isArray(events) ? events : []).filter((event) => {
    const ownerId = String(event.actorId || event.userId || event.ownerId || "");
    const visibility = event.visibility || "followers";
    const isOwner = uid && ownerId === uid;

    if (visibility === "private") return Boolean(isOwner);
    if (visibility === "public") return true;
    if (visibility === "followers") {
      // TODO: conectar followers/seguidores quando a relacao social estiver pronta.
      return Boolean(isOwner || (ownerId && friends.has(ownerId)));
    }
    return Boolean(isOwner || visibility === "public");
  });
}

export async function loadLocalTerritoryFeed(options = {}) {
  const currentUserId = options.currentUserId ?? auth?.currentUser?.uid ?? null;
  const events = await loadLocalTerritoryEvents();
  return filterTerritoryEventsByPrivacy(events, currentUserId, options.friendsList)
    .map(normalizeTerritoryEventForFeed)
    .filter(Boolean)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

export async function fetchTerritoryFeed({ scope = "public", userId, limitTo = DEFAULT_LIMIT } = {}) {
  try {
    const currentUserId = userId ?? auth?.currentUser?.uid ?? null;
    const constraints = [orderBy("createdAt", "desc"), firestoreLimit(limitTo)];

    if (scope === "mine" && currentUserId) {
      constraints.unshift(where("actorId", "==", currentUserId));
    } else if (scope === "public" || scope === "nearby") {
      constraints.unshift(where("visibility", "==", "public"));
    } else if (scope === "friends") {
      constraints.unshift(where("visibility", "in", ["public", "followers"]));
    }

    const snap = await getDocs(query(collection(db, TERRITORY_EVENTS_COLLECTION), ...constraints));
    const events = [];
    snap?.forEach?.((docSnap) => events.push({ id: docSnap.id, ...docSnap.data() }));
    return filterTerritoryEventsByPrivacy(events, currentUserId)
      .map(normalizeTerritoryEventForFeed)
      .filter(Boolean);
  } catch (error) {
    console.warn("fetchTerritoryFeed error:", error);
    return [];
  }
}

function isSameCaptureWindow(run = {}, zone = {}) {
  const runDate = new Date(run.date || 0).getTime();
  const zoneDate = new Date(zone.date || 0).getTime();
  if (!Number.isFinite(runDate) || !Number.isFinite(zoneDate)) return false;
  return Math.round(toNumber(run.areaM2)) === Math.round(toNumber(zone.areaM2)) &&
    Math.abs(runDate - zoneDate) <= 60 * 1000;
}

export function mergeRunsZonesAndTerritoryEvents({ runs = [], zones = [], events = [] } = {}) {
  const runItems = (Array.isArray(runs) ? runs : []).map(normalizeRunForFeed).filter(Boolean);
  const zoneRuns = runItems.filter((item) => item.areaM2 > 0 || item.coordsPreview.length >= 3 || item.raw?.mode === "zones");
  const linkedZoneIds = new Set(zoneRuns.map((item) => item.zoneId).filter(Boolean));

  const zoneItems = (Array.isArray(zones) ? zones : [])
    .map(normalizeZoneForFeed)
    .filter((zone) => {
      if (linkedZoneIds.has(zone.id)) return false;
      return !zoneRuns.some((run) => isSameCaptureWindow(run, zone));
    });

  const eventItems = (Array.isArray(events) ? events : [])
    .map((event) => event?.__type ? event : normalizeTerritoryEventForFeed(event))
    .filter(Boolean);

  const map = new Map();
  [...runItems, ...zoneItems, ...eventItems].forEach((item) => {
    map.set(`${item.__type}:${item.id}`, item);
  });

  return Array.from(map.values()).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function isZoneFeedItem(item = {}) {
  return item.__type === "zone" ||
    (item.__type === "run" && (
      toNumber(item.areaM2) > 0 ||
      (Array.isArray(item.coordsPreview) && item.coordsPreview.length >= 3) ||
      item.raw?.mode === "zones"
    ));
}

export function filterCompetitiveFeedItems(items = [], filter = "all") {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];

  switch (filter) {
    case "free":
      return list.filter((item) => item.__type === "run" && !isZoneFeedItem(item));
    case "captures":
      return list.filter((item) => (
        item.__type === "territory_capture" ||
        item.__type === "territory_conquered" ||
        isZoneFeedItem(item)
      ));
    case "steals":
      return list.filter((item) => item.__type === "territory_steal");
    case "leaders":
      return list.filter((item) => item.__type === "territory_leader_changed");
    default:
      return list;
  }
}

export function buildTerritoryMapParams(item = {}) {
  return {
    focusTerritoryId: item.territoryId || item.raw?.territoryId || item.affectedTerritoryId || null,
    focusCellId: item.cellIds?.[0] || item.raw?.cellIds?.[0] || null,
    focusUserId: item.userId || item.raw?.actorId || null,
  };
}

export default {
  buildTerritoryMapParams,
  fetchTerritoryFeed,
  filterCompetitiveFeedItems,
  filterTerritoryEventsByPrivacy,
  loadLocalTerritoryFeed,
  mergeRunsZonesAndTerritoryEvents,
  normalizeRunForFeed,
  normalizeTerritoryEventForFeed,
  normalizeZoneForFeed,
};
