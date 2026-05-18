import { describe, expect, test } from "@jest/globals";
import { applyTerritoryCaptureStats } from "../territoryStatsService.js";

function basePayload(overrides = {}) {
  return {
    actorUserId: "user-1",
    capturedAreaM2: 100,
    newAreaM2: 70,
    stolenAreaM2: 30,
    ownMergedAreaM2: 0,
    affectedUsers: [],
    conqueredTerritories: [],
    becameLeaderInCells: [],
    persist: false,
    updatedAt: "2026-05-18T10:00:00.000Z",
    existingStats: {
      "user-1": {
        totalAreaM2: 50,
        monthlyAreaM2: 20,
        totalCapturedAreaM2: 10,
        totalStolenAreaM2: 5,
        territoriesCount: 2,
        capturesCount: 2,
        stealsCount: 1,
        conqueredCount: 0,
        cellsLedCount: 0,
      },
    },
    existingUsers: {
      "user-1": {
        totalArea: 50,
        area: 50,
        monthlyArea: 20,
        totalZones: 2,
        zones: 2,
        monthlyPoints: 10,
        globalPoints: 10,
      },
    },
    ...overrides,
  };
}

describe("territoryStatsService", () => {
  test("incrementa area do ator", async () => {
    const result = await applyTerritoryCaptureStats(basePayload());

    expect(result.actorStats.totalAreaM2).toBe(150);
  });

  test("incrementa area roubada", async () => {
    const result = await applyTerritoryCaptureStats(basePayload());

    expect(result.actorStats.totalStolenAreaM2).toBe(35);
  });

  test("decrementa area do alvo", async () => {
    const result = await applyTerritoryCaptureStats(basePayload({
      affectedUsers: [{ userId: "user-2", affectedAreaM2: 30 }],
      existingStats: {
        "user-1": {},
        "user-2": { totalAreaM2: 100, monthlyAreaM2: 80, totalLostAreaM2: 5 },
      },
      existingUsers: {
        "user-1": {},
        "user-2": { totalArea: 100, area: 100, monthlyArea: 80 },
      },
    }));

    expect(result.statPatches["user-2"].totalAreaM2).toBe(70);
    expect(result.userPatches["user-2"].totalArea).toBe(70);
  });

  test("nunca deixa totalArea negativo", async () => {
    const result = await applyTerritoryCaptureStats(basePayload({
      affectedUsers: [{ userId: "user-2", affectedAreaM2: 300 }],
      existingStats: {
        "user-1": {},
        "user-2": { totalAreaM2: 100, monthlyAreaM2: 80 },
      },
      existingUsers: {
        "user-1": {},
        "user-2": { totalArea: 100, area: 100, monthlyArea: 80 },
      },
    }));

    expect(result.statPatches["user-2"].totalAreaM2).toBe(0);
    expect(result.userPatches["user-2"].totalArea).toBe(0);
  });

  test("incrementa capturesCount", async () => {
    const result = await applyTerritoryCaptureStats(basePayload());

    expect(result.actorStats.capturesCount).toBe(3);
  });

  test("incrementa stealsCount", async () => {
    const result = await applyTerritoryCaptureStats(basePayload());

    expect(result.actorStats.stealsCount).toBe(2);
  });

  test("incrementa conqueredCount", async () => {
    const result = await applyTerritoryCaptureStats(basePayload({
      conqueredTerritories: [{ id: "enemy-1" }, { id: "enemy-2" }],
    }));

    expect(result.actorStats.conqueredCount).toBe(2);
  });

  test("atualiza users.totalArea/monthlyArea", async () => {
    const result = await applyTerritoryCaptureStats(basePayload());

    expect(result.actorUserPatch.totalArea).toBe(150);
    expect(result.actorUserPatch.monthlyArea).toBe(120);
  });

  test("atualiza cellsLedCount", async () => {
    const result = await applyTerritoryCaptureStats(basePayload({
      becameLeaderInCells: ["0:0", "0:0.005", "0:0"],
    }));

    expect(result.actorStats.cellsLedCount).toBe(2);
  });
});

