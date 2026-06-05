import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();
const firestoreSets = [];
let firestoreDocShouldThrow = false;

const AsyncStorageMock = {
  getItem: jest.fn(async (key) => storage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => {
    storage.set(key, value);
  }),
  removeItem: jest.fn(async (key) => {
    storage.delete(key);
  }),
};

const NetInfoMock = {
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addEventListener: jest.fn(() => () => {}),
};

const FirestoreMock = {
  collection: jest.fn((...parts) => ({ path: parts.map(String).join("/") })),
  doc: jest.fn((...parts) => {
    if (firestoreDocShouldThrow) throw new Error("firestore unavailable");
    return { path: parts.map(String).join("/") };
  }),
  getDocs: jest.fn(async () => ({ docs: [], forEach: jest.fn() })),
  query: jest.fn((...args) => args),
  orderBy: jest.fn((...args) => args),
  limit: jest.fn((...args) => args),
  startAfter: jest.fn((...args) => args),
  Timestamp: {
    now: jest.fn(() => ({ seconds: 1_700_000_000, nanoseconds: 0 })),
  },
  writeBatch: jest.fn(() => ({
    set: jest.fn((ref, payload, options) => {
      firestoreSets.push({ ref, payload, options });
    }),
    delete: jest.fn(),
    commit: jest.fn(async () => true),
  })),
};

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: AsyncStorageMock,
}));

jest.unstable_mockModule("@react-native-community/netinfo", () => ({
  default: NetInfoMock,
}));

jest.unstable_mockModule("firebase/firestore", () => FirestoreMock);

jest.unstable_mockModule("../../firebaseConfig.js", () => ({
  db: { id: "mock-db" },
  auth: { currentUser: { uid: "user-1", displayName: "Atleta Teste" } },
}));

jest.unstable_mockModule("expo-task-manager", () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

jest.unstable_mockModule("expo-background-fetch", () => ({
  BackgroundFetchResult: { NewData: "NewData", Failed: "Failed" },
  registerTaskAsync: jest.fn(async () => true),
  unregisterTaskAsync: jest.fn(async () => true),
}));

jest.unstable_mockModule("react-native", () => ({
  Platform: { OS: "android", Version: 33 },
}));

jest.unstable_mockModule("../../services/notifications/notificationService.js", () => ({
  notifyActivitySubscribers: jest.fn(async () => true),
}));

jest.unstable_mockModule("../../services/territory/territoryStorageService.js", () => ({
  loadLocalTerritories: jest.fn(async () => []),
  loadLocalTerritoryEvents: jest.fn(async () => []),
  markTerritoryDeletedRemote: jest.fn(async () => ({ ok: true })),
  saveLocalTerritories: jest.fn(async (items) => items),
  saveLocalTerritory: jest.fn(async (item) => item),
  saveLocalTerritoryEvent: jest.fn(async (item) => item),
  saveLocalTerritoryEvents: jest.fn(async (items) => items),
  saveTerritoryEventRemote: jest.fn(async (item) => ({ ok: true, event: item })),
  saveTerritoryRemote: jest.fn(async (item) => ({ ok: true, territory: item })),
}));

jest.unstable_mockModule("../zones.js", () => ({
  default: {
    buildCapturedZone: jest.fn(() => []),
    buildConvexZone: jest.fn(() => []),
    isValidPolygon: jest.fn(() => false),
    calcArea: jest.fn(() => 0),
    compressCoords: jest.fn((coords) => coords),
  },
}));

const {
  findLocalRunById,
  loadLocalRunHistory,
  loadLocalRuns,
  saveLocalRun,
  syncRunsToFirestore,
} = await import("../sync.js");

const point = (index) => ({
  latitude: -23.56,
  longitude: -46.64 + index * 0.0001,
  timestamp: 1_700_000_000_000 + index * 1000,
  accuracy: 8,
});

describe("local run history source", () => {
  beforeEach(() => {
    storage.clear();
    firestoreSets.length = 0;
    firestoreDocShouldThrow = false;
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test("lista corridas finalizadas locais e ignora estados ativos ou finishing", async () => {
    storage.set("runs", JSON.stringify([
      { id: "run-pending", localRunId: "run-pending", status: "completed", syncStatus: "PENDING", date: "2026-06-05T10:00:00Z", distance: 1000, duration: 300 },
      { id: "run-failed", localRunId: "run-failed", status: "completed", syncStatus: "FAILED", offlineStatus: "SYNC_FAILED", date: "2026-06-05T11:00:00Z", distance: 800, duration: 260 },
      { id: "run-synced", localRunId: "run-synced", status: "completed", syncStatus: "SYNCED", synced: true, date: "2026-06-05T12:00:00Z", distance: 1200, duration: 360 },
      { id: "run-active", localRunId: "run-active", status: "RUNNING", date: "2026-06-05T13:00:00Z", distance: 200, duration: 60 },
      { id: "run-finishing", localRunId: "run-finishing", status: "FINISHING", date: "2026-06-05T14:00:00Z", distance: 300, duration: 90 },
    ]));

    const runs = await loadLocalRunHistory();

    expect(runs.map((run) => run.id)).toEqual(["run-synced", "run-failed", "run-pending"]);
    expect(runs.find((run) => run.id === "run-failed")).toMatchObject({
      syncStatus: "FAILED",
      offlineStatus: "SYNC_FAILED",
    });
  });

  test("deduplica localRunId e remoteRunId preservando rota, segmentos e remoteRunId", async () => {
    await saveLocalRun({
      id: "local-1",
      localRunId: "local-1",
      remoteRunId: "remote-1",
      status: "completed",
      syncStatus: "PENDING",
      distance: 100,
      duration: 40,
      date: "2026-06-05T10:00:00Z",
      trustedPath: [point(1), point(2)],
      renderPath: [point(1), point(2)],
      rawPath: [point(0), point(1), point(2)],
      segments: [{ index: 0, trustedPath: [point(1), point(2)] }],
    });

    await saveLocalRun({
      id: "remote-1",
      localRunId: "local-1",
      remoteRunId: "remote-1",
      status: "completed",
      syncStatus: "SYNCED",
      synced: true,
      distance: 120,
      duration: 44,
      date: "2026-06-05T10:05:00Z",
    });

    const runs = await loadLocalRuns();

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "local-1",
      localRunId: "local-1",
      remoteRunId: "remote-1",
      syncStatus: "SYNCED",
      offlineStatus: "SYNCED",
      distance: 120,
      duration: 44,
    });
    expect(runs[0].trustedPath).toHaveLength(2);
    expect(runs[0].rawPath).toHaveLength(3);
    expect(runs[0].segments).toHaveLength(1);
  });

  test("abre corrida local por id, localRunId, remoteRunId e id legado", async () => {
    await saveLocalRun({
      id: "stable-id",
      localRunId: "local-open",
      remoteRunId: "remote-open",
      runId: "legacy-open",
      status: "completed",
      distance: 500,
      duration: 200,
      date: "2026-06-05T10:00:00Z",
      path: [point(1), point(2)],
    });

    await expect(findLocalRunById("stable-id")).resolves.toMatchObject({ id: "stable-id" });
    await expect(findLocalRunById({ localRunId: "local-open" })).resolves.toMatchObject({ id: "stable-id" });
    await expect(findLocalRunById({ remoteRunId: "remote-open" })).resolves.toMatchObject({ id: "stable-id" });
    await expect(findLocalRunById({ legacyId: "legacy-open" })).resolves.toMatchObject({ id: "stable-id" });
  });

  test("falha de Firestore mantem corrida visivel como sync failed", async () => {
    jest.useFakeTimers();
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await saveLocalRun({
      id: "sync-fail-visible",
      localRunId: "sync-fail-visible",
      status: "completed",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      distance: 700,
      duration: 250,
      date: "2026-06-05T10:00:00Z",
      path: [point(1), point(2)],
    });

    firestoreDocShouldThrow = true;
    try {
      await syncRunsToFirestore();
      const [run] = await loadLocalRunHistory();

      expect(run).toMatchObject({
        id: "sync-fail-visible",
        syncStatus: "FAILED",
        offlineStatus: "SYNC_FAILED",
        pendingSync: true,
      });
      expect(run.trustedPath).toHaveLength(2);
    } finally {
      consoleErrorSpy.mockRestore();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
