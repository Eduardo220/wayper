import { describe, expect, test } from "@jest/globals";
import {
  getOwnerColor,
  leaderCellsToFeatureCollection,
  normalizeTerritoryForMap,
  territoriesToFeatureCollection,
  WAYPER_CURRENT_USER_COLOR,
} from "../territoryMapService.js";

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-51.001, -30.001],
      [-51.001, -29.999],
      [-50.999, -29.999],
      [-50.999, -30.001],
      [-51.001, -30.001],
    ],
  ],
};

const multiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    polygon.coordinates,
    [
      [
        [-50.998, -30.001],
        [-50.998, -29.999],
        [-50.996, -29.999],
        [-50.996, -30.001],
        [-50.998, -30.001],
      ],
    ],
  ],
};

describe("territoryMapService", () => {
  test("converte Polygon em FeatureCollection", () => {
    const collection = territoriesToFeatureCollection([
      { id: "t1", ownerId: "user-1", geometry: polygon },
    ], "user-1");

    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].geometry.type).toBe("Polygon");
  });

  test("converte MultiPolygon em FeatureCollection", () => {
    const collection = territoriesToFeatureCollection([
      { id: "t1", ownerId: "user-1", geometry: multiPolygon },
    ], "user-1");

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].geometry.type).toBe("MultiPolygon");
  });

  test("ignora geometria invalida", () => {
    const collection = territoriesToFeatureCollection([
      { id: "bad", ownerId: "user-1", geometry: { type: "Polygon", coordinates: [] } },
    ], "user-1");

    expect(collection.features).toHaveLength(0);
  });

  test("aplica cor verde para currentUser", () => {
    expect(getOwnerColor("user-1", { currentUserId: "user-1" })).toBe(WAYPER_CURRENT_USER_COLOR);
  });

  test("aplica cor deterministica para outros usuarios", () => {
    const first = getOwnerColor("user-2", { currentUserId: "user-1" });
    const second = getOwnerColor("user-2", { currentUserId: "user-1" });

    expect(first).toBe(second);
    expect(first).not.toBe(WAYPER_CURRENT_USER_COLOR);
  });

  test("marca isMine corretamente", () => {
    const feature = normalizeTerritoryForMap(
      { id: "t1", ownerId: "user-1", geometry: polygon },
      "user-1"
    );

    expect(feature.properties.isMine).toBe(true);
  });

  test("marca isLeaderTerritory corretamente", () => {
    const feature = normalizeTerritoryForMap(
      { id: "t1", ownerId: "user-1", leaderUserId: "user-1", geometry: polygon },
      "user-2"
    );

    expect(feature.properties.isLeaderTerritory).toBe(true);
  });

  test("cria leaderCells FeatureCollection", () => {
    const collection = leaderCellsToFeatureCollection([
      {
        cellId: "-30.005:-51.005",
        leaderUserId: "user-1",
        leaderUserName: "Ana",
        leaderAreaM2: 100,
      },
    ], "user-1");

    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.leaderUserId).toBe("user-1");
    expect(collection.features[0].geometry.type).toBe("Polygon");
  });
});

