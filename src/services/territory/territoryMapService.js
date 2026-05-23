import { getCellPolygon } from "./territoryCellService.js";
import { calculateGeometryAreaM2, normalizeGeometry } from "./territoryGeometryService.js";

export const WAYPER_CURRENT_USER_COLOR = "#00e676";

const OWNER_COLORS = [
  "#38d9ff",
  "#ffd166",
  "#f78fb3",
  "#a29bfe",
  "#55efc4",
  "#ff9f43",
  "#74b9ff",
  "#b8e994",
  "#f6b93b",
  "#82ccdd",
];

function hashString(value = "") {
  const text = String(value || "unknown");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getOwnerId(input = {}) {
  return input.ownerId || input.userId || input.leaderUserId || input.uid || null;
}

function getOwnerName(input = {}) {
  return input.ownerName || input.userName || input.leaderUserName || input.leaderName || input.name || "Atleta Wayper";
}

function getOwnerAvatar(input = {}) {
  return input.ownerAvatar || input.userAvatar || input.leaderAvatar || input.avatar || null;
}

export function getOwnerColor(ownerId, options = {}) {
  const currentUserId = options.currentUserId || null;
  if (ownerId && currentUserId && String(ownerId) === String(currentUserId)) {
    return WAYPER_CURRENT_USER_COLOR;
  }

  if (options.color) return options.color;
  if (!ownerId) return "#9aa6ad";

  return OWNER_COLORS[hashString(ownerId) % OWNER_COLORS.length];
}

export function buildTerritoryMapProps(territory = {}, currentUserId = null) {
  const ownerId = getOwnerId(territory);
  const leaderUserId = territory.leaderUserId || territory.localLeaderUserId || null;
  const isMine = Boolean(ownerId && currentUserId && String(ownerId) === String(currentUserId));
  const isLeaderTerritory = Boolean(
    territory.isLeaderTerritory ||
      territory.isLeader ||
      (leaderUserId && ownerId && String(leaderUserId) === String(ownerId))
  );

  return {
    id: territory.id || null,
    ownerId,
    ownerName: getOwnerName(territory),
    ownerAvatar: getOwnerAvatar(territory),
    areaM2: toFiniteNumber(territory.areaM2 ?? territory.area, calculateGeometryAreaM2(territory.geometry)),
    color: getOwnerColor(ownerId, { currentUserId, color: territory.color }),
    isMine,
    isLeaderTerritory,
    leaderUserId,
    leaderName: territory.leaderName || territory.leaderUserName || null,
    status: territory.status || "active",
    visibility: territory.visibility || "followers",
  };
}

export function normalizeTerritoryForMap(territory = {}, currentUserId = null) {
  const geometry = normalizeGeometry(territory.geometry);
  if (!geometry) return null;

  return {
    type: "Feature",
    properties: buildTerritoryMapProps(territory, currentUserId),
    geometry,
  };
}

export function territoriesToFeatureCollection(territories = [], currentUserId = null) {
  return {
    type: "FeatureCollection",
    features: (Array.isArray(territories) ? territories : [])
      .map((territory) => normalizeTerritoryForMap(territory, currentUserId))
      .filter(Boolean),
  };
}

function buildLeaderCellProps(cell = {}, currentUserId = null) {
  const leaderUserId = cell.leaderUserId || cell.ownerId || cell.userId || null;
  const isMine = Boolean(leaderUserId && currentUserId && String(leaderUserId) === String(currentUserId));

  return {
    id: cell.cellId || cell.id || null,
    cellId: cell.cellId || cell.id || null,
    ownerId: leaderUserId,
    ownerName: cell.leaderUserName || cell.leaderName || cell.ownerName || "Sem lider",
    ownerAvatar: cell.leaderAvatar || cell.ownerAvatar || null,
    areaM2: toFiniteNumber(cell.leaderAreaM2 ?? cell.areaM2, 0),
    color: getOwnerColor(leaderUserId, { currentUserId, color: cell.color }),
    isMine,
    isLeaderTerritory: true,
    leaderUserId,
    leaderName: cell.leaderUserName || cell.leaderName || null,
    status: cell.status || "active",
    visibility: cell.visibility || "public",
    totalAreaM2: toFiniteNumber(cell.totalAreaM2, 0),
  };
}

export function leaderCellsToFeatureCollection(leaderCells = [], currentUserId = null) {
  const features = (Array.isArray(leaderCells) ? leaderCells : [])
    .map((cell) => {
      const geometry = normalizeGeometry(cell.geometry || getCellPolygon(cell.cellId || cell.id));
      if (!geometry) return null;

      return {
        type: "Feature",
        properties: buildLeaderCellProps(cell, currentUserId),
        geometry,
      };
    })
    .filter(Boolean);

  return {
    type: "FeatureCollection",
    features,
  };
}

export default {
  WAYPER_CURRENT_USER_COLOR,
  getOwnerColor,
  territoriesToFeatureCollection,
  leaderCellsToFeatureCollection,
  normalizeTerritoryForMap,
  buildTerritoryMapProps,
};

