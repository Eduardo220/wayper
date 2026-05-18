import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { calculateGeometryAreaM2 } from "../territoryGeometryService.js";
import { getCellIdForLocation, getCellIdsForGeometry } from "../territoryCellService.js";

let activeTerritories = [];
let localLeaderboards = [];

const fetchActiveTerritoriesNear = jest.fn(async () => activeTerritories);
const loadLocalTerritoryLeaderboards = jest.fn(async () => localLeaderboards);
const saveLocalTerritoryLeaderboards = jest.fn(async (leaderboards) => {
  localLeaderboards = leaderboards;
  return leaderboards;
});
const fetchTerritoryLeaderboardByCellId = jest.fn(async (cellId) =>
  localLeaderboards.find((leaderboard) => leaderboard.cellId === cellId) || null
);
const saveTerritoryLeaderboardRemote = jest.fn(async (leaderboard) => ({ ok: true, leaderboard }));

jest.unstable_mockModule("../territoryStorageService.js", () => ({
  fetchActiveTerritoriesNear,
  fetchTerritoryLeaderboardByCellId,
  loadLocalTerritoryLeaderboards,
  saveLocalTerritoryLeaderboards,
  saveTerritoryLeaderboardRemote,
}));

const {
  getAreaNeededToLead,
  getLeaderboardForCell,
  getUserLocalStanding,
  recalculateLeaderboardsForCells,
} = await import("../territoryLeaderboardService.js");

function polygonFromBbox([minLng, minLat, maxLng, maxLat]) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [minLng, minLat],
        [minLng, maxLat],
        [maxLng, maxLat],
        [maxLng, minLat],
        [minLng, minLat],
      ],
    ],
  };
}

function territory({ id, ownerId, ownerName, bbox }) {
  const geometry = polygonFromBbox(bbox);
  return {
    id,
    ownerId,
    ownerName,
    ownerAvatar: `${ownerId}.png`,
    status: "active",
    geometry,
    areaM2: calculateGeometryAreaM2(geometry),
    cellIds: getCellIdsForGeometry(geometry),
    capturedAt: "2026-05-18T10:00:00.000Z",
  };
}

describe("territoryLeaderboardService", () => {
  const cellId = getCellIdForLocation({ latitude: 0.001, longitude: 0.001 });

  beforeEach(() => {
    activeTerritories = [];
    localLeaderboards = [];
    jest.clearAllMocks();
  });

  test("calcula lider com maior area", async () => {
    const small = territory({
      id: "t1",
      ownerId: "user-1",
      ownerName: "Ana",
      bbox: [0.0005, 0.0005, 0.0015, 0.0015],
    });
    const large = territory({
      id: "t2",
      ownerId: "user-2",
      ownerName: "Bruno",
      bbox: [0.0005, 0.0005, 0.003, 0.003],
    });

    const result = await recalculateLeaderboardsForCells([cellId], {
      territories: [small, large],
      persist: false,
    });

    expect(result.leaderboards[0]).toMatchObject({
      leaderUserId: "user-2",
      leaderUserName: "Bruno",
    });
  });

  test("troca lider apos novo territorio", async () => {
    localLeaderboards = [{ cellId, leaderUserId: "user-2", leaderUserName: "Bruno" }];
    const large = territory({
      id: "t1",
      ownerId: "user-1",
      ownerName: "Ana",
      bbox: [0.0005, 0.0005, 0.003, 0.003],
    });

    const result = await recalculateLeaderboardsForCells([cellId], {
      territories: [large],
      persist: false,
    });

    expect(result.leaderChanges[0]).toMatchObject({
      previousLeaderUserId: "user-2",
      leaderUserId: "user-1",
    });
  });

  test("mantem lider se area insuficiente", async () => {
    localLeaderboards = [{ cellId, leaderUserId: "user-2", leaderUserName: "Bruno" }];
    const small = territory({
      id: "t1",
      ownerId: "user-1",
      ownerName: "Ana",
      bbox: [0.0005, 0.0005, 0.0015, 0.0015],
    });
    const large = territory({
      id: "t2",
      ownerId: "user-2",
      ownerName: "Bruno",
      bbox: [0.0005, 0.0005, 0.003, 0.003],
    });

    const result = await recalculateLeaderboardsForCells([cellId], {
      territories: [small, large],
      persist: false,
    });

    expect(result.leaderboards[0].leaderUserId).toBe("user-2");
    expect(result.leaderChanges).toHaveLength(0);
  });

  test("calcula totalAreaM2", async () => {
    const first = territory({
      id: "t1",
      ownerId: "user-1",
      ownerName: "Ana",
      bbox: [0.0005, 0.0005, 0.0015, 0.0015],
    });
    const second = territory({
      id: "t2",
      ownerId: "user-2",
      ownerName: "Bruno",
      bbox: [0.002, 0.002, 0.003, 0.003],
    });

    const result = await recalculateLeaderboardsForCells([cellId], {
      territories: [first, second],
      persist: false,
    });

    expect(result.leaderboards[0].totalAreaM2).toBeGreaterThan(0);
    expect(result.leaderboards[0].totalAreaM2).toBeCloseTo(
      result.leaderboards[0].users["user-1"].areaM2 + result.leaderboards[0].users["user-2"].areaM2
    );
  });

  test("calcula getAreaNeededToLead", async () => {
    localLeaderboards = [{
      cellId,
      leaderUserId: "user-2",
      leaderAreaM2: 100,
      users: {
        "user-1": { userId: "user-1", areaM2: 40, territoryCount: 1 },
        "user-2": { userId: "user-2", areaM2: 100, territoryCount: 1 },
      },
    }];

    await expect(getAreaNeededToLead({ userId: "user-1", cellId })).resolves.toBe(61);
  });

  test("retorna standing do usuario", async () => {
    localLeaderboards = [{
      cellId,
      leaderUserId: "user-2",
      leaderAreaM2: 100,
      users: {
        "user-1": { userId: "user-1", areaM2: 40, territoryCount: 1 },
        "user-2": { userId: "user-2", areaM2: 100, territoryCount: 1 },
      },
    }];

    const standing = await getUserLocalStanding({ userId: "user-1", cellId });

    expect(standing).toMatchObject({
      userId: "user-1",
      rank: 2,
      areaM2: 40,
      leaderUserId: "user-2",
    });
  });

  test("lida com celula vazia", async () => {
    const result = await recalculateLeaderboardsForCells([cellId], {
      territories: [],
      persist: false,
    });

    expect(result.leaderboards[0]).toMatchObject({
      cellId,
      leaderUserId: null,
      totalAreaM2: 0,
      users: {},
    });
  });

  test("salva leaderboard", async () => {
    activeTerritories = [territory({
      id: "t1",
      ownerId: "user-1",
      ownerName: "Ana",
      bbox: [0.0005, 0.0005, 0.003, 0.003],
    })];

    await recalculateLeaderboardsForCells([cellId]);
    const saved = await getLeaderboardForCell(cellId);

    expect(saveLocalTerritoryLeaderboards).toHaveBeenCalled();
    expect(saved).toMatchObject({
      cellId,
      leaderUserId: "user-1",
    });
  });
});

