import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();
const firestoreSets = [];
let firestoreDocShouldThrow = false;
let firestoreCommitShouldThrow = false;
let firestoreCommitBlocker = null;
let firestoreGetDocsDocs = [];

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
  getDocs: jest.fn(async () => ({
    docs: firestoreGetDocsDocs,
    forEach: jest.fn((callback) => firestoreGetDocsDocs.forEach(callback)),
    size: firestoreGetDocsDocs.length,
  })),
  query: jest.fn((...args) => args),
  where: jest.fn((...args) => args),
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
    commit: jest.fn(async () => {
      if (firestoreCommitShouldThrow) throw new Error("firestore commit unavailable");
      if (firestoreCommitBlocker) await firestoreCommitBlocker.promise;
      return true;
    }),
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
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
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

const createDeferred = () => {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const expectNoUndefined = (value) => {
  if (Array.isArray(value)) {
    value.forEach(expectNoUndefined);
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => {
      expect(entry).not.toBeUndefined();
      expectNoUndefined(entry);
    });
  }
};

describe("local run history source", () => {
  beforeEach(() => {
    storage.clear();
    firestoreSets.length = 0;
    firestoreDocShouldThrow = false;
    firestoreCommitShouldThrow = false;
    firestoreCommitBlocker = null;
    firestoreGetDocsDocs = [];
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

  test("normaliza status legados e seleciona apenas finalizadas recuperaveis", async () => {
    storage.set("runs", JSON.stringify([
      { id: "pending-sync-status", localRunId: "pending-sync-status", status: "completed", syncStatus: "PENDING_SYNC", date: "2026-06-05T10:00:00Z", distance: 100, duration: 60 },
      { id: "failed-sync-status", localRunId: "failed-sync-status", status: "completed", syncStatus: "SYNC_FAILED", date: "2026-06-05T11:00:00Z", distance: 100, duration: 60 },
      { id: "local-only", localRunId: "local-only", status: "completed", offlineStatus: "LOCAL_ONLY", date: "2026-06-05T12:00:00Z", distance: 100, duration: 60 },
      { id: "remote-clean", localRunId: "remote-clean", remoteRunId: "remote-clean", status: "completed", date: "2026-06-05T13:00:00Z", distance: 100, duration: 60 },
      { id: "paused-run", localRunId: "paused-run", status: "PAUSED", date: "2026-06-05T14:00:00Z", distance: 100, duration: 60 },
      { id: "recovering-run", localRunId: "recovering-run", status: "RECOVERING", date: "2026-06-05T15:00:00Z", distance: 100, duration: 60 },
      { id: "finishing-run", localRunId: "finishing-run", status: "FINISHING", date: "2026-06-05T16:00:00Z", distance: 100, duration: 60 },
    ]));

    const runs = await loadLocalRuns();

    expect(runs.map((run) => run.id)).toEqual(["remote-clean", "local-only", "failed-sync-status", "pending-sync-status"]);
    expect(runs.find((run) => run.id === "pending-sync-status")).toMatchObject({
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      pendingSync: true,
    });
    expect(runs.find((run) => run.id === "failed-sync-status")).toMatchObject({
      syncStatus: "FAILED",
      offlineStatus: "SYNC_FAILED",
    });
    expect(runs.find((run) => run.id === "remote-clean")).toMatchObject({
      syncStatus: "SYNCED",
      offlineStatus: "SYNCED",
      pendingSync: false,
    });

    await syncRunsToFirestore();

    expect(firestoreSets.some((item) => item.ref.path.includes("runs/remote-clean"))).toBe(false);
    expect(firestoreSets.some((item) => item.ref.path.includes("runs/pending-sync-status"))).toBe(true);
    expect(firestoreSets.some((item) => item.ref.path.includes("runs/failed-sync-status"))).toBe(true);
    expect(firestoreSets.some((item) => item.ref.path.includes("runs/local-only"))).toBe(true);
  });

  test("offline nao tenta Firestore e mantem corrida pendente", async () => {
    NetInfoMock.fetch.mockResolvedValueOnce({ isConnected: false, isInternetReachable: false });
    await saveLocalRun({
      id: "offline-run",
      localRunId: "offline-run",
      status: "completed",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      distance: 700,
      duration: 250,
      date: "2026-06-05T10:00:00Z",
      path: [point(1), point(2)],
    });

    const result = await syncRunsToFirestore();
    const [run] = await loadLocalRunHistory();

    expect(result.offline).toBe(true);
    expect(firestoreSets).toHaveLength(0);
    expect(run).toMatchObject({
      id: "offline-run",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      pendingSync: true,
    });
  });

  test("usa remoteRunId existente e preserva identidade local no sucesso", async () => {
    await saveLocalRun({
      id: "local-idempotent",
      localRunId: "local-idempotent",
      remoteRunId: "remote-idempotent",
      status: "completed",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      distance: 700,
      duration: 250,
      date: "2026-06-05T10:00:00Z",
      path: [point(1), point(2)],
      renderPath: [point(1), point(2)],
      rawPath: [point(0), point(1), point(2)],
      segments: [{ index: 0, trustedPath: [point(1), point(2)] }],
    });

    await syncRunsToFirestore();
    await syncRunsToFirestore();
    const [run] = await loadLocalRunHistory();
    const rootWrites = firestoreSets.filter((item) => item.ref.path.includes("runs/remote-idempotent"));

    expect(run).toMatchObject({
      id: "local-idempotent",
      localRunId: "local-idempotent",
      remoteRunId: "remote-idempotent",
      syncStatus: "SYNCED",
      offlineStatus: "SYNCED",
    });
    expect(rootWrites.length).toBeGreaterThanOrEqual(1);
    expect(firestoreSets.some((item) => item.ref.path.includes("runs/local-idempotent"))).toBe(false);
    expect(run.rawPath).toHaveLength(3);
    expect(run.segments).toHaveLength(1);
  });

  test("deduplica remoto por localRunId antes de criar documento novo", async () => {
    firestoreGetDocsDocs = [{
      id: "remote-found",
      data: () => ({ id: "remote-found", localRunId: "local-found" }),
    }];
    await saveLocalRun({
      id: "local-found",
      localRunId: "local-found",
      status: "completed",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      distance: 700,
      duration: 250,
      date: "2026-06-05T10:00:00Z",
      path: [point(1), point(2)],
    });

    await syncRunsToFirestore();
    const [run] = await loadLocalRunHistory();

    expect(run.remoteRunId).toBe("remote-found");
    expect(firestoreSets.some((item) => item.ref.path.includes("runs/remote-found"))).toBe(true);
    expect(firestoreSets.some((item) => item.ref.path.includes("runs/local-found"))).toBe(false);
  });

  test("payload Firestore e sanitizado, preserva paths e dados territoriais quando a corrida e por zonas", async () => {
    await saveLocalRun({
      id: "zone-sync",
      localRunId: "zone-sync",
      status: "completed",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      mode: "zones",
      distance: 1000,
      duration: 300,
      date: "2026-06-05T10:00:00Z",
      trustedPath: [point(1), point(2)],
      renderPath: [point(1), point(2)],
      rawPath: [point(0), point(1), point(2)],
      segments: [{ index: 0, trustedPath: [point(1), point(2)], rawPath: [point(0), point(1)] }],
      area: 42,
      areaM2: 42,
      zoneCoords: [point(1), point(2), point(3)],
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]], ignored: undefined },
      territorySummary: { capturedAreaM2: 42, ignored: undefined },
    });

    await syncRunsToFirestore();
    const rootWrite = firestoreSets.find((item) => item.ref.path.includes("runs/zone-sync"));

    expect(rootWrite.payload).toMatchObject({
      id: "zone-sync",
      localRunId: "zone-sync",
      remoteRunId: "zone-sync",
      mode: "zones",
      area: 42,
      areaM2: 42,
      zoneCount: 1,
    });
    expect(rootWrite.payload.trustedPath).toHaveLength(2);
    expect(rootWrite.payload.renderPath).toHaveLength(2);
    expect(rootWrite.payload.rawPath).toHaveLength(3);
    expect(rootWrite.payload.segments).toHaveLength(1);
    expect(rootWrite.payload.zoneCoords).toHaveLength(3);
    expect(rootWrite.payload.territorySummary).toMatchObject({ capturedAreaM2: 42 });
    expectNoUndefined(rootWrite.payload);
  });

  test("corrida livre nao ganha territorio falso no payload remoto", async () => {
    await saveLocalRun({
      id: "free-sync",
      localRunId: "free-sync",
      status: "completed",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      mode: "free",
      distance: 1000,
      duration: 300,
      date: "2026-06-05T10:00:00Z",
      trustedPath: [point(1), point(2)],
      area: 999,
      zoneCoords: [point(1), point(2), point(3)],
      geometry: { type: "Polygon", coordinates: [] },
    });

    await syncRunsToFirestore();
    const rootWrite = firestoreSets.find((item) => item.ref.path.includes("runs/free-sync"));

    expect(rootWrite.payload.mode).toBe("free");
    expect(rootWrite.payload.area).toBe(0);
    expect(rootWrite.payload.zoneCoords).toEqual([]);
    expect(rootWrite.payload.geometry).toBeNull();
    expect(rootWrite.payload.zoneCount).toBe(0);
  });

  test("saveLocalRun preserva remoteRunId e syncStatus mais novo contra payload antigo", async () => {
    await saveLocalRun({
      id: "newer-sync",
      localRunId: "newer-sync",
      remoteRunId: "remote-newer",
      status: "completed",
      syncStatus: "SYNCED",
      offlineStatus: "SYNCED",
      synced: true,
      pendingSync: false,
      lastSyncedAt: "2026-06-05T12:00:00Z",
      updatedAt: "2026-06-05T12:00:00Z",
      distance: 1000,
      duration: 300,
      date: "2026-06-05T10:00:00Z",
      trustedPath: [point(1), point(2)],
    });

    await saveLocalRun({
      id: "newer-sync",
      localRunId: "newer-sync",
      status: "completed",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      synced: false,
      pendingSync: true,
      updatedAt: "2026-06-05T11:00:00Z",
      distance: 1200,
      duration: 330,
      date: "2026-06-05T10:05:00Z",
      trustedPath: [point(1), point(2), point(3)],
    });

    const [run] = await loadLocalRunHistory();

    expect(run).toMatchObject({
      id: "newer-sync",
      localRunId: "newer-sync",
      remoteRunId: "remote-newer",
      syncStatus: "SYNCED",
      offlineStatus: "SYNCED",
      pendingSync: false,
      distance: 1000,
    });
    expect(run.trustedPath).toHaveLength(2);
  });

  test("sync antigo nao limpa pendencia se a corrida local mudar durante o envio", async () => {
    firestoreCommitBlocker = createDeferred();
    await saveLocalRun({
      id: "changed-during-sync",
      localRunId: "changed-during-sync",
      status: "completed",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      distance: 700,
      duration: 250,
      date: "2026-06-05T10:00:00Z",
      path: [point(1), point(2)],
    });

    const firstSync = syncRunsToFirestore();
    await Promise.resolve();
    await Promise.resolve();
    const concurrent = await syncRunsToFirestore();

    await saveLocalRun({
      id: "changed-during-sync",
      localRunId: "changed-during-sync",
      status: "completed",
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
      synced: false,
      pendingSync: true,
      notes: "editado durante sync",
      updatedAt: "2999-01-01T00:00:00.000Z",
      distance: 750,
      duration: 260,
      date: "2026-06-05T10:00:00Z",
      path: [point(1), point(2), point(3)],
    });

    firestoreCommitBlocker.resolve();
    await firstSync;
    const [run] = await loadLocalRunHistory();

    expect(concurrent).toMatchObject({ skipped: true, reason: "already_syncing" });
    expect(run).toMatchObject({
      id: "changed-during-sync",
      remoteRunId: "changed-during-sync",
      notes: "editado durante sync",
      synced: false,
      pendingSync: true,
      syncStatus: "PENDING",
      offlineStatus: "PENDING_SYNC",
    });
    expect(run.trustedPath).toHaveLength(3);
  });
});
