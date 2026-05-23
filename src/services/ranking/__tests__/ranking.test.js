import { describe, expect, jest, test } from "@jest/globals";

jest.unstable_mockModule("../../../firebaseConfig.js", () => ({
  db: {},
}));

jest.unstable_mockModule("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  getDocs: jest.fn(async () => ({ forEach: jest.fn() })),
  limit: jest.fn((value) => ({ type: "limit", value })),
  query: jest.fn((...args) => args),
}));

const { computeLeaderboard } = await import("../compute.js");
const { normalizeLocalLeaderRanking } = await import("../ranking.localLeaders.js");

describe("ranking services", () => {
  test("modo area continua funcionando", () => {
    const result = computeLeaderboard(
      [
        { id: "u1", name: "Ana", totalArea: 100, totalDistance: 3000 },
        { id: "u2", name: "Bia", totalArea: 300, totalDistance: 1000 },
      ],
      { weights: { area: 1 }, primary: "area" }
    );

    expect(result[0].id).toBe("u2");
  });

  test("modo km continua funcionando", () => {
    const result = computeLeaderboard(
      [
        { id: "u1", name: "Ana", totalArea: 100, totalDistance: 3000 },
        { id: "u2", name: "Bia", totalArea: 300, totalDistance: 1000 },
      ],
      { weights: { distance: 1 }, primary: "distance" }
    );

    expect(result[0].id).toBe("u1");
  });

  test("modo lideres locais normaliza dados", () => {
    const result = normalizeLocalLeaderRanking([
      {
        cellId: "0:0",
        leaderUserId: "u1",
        leaderUserName: "Ana",
        leaderAreaM2: 120,
        users: { u1: { userId: "u1", areaM2: 120, territoryCount: 1 } },
      },
      {
        cellId: "0:0.005",
        leaderUserId: "u1",
        leaderUserName: "Ana",
        leaderAreaM2: 80,
        users: { u1: { userId: "u1", areaM2: 80, territoryCount: 1 } },
      },
      {
        cellId: "0.005:0",
        leaderUserId: "u2",
        leaderUserName: "Bia",
        leaderAreaM2: 150,
        users: { u2: { userId: "u2", areaM2: 150, territoryCount: 1 } },
      },
    ]);

    expect(result[0]).toMatchObject({
      id: "u1",
      cellsLedCount: 2,
      leaderAreaM2: 200,
      rank: 1,
    });
  });

  test("usuarios privados sao filtrados quando aplicavel", () => {
    const result = normalizeLocalLeaderRanking(
      [
        {
          cellId: "0:0",
          leaderUserId: "private-user",
          leaderUserName: "Privado",
          leaderAreaM2: 500,
          users: {
            "private-user": { userId: "private-user", areaM2: 500, territoryCount: 1 },
          },
        },
        {
          cellId: "0:0.005",
          leaderUserId: "public-user",
          leaderUserName: "Publico",
          leaderAreaM2: 100,
          users: {
            "public-user": { userId: "public-user", areaM2: 100, territoryCount: 1 },
          },
        },
      ],
      {
        users: [
          { id: "private-user", isPrivate: true },
          { id: "public-user", profileVisibility: "public" },
        ],
      }
    );

    expect(result.map((item) => item.id)).toEqual(["public-user"]);
  });
});
