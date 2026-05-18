import { calculateGeometryAreaM2 } from "./territoryGeometryService.js";
import { getCellIdsForGeometry } from "./territoryCellService.js";
import { TERRITORY_EVENT_TYPE } from "./territoryTypes.js";

function makeId(prefix = "territory_event") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePerson(person = {}, fallbackName = "Atleta Wayper") {
  if (!person) {
    return {
      id: null,
      name: fallbackName,
      avatar: null,
    };
  }

  return {
    id: person.id || person.uid || person.userId || null,
    name: person.name || person.displayName || person.userName || fallbackName,
    avatar: person.avatar || person.photoURL || person.userAvatar || null,
  };
}

function formatArea(areaM2) {
  return Math.max(0, Math.round(toFiniteNumber(areaM2, 0)));
}

export function generateTerritoryEventMessage(event = {}) {
  const actorName = event.actorName || event.actor?.name || "Atleta Wayper";
  const targetName = event.targetName || event.target?.name || "outro atleta";
  const area = formatArea(event.affectedAreaM2 ?? event.areaM2);

  switch (event.type) {
    case TERRITORY_EVENT_TYPE.capture:
      return `${actorName} conquistou ${area}m².`;
    case TERRITORY_EVENT_TYPE.steal:
      return `${actorName} retomou ${area}m² de ${targetName}.`;
    case TERRITORY_EVENT_TYPE.conquered:
      return `${actorName} assumiu uma área antes dominada por ${targetName}.`;
    case TERRITORY_EVENT_TYPE.merge:
      return `${actorName} expandiu seu território.`;
    case TERRITORY_EVENT_TYPE.split:
      return `Uma área de ${targetName} foi dividida após nova disputa.`;
    default:
      return `${actorName} atualizou um territorio.`;
  }
}

export function createTerritoryEvent({
  type,
  actor,
  target,
  runId,
  territoryId,
  affectedTerritoryId,
  affectedAreaM2,
  geometry,
  cellIds,
  visibility = "followers",
  createdAt = new Date().toISOString(),
} = {}) {
  const normalizedActor = normalizePerson(actor);
  const normalizedTarget = normalizePerson(target, "outro atleta");
  const areaM2 = toFiniteNumber(affectedAreaM2, calculateGeometryAreaM2(geometry));
  const event = {
    id: makeId(type || "territory_event"),
    type: type || TERRITORY_EVENT_TYPE.capture,
    actorId: normalizedActor.id,
    actorName: normalizedActor.name,
    actorAvatar: normalizedActor.avatar,
    targetId: normalizedTarget.id,
    targetName: normalizedTarget.name,
    targetAvatar: normalizedTarget.avatar,
    runId: runId || null,
    territoryId: territoryId || null,
    affectedTerritoryId: affectedTerritoryId || null,
    affectedAreaM2: areaM2,
    geometry: geometry || null,
    cellIds: Array.isArray(cellIds) && cellIds.length > 0
      ? Array.from(new Set(cellIds.filter(Boolean).map(String)))
      : getCellIdsForGeometry(geometry),
    visibility,
    version: 1,
    createdAt,
    updatedAt: createdAt,
    pendingSync: true,
    synced: false,
  };

  return {
    ...event,
    message: generateTerritoryEventMessage(event),
  };
}

export default {
  createTerritoryEvent,
  generateTerritoryEventMessage,
};
