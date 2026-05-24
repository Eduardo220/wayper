import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  calculateGeometryAreaM2,
  calculateGeometryBbox,
  calculateGeometryCenter,
  geometryToPreviewCoords,
} from "../territoryGeometryService.js";
import { getCellIdsForGeometry } from "../territoryCellService.js";

const fetchActiveTerritoriesNear = jest.fn(async () => []);
const saveLocalTerritories = jest.fn(async (territories) => territories);
const saveLocalTerritoryEvents = jest.fn(async (events) => events);
const loadLocalTerritoryLeaderboards = jest.fn(async () => []);
const saveLocalTerritoryLeaderboards = jest.fn(async (leaderboards) => leaderboards);
const fetchTerritoryLeaderboardByCellId = jest.fn(async () => null);
const saveTerritoryLeaderboardRemote = jest.fn(async (leaderboard) => ({ ok: true, leaderboard }));
const scheduleTerritoriesSync = jest.fn();
const scheduleTerritoryEventsSync = jest.fn();

jest.unstable_mockModule("../territoryStorageService.js", () => ({
  fetchActiveTerritoriesNear,
  fetchTerritoryLeaderboardByCellId,
  loadLocalTerritoryLeaderboards,
  saveLocalTerritories,
  saveLocalTerritoryEvents,
  saveLocalTerritoryLeaderboards,
  saveTerritoryLeaderboardRemote,
}));

jest.unstable_mockModule("../../../utils/sync.js", () => ({
  scheduleTerritoriesSync,
  scheduleTerritoryEventsSync,
}));

const { processRunTerritoryCapture } = await import("../territoryCaptureService.js");

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

function pathFromBbox([minLng, minLat, maxLng, maxLat]) {
  const vertices = [
    { latitude: minLat, longitude: minLng },
    { latitude: minLat, longitude: maxLng },
    { latitude: maxLat, longitude: maxLng },
    { latitude: maxLat, longitude: minLng },
    { latitude: minLat, longitude: minLng },
  ];
  const points = [];
  const maxStepDegrees = 0.0015;

  for (let i = 0; i < vertices.length - 1; i += 1) {
    const from = vertices[i];
    const to = vertices[i + 1];
    const steps = Math.max(
      1,
      Math.ceil(
        Math.max(
          Math.abs(to.latitude - from.latitude),
          Math.abs(to.longitude - from.longitude)
        ) / maxStepDegrees
      )
    );

    for (let step = 0; step <= steps; step += 1) {
      if (points.length > 0 && step === 0) continue;
      const ratio = step / steps;
      points.push({
        latitude: from.latitude + (to.latitude - from.latitude) * ratio,
        longitude: from.longitude + (to.longitude - from.longitude) * ratio,
        accuracy: 5,
        speed: 3,
      });
    }
  }

  return points;
}

function territoryFromBbox({
  id,
  ownerId,
  ownerName,
  bbox,
  status = "active",
  version = 1,
}) {
  const geometry = polygonFromBbox(bbox);
  return {
    id,
    ownerId,
    userId: ownerId,
    ownerName,
    ownerAvatar: `${ownerId}.png`,
    status,
    version,
    geometry,
    areaM2: calculateGeometryAreaM2(geometry),
    bbox: calculateGeometryBbox(geometry),
    center: calculateGeometryCenter(geometry),
    coordsPreview: geometryToPreviewCoords(geometry),
    cellIds: getCellIdsForGeometry(geometry),
  };
}

const baseParams = {
  userId: "user-1",
  userName: "Ana",
  userAvatar: "ana.png",
  runId: "run-1",
  mode: "zones",
  distanceMeters: 1000,
  durationSeconds: 400,
  createdAt: "2026-05-18T10:00:00.000Z",
  persist: false,
};

describe("territoryCaptureService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchActiveTerritoriesNear.mockResolvedValue([]);
    loadLocalTerritoryLeaderboards.mockResolvedValue([]);
  });

  test("corrida free nao captura", async () => {
    const result = await processRunTerritoryCapture({
      ...baseParams,
      mode: "free",
      path: pathFromBbox([0, 0, 0.005, 0.005]),
    });

    expect(result).toEqual({
      ok: false,
      reason: "free_run",
    });
  });

  test("modo zones com area livre cria territorio", async () => {
    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0, 0, 0.005, 0.005]),
      existingTerritories: [],
    });

    expect(result.ok).toBe(true);
    expect(result.capturedTerritory).toMatchObject({
      ownerId: "user-1",
      runId: "run-1",
      status: "active",
      source: "zoneRun",
      version: 1,
    });
    expect(result.newAreaM2).toBeGreaterThan(50);
  });

  test("area invalida retorna falha controlada", async () => {
    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: [{ latitude: "bad", longitude: null }],
      existingTerritories: [],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_enough_points");
    expect(result.runContext.runId).toBe("run-1");
  });

  test("area pequena retorna falha controlada", async () => {
    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: [
        { latitude: 0, longitude: 0, accuracy: 5, speed: 3 },
        { latitude: 0, longitude: 0.000005, accuracy: 5, speed: 3 },
        { latitude: 0.000002, longitude: 0.000006, accuracy: 5, speed: 3 },
        { latitude: 0.000005, longitude: 0.000005, accuracy: 5, speed: 3 },
        { latitude: 0.000006, longitude: 0.000002, accuracy: 5, speed: 3 },
        { latitude: 0.000005, longitude: -0.000001, accuracy: 5, speed: 3 },
        { latitude: 0.000002, longitude: -0.000001, accuracy: 5, speed: 3 },
        { latitude: 0.000001, longitude: 0.000001, accuracy: 5, speed: 3 },
      ],
      existingTerritories: [],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("area_too_small");
  });

  test("captura sobre territorio proprio faz merge", async () => {
    const own = territoryFromBbox({
      id: "own-1",
      ownerId: "user-1",
      ownerName: "Ana",
      bbox: [0.004, 0, 0.009, 0.005],
    });

    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0, 0, 0.005, 0.005]),
      existingTerritories: [own],
    });

    expect(result.ok).toBe(true);
    expect(result.mergedTerritories).toHaveLength(1);
    expect(result.deletedTerritories[0]).toMatchObject({
      id: "own-1",
      status: "deleted",
      mergedInto: result.capturedTerritory.id,
    });
    expect(result.events.some((event) => event.type === "merge")).toBe(true);
    expect(result.ownMergedAreaM2).toBeGreaterThan(0);
  });

  test("captura parcial sobre inimigo gera roubo", async () => {
    const enemy = territoryFromBbox({
      id: "enemy-1",
      ownerId: "user-2",
      ownerName: "Bruno",
      bbox: [0.004, 0, 0.009, 0.005],
    });

    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0, 0, 0.006, 0.005]),
      existingTerritories: [enemy],
    });

    expect(result.ok).toBe(true);
    expect(result.stolenAreaM2).toBeGreaterThan(0);
    expect(result.events.some((event) => event.type === "steal")).toBe(true);
    expect(result.affectedUsers[0]).toMatchObject({
      userId: "user-2",
      userName: "Bruno",
    });
  });

  test("inimigo perde area apos difference", async () => {
    const enemy = territoryFromBbox({
      id: "enemy-1",
      ownerId: "user-2",
      ownerName: "Bruno",
      bbox: [0.004, 0, 0.009, 0.005],
    });

    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0, 0, 0.006, 0.005]),
      existingTerritories: [enemy],
    });

    expect(result.updatedTerritories).toHaveLength(1);
    expect(result.updatedTerritories[0].areaM2).toBeLessThan(enemy.areaM2);
    expect(result.updatedTerritories[0].pendingSync).toBe(true);
  });

  test("captura 100% sobre inimigo marca conquered", async () => {
    const enemy = territoryFromBbox({
      id: "enemy-1",
      ownerId: "user-2",
      ownerName: "Bruno",
      bbox: [0.001, 0.001, 0.004, 0.004],
    });

    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0, 0, 0.005, 0.005]),
      existingTerritories: [enemy],
    });

    expect(result.conqueredTerritories).toHaveLength(1);
    expect(result.conqueredTerritories[0]).toMatchObject({
      id: "enemy-1",
      status: "conquered",
      deleted: true,
    });
    expect(result.events.some((event) => event.type === "conquered")).toBe(true);
  });

  test("roubo sobre multiplos inimigos gera multiplos eventos", async () => {
    const firstEnemy = territoryFromBbox({
      id: "enemy-1",
      ownerId: "user-2",
      ownerName: "Bruno",
      bbox: [0.001, 0.001, 0.003, 0.003],
    });
    const secondEnemy = territoryFromBbox({
      id: "enemy-2",
      ownerId: "user-3",
      ownerName: "Carla",
      bbox: [0.0035, 0.001, 0.0048, 0.003],
    });

    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0, 0, 0.005, 0.005]),
      existingTerritories: [firstEnemy, secondEnemy],
    });

    expect(result.events.filter((event) => event.type === "steal")).toHaveLength(2);
    expect(result.affectedUsers).toHaveLength(2);
  });

  test("split MultiPolygon e tratado", async () => {
    const enemy = territoryFromBbox({
      id: "enemy-1",
      ownerId: "user-2",
      ownerName: "Bruno",
      bbox: [0, 0, 0.012, 0.006],
    });

    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0.005, -0.001, 0.007, 0.007]),
      existingTerritories: [enemy],
    });

    expect(result.ok).toBe(true);
    expect(result.splitTerritories).toHaveLength(1);
    expect(result.splitTerritories[0].geometry.type).toBe("MultiPolygon");
    expect(result.events.some((event) => event.type === "split")).toBe(true);
  });

  test("eventos capture steal conquered sao criados", async () => {
    const enemy = territoryFromBbox({
      id: "enemy-1",
      ownerId: "user-2",
      ownerName: "Bruno",
      bbox: [0.001, 0.001, 0.004, 0.004],
    });

    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0, 0, 0.005, 0.005]),
      existingTerritories: [enemy],
    });

    const eventTypes = result.events.map((event) => event.type);
    expect(eventTypes).toContain("capture");
    expect(eventTypes).toContain("steal");
    expect(eventTypes).toContain("conquered");
  });

  test("persist=false nao grava storage", async () => {
    await processRunTerritoryCapture({
      ...baseParams,
      persist: false,
      path: pathFromBbox([0, 0, 0.005, 0.005]),
      existingTerritories: [],
    });

    expect(saveLocalTerritories).not.toHaveBeenCalled();
    expect(saveLocalTerritoryEvents).not.toHaveBeenCalled();
    expect(saveLocalTerritoryLeaderboards).not.toHaveBeenCalled();
  });

  test("persist=true chama storage", async () => {
    const result = await processRunTerritoryCapture({
      ...baseParams,
      persist: true,
      path: pathFromBbox([0, 0, 0.005, 0.005]),
      existingTerritories: [],
    });

    expect(result.ok).toBe(true);
    expect(saveLocalTerritories).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: result.capturedTerritory.id })]),
      expect.objectContaining({ preserveVersion: true })
    );
    expect(saveLocalTerritoryEvents).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: "capture" })]),
      expect.objectContaining({ preserveVersion: true })
    );
  });

  test("capturedTerritory contem bbox center cellIds e version", async () => {
    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0, 0, 0.005, 0.005]),
      existingTerritories: [],
    });

    expect(result.capturedTerritory).toMatchObject({
      bbox: expect.any(Array),
      center: expect.objectContaining({
        latitude: expect.any(Number),
        longitude: expect.any(Number),
      }),
      cellIds: expect.any(Array),
      version: 1,
    });
    expect(result.cellIds.length).toBeGreaterThan(0);
  });

  test("processRunTerritoryCapture retorna becameLeaderInCells", async () => {
    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0, 0, 0.005, 0.005]),
      existingTerritories: [],
    });

    expect(result.ok).toBe(true);
    expect(result.becameLeaderInCells.length).toBeGreaterThan(0);
    expect(result.localLeaderboardUpdates.some((update) => update.leaderUserId === "user-1")).toBe(true);
  });

  test("roubo pode mudar lider", async () => {
    const enemy = territoryFromBbox({
      id: "enemy-1",
      ownerId: "user-2",
      ownerName: "Bruno",
      bbox: [0.001, 0.001, 0.004, 0.004],
    });
    loadLocalTerritoryLeaderboards.mockResolvedValue([
      {
        cellId: enemy.cellIds[0],
        leaderUserId: "user-2",
        leaderUserName: "Bruno",
        leaderAreaM2: enemy.areaM2,
        totalAreaM2: enemy.areaM2,
        users: {
          "user-2": {
            userId: "user-2",
            userName: "Bruno",
            areaM2: enemy.areaM2,
            territoryCount: 1,
          },
        },
      },
    ]);

    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0, 0, 0.005, 0.005]),
      existingTerritories: [enemy],
    });

    expect(result.ok).toBe(true);
    expect(result.localLeaderboardUpdates.some(
      (update) => update.previousLeaderUserId === "user-2" && update.leaderUserId === "user-1"
    )).toBe(true);
  });

  test("eventos leader_changed sao criados", async () => {
    const result = await processRunTerritoryCapture({
      ...baseParams,
      path: pathFromBbox([0, 0, 0.005, 0.005]),
      existingTerritories: [],
    });

    expect(result.ok).toBe(true);
    expect(result.events.some((event) => event.type === "leader_changed")).toBe(true);
    expect(result.summary.highlights).toContain("leader_changed");
  });

  test("nao lanca erro quando Turf falha", async () => {
    await expect(
      processRunTerritoryCapture({
        ...baseParams,
        path: pathFromBbox([0, 0, 0.005, 0.005]),
        existingTerritories: [
          {
            id: "broken",
            ownerId: "user-2",
            status: "active",
            geometry: { type: "Polygon", coordinates: [] },
          },
        ],
      })
    ).resolves.toMatchObject({ ok: true });
  });
});
