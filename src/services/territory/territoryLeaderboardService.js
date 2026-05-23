import {
  calculateGeometryAreaM2,
  intersectGeometries,
} from "./territoryGeometryService.js";
import {
  getCellIdForLocation,
  getCellIdsForBbox,
  getCellIdsForGeometry,
  getCellPolygon,
} from "./territoryCellService.js";
import {
  fetchActiveTerritoriesNear,
  fetchTerritoryLeaderboardByCellId,
  loadLocalTerritoryLeaderboards,
  saveLocalTerritoryLeaderboards,
  saveTerritoryLeaderboardRemote,
} from "./territoryStorageService.js";
import { TERRITORY_STATUS } from "./territoryTypes.js";

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getOwnerId(territory = {}) {
  return territory.ownerId || territory.userId || territory.uid || null;
}

function getOwnerName(territory = {}) {
  return territory.ownerName || territory.userName || territory.name || "Atleta Wayper";
}

function getOwnerAvatar(territory = {}) {
  return territory.ownerAvatar || territory.userAvatar || territory.avatar || null;
}

function getTerritoryCellIds(territory = {}) {
  if (Array.isArray(territory.cellIds) && territory.cellIds.length > 0) {
    return territory.cellIds.filter(Boolean).map(String);
  }
  return getCellIdsForGeometry(territory.geometry);
}

function getTerritoryAreaForCell(territory = {}, cellId) {
  const cellPolygon = getCellPolygon(cellId);
  const intersection = cellPolygon && territory.geometry
    ? intersectGeometries(territory.geometry, cellPolygon)
    : null;
  if (intersection?.ok && intersection.areaM2 > 0) return intersection.areaM2;

  return toFiniteNumber(territory.areaM2 ?? territory.area, calculateGeometryAreaM2(territory.geometry));
}

function getLastCaptureAt(territory = {}) {
  return territory.capturedAt || territory.updatedAt || territory.createdAt || null;
}

function chooseLeader(users = {}, previousLeaderUserId = null) {
  const standings = Object.values(users).sort((a, b) => {
    if (b.areaM2 !== a.areaM2) return b.areaM2 - a.areaM2;
    if (previousLeaderUserId && a.userId === previousLeaderUserId) return -1;
    if (previousLeaderUserId && b.userId === previousLeaderUserId) return 1;
    return String(a.userId).localeCompare(String(b.userId));
  });

  return standings[0] || null;
}

function normalizeCellIds(cellIds = []) {
  return Array.from(new Set((Array.isArray(cellIds) ? cellIds : []).filter(Boolean).map(String)));
}

function getPreviousLeaderboard(cellId, previous = {}) {
  if (Array.isArray(previous)) {
    return previous.find((leaderboard) => leaderboard?.cellId === cellId) || null;
  }
  return previous?.[cellId] || null;
}

function buildLeaderboardForCell(cellId, territories = [], previous = null, now = new Date().toISOString()) {
  const users = {};

  for (const territory of territories) {
    if (!territory || territory.status !== TERRITORY_STATUS.active) continue;
    const ownerId = getOwnerId(territory);
    if (!ownerId) continue;
    if (!getTerritoryCellIds(territory).includes(cellId)) continue;

    const areaM2 = Math.max(0, getTerritoryAreaForCell(territory, cellId));
    if (areaM2 <= 0) continue;

    const current = users[ownerId] || {
      userId: ownerId,
      userName: getOwnerName(territory),
      avatar: getOwnerAvatar(territory),
      areaM2: 0,
      territoryCount: 0,
      lastCaptureAt: null,
    };

    current.areaM2 += areaM2;
    current.territoryCount += 1;
    const capturedAt = getLastCaptureAt(territory);
    if (!current.lastCaptureAt || (capturedAt && capturedAt > current.lastCaptureAt)) {
      current.lastCaptureAt = capturedAt;
    }
    users[ownerId] = current;
  }

  const leader = chooseLeader(users, previous?.leaderUserId);
  const totalAreaM2 = Object.values(users).reduce((sum, user) => sum + user.areaM2, 0);

  return {
    cellId,
    leaderUserId: leader?.userId || null,
    leaderUserName: leader?.userName || null,
    leaderAvatar: leader?.avatar || null,
    leaderAreaM2: leader?.areaM2 || 0,
    totalAreaM2,
    users,
    updatedAt: now,
  };
}

async function loadPreviousLeaderboards(cellIds, options = {}) {
  if (options.previousLeaderboards) return options.previousLeaderboards;
  const local = await loadLocalTerritoryLeaderboards();
  return local.filter((leaderboard) => cellIds.includes(leaderboard.cellId));
}

export async function recalculateLeaderboardsForCells(cellIds = [], options = {}) {
  const ids = normalizeCellIds(cellIds);
  const now = options.updatedAt || options.now || new Date().toISOString();
  if (ids.length === 0) {
    return {
      ok: true,
      updates: [],
      leaderChanges: [],
      leaderboards: [],
    };
  }

  const territories = Array.isArray(options.territories)
    ? options.territories
    : await fetchActiveTerritoriesNear({ cellIds: ids, limitTo: options.limitTo || 500 });
  const previousLeaderboards = await loadPreviousLeaderboards(ids, options);
  const leaderboards = ids.map((cellId) =>
    buildLeaderboardForCell(
      cellId,
      territories,
      getPreviousLeaderboard(cellId, previousLeaderboards),
      now
    )
  );

  const updates = leaderboards.map((leaderboard) => {
    const previous = getPreviousLeaderboard(leaderboard.cellId, previousLeaderboards);
    const previousLeaderUserId = previous?.leaderUserId || null;
    const changed = previousLeaderUserId !== leaderboard.leaderUserId;
    return {
      cellId: leaderboard.cellId,
      previousLeaderUserId,
      previousLeaderUserName: previous?.leaderUserName || null,
      leaderUserId: leaderboard.leaderUserId,
      leaderUserName: leaderboard.leaderUserName,
      leaderAvatar: leaderboard.leaderAvatar,
      leaderAreaM2: leaderboard.leaderAreaM2,
      totalAreaM2: leaderboard.totalAreaM2,
      changed,
      leaderboard,
    };
  });

  if (options.persist !== false) {
    await saveLocalTerritoryLeaderboards(leaderboards);
    if (options.persistRemote !== false) {
      await Promise.all(leaderboards.map((leaderboard) => saveTerritoryLeaderboardRemote(leaderboard)));
    }
  }

  return {
    ok: true,
    updates,
    leaderChanges: updates.filter((update) => update.changed),
    leaderboards,
  };
}

export async function getLeaderboardForCell(cellId) {
  const id = String(cellId || "");
  if (!id) return null;

  const local = await loadLocalTerritoryLeaderboards();
  const localMatch = local.find((leaderboard) => leaderboard.cellId === id);
  if (localMatch) return localMatch;

  return fetchTerritoryLeaderboardByCellId(id);
}

export async function getLeaderForLocation(location) {
  const cellId = getCellIdForLocation(location);
  if (!cellId) return null;

  const leaderboard = await getLeaderboardForCell(cellId);
  return leaderboard?.leaderUserId
    ? {
        cellId,
        userId: leaderboard.leaderUserId,
        userName: leaderboard.leaderUserName,
        avatar: leaderboard.leaderAvatar,
        areaM2: leaderboard.leaderAreaM2,
      }
    : null;
}

export async function getLeaderCellsForViewport({ bbox, cellIds } = {}) {
  const ids = normalizeCellIds(
    Array.isArray(cellIds) && cellIds.length > 0
      ? cellIds
      : getCellIdsForBbox(bbox)
  );
  const leaderboards = await Promise.all(ids.map((cellId) => getLeaderboardForCell(cellId)));
  return leaderboards.filter(Boolean);
}

export async function getUserLocalStanding({ userId, cellId } = {}) {
  const leaderboard = await getLeaderboardForCell(cellId);
  if (!leaderboard || !userId) return null;

  const standings = Object.values(leaderboard.users || {})
    .sort((a, b) => b.areaM2 - a.areaM2);
  const index = standings.findIndex((user) => user.userId === userId);
  const user = index >= 0 ? standings[index] : {
    userId,
    areaM2: 0,
    territoryCount: 0,
  };

  return {
    cellId: leaderboard.cellId,
    userId,
    rank: index >= 0 ? index + 1 : standings.length + 1,
    areaM2: user.areaM2,
    territoryCount: user.territoryCount,
    leaderUserId: leaderboard.leaderUserId,
    leaderAreaM2: leaderboard.leaderAreaM2,
  };
}

export async function getAreaNeededToLead({ userId, cellId } = {}) {
  const standing = await getUserLocalStanding({ userId, cellId });
  if (!standing) return 0;
  if (!standing.leaderUserId || standing.leaderUserId === userId) return 0;
  return Math.max(0, standing.leaderAreaM2 - standing.areaM2 + 1);
}

export default {
  recalculateLeaderboardsForCells,
  getLeaderboardForCell,
  getLeaderForLocation,
  getLeaderCellsForViewport,
  getUserLocalStanding,
  getAreaNeededToLead,
};
