import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let localEvents = [];

const loadLocalTerritoryEvents = jest.fn(async () => localEvents);

jest.unstable_mockModule("../../../firebaseConfig.js", () => ({
  auth: { currentUser: { uid: "me" } },
  db: {},
}));

jest.unstable_mockModule("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  getDocs: jest.fn(async () => ({ forEach: jest.fn() })),
  limit: jest.fn((value) => ({ type: "limit", value })),
  orderBy: jest.fn((field, direction) => ({ type: "orderBy", field, direction })),
  query: jest.fn((...args) => args),
  where: jest.fn((field, op, value) => ({ type: "where", field, op, value })),
}));

jest.unstable_mockModule("../territoryStorageService.js", () => ({
  loadLocalTerritoryEvents,
}));

const {
  buildTerritoryMapParams,
  filterCompetitiveFeedItems,
  filterTerritoryEventsByPrivacy,
  loadLocalTerritoryFeed,
  mergeRunsZonesAndTerritoryEvents,
  normalizeTerritoryEventForFeed,
} = await import("../territoryFeedService.js");

const squareCoords = [
  { latitude: -23.56, longitude: -46.64 },
  { latitude: -23.56, longitude: -46.63 },
  { latitude: -23.55, longitude: -46.63 },
  { latitude: -23.55, longitude: -46.64 },
  { latitude: -23.56, longitude: -46.64 },
];

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-46.64, -23.56],
      [-46.63, -23.56],
      [-46.63, -23.55],
      [-46.64, -23.55],
      [-46.64, -23.56],
    ],
  ],
};

const multiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    polygon.coordinates,
    [
      [
        [-46.62, -23.56],
        [-46.61, -23.56],
        [-46.61, -23.55],
        [-46.62, -23.55],
        [-46.62, -23.56],
      ],
    ],
  ],
};

describe("territoryFeedService", () => {
  beforeEach(() => {
    localEvents = [];
    loadLocalTerritoryEvents.mockClear();
  });

  test("CorridasScreen ainda mostra corrida livre", () => {
    const items = mergeRunsZonesAndTerritoryEvents({
      runs: [{ id: "run1", mode: "free", distance: 2500, duration: 900, date: "2026-01-01T10:00:00Z" }],
    });

    const free = filterCompetitiveFeedItems(items, "free");

    expect(free).toHaveLength(1);
    expect(free[0].__type).toBe("run");
    expect(free[0].areaM2).toBe(0);
  });

  test("CorridasScreen ainda mostra zona legada", () => {
    const items = mergeRunsZonesAndTerritoryEvents({
      zones: [{ id: "zone1", area: 150, coords: squareCoords, date: "2026-01-01T10:00:00Z" }],
    });

    const captures = filterCompetitiveFeedItems(items, "captures");

    expect(items[0].__type).toBe("zone");
    expect(captures).toHaveLength(1);
    expect(captures[0].areaM2).toBe(150);
  });

  test("filtro Capturas mostra capture events", () => {
    const items = mergeRunsZonesAndTerritoryEvents({
      events: [{ id: "event1", type: "capture", actorId: "me", actorName: "Eduardo", affectedAreaM2: 1200, createdAt: "2026-01-01T10:00:00Z" }],
    });

    const captures = filterCompetitiveFeedItems(items, "captures");

    expect(captures).toHaveLength(1);
    expect(captures[0].__type).toBe("territory_capture");
  });

  test("filtro Roubos mostra steal events", () => {
    const items = mergeRunsZonesAndTerritoryEvents({
      events: [{ id: "event2", type: "steal", actorId: "me", targetId: "u2", targetName: "Marcos", affectedAreaM2: 430 }],
    });

    const steals = filterCompetitiveFeedItems(items, "steals");

    expect(steals).toHaveLength(1);
    expect(steals[0].title).toContain("Marcos");
  });

  test("filtro Liderancas mostra leader_changed", () => {
    const items = mergeRunsZonesAndTerritoryEvents({
      events: [{ id: "event3", type: "leader_changed", actorId: "me", actorName: "Eduardo", cellIds: ["-23.56:-46.64"] }],
    });

    const leaders = filterCompetitiveFeedItems(items, "leaders");

    expect(leaders).toHaveLength(1);
    expect(leaders[0].__type).toBe("territory_leader_changed");
  });

  test("evento private nao aparece para outro user", () => {
    const visible = filterTerritoryEventsByPrivacy([
      { id: "private1", type: "capture", actorId: "owner", visibility: "private" },
    ], "other");

    expect(visible).toHaveLength(0);
  });

  test("evento public aparece", () => {
    const visible = filterTerritoryEventsByPrivacy([
      { id: "public1", type: "capture", actorId: "owner", visibility: "public" },
    ], "other");

    expect(visible).toHaveLength(1);
  });

  test("card de evento renderiza sem geometry via item normalizado", () => {
    const item = normalizeTerritoryEventForFeed({ id: "no_geo", type: "capture", actorId: "me" });

    expect(item).toMatchObject({
      id: "no_geo",
      __type: "territory_capture",
      geometry: null,
      coordsPreview: [],
    });
  });

  test("card de evento renderiza com Polygon via item normalizado", () => {
    const item = normalizeTerritoryEventForFeed({ id: "poly", type: "capture", actorId: "me", geometry: polygon });

    expect(item.geometry.type).toBe("Polygon");
    expect(item.coordsPreview.length).toBeGreaterThanOrEqual(5);
  });

  test("card de evento renderiza com MultiPolygon via item normalizado", () => {
    const item = normalizeTerritoryEventForFeed({ id: "multi", type: "capture", actorId: "me", geometry: multiPolygon });

    expect(item.geometry.type).toBe("MultiPolygon");
    expect(item.coordsPreview.length).toBeGreaterThanOrEqual(5);
  });

  test("botao Ver no mapa monta params corretos", () => {
    const params = buildTerritoryMapParams({
      territoryId: "territory1",
      cellIds: ["cell1"],
      userId: "user1",
    });

    expect(params).toEqual({
      focusTerritoryId: "territory1",
      focusCellId: "cell1",
      focusUserId: "user1",
    });
  });

  test("loadLocalTerritoryFeed aplica privacidade basica", async () => {
    localEvents = [
      { id: "mine_private", type: "capture", actorId: "me", visibility: "private" },
      { id: "other_private", type: "capture", actorId: "other", visibility: "private" },
      { id: "public", type: "capture", actorId: "other", visibility: "public" },
    ];

    const items = await loadLocalTerritoryFeed({ currentUserId: "me" });

    expect(items.map((item) => item.id).sort()).toEqual(["mine_private", "public"]);
  });
});
