import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();

let currentUser = {
  uid: "user-1",
  displayName: "Ana Wayper",
  email: "ana@example.com",
  photoURL: null,
};

const getActiveRunSnapshot = jest.fn(async () => null);
const loadHomeFeedData = jest.fn(async () => ({
  activities: [],
  friends: [],
  summary: {},
  streakDays: 0,
  source: "empty",
  usedFallback: true,
}));
const listRuns = jest.fn(async () => ({ data: [], source: "local", error: null }));
const loadCurrentProfile = jest.fn(async () => ({
  data: {
    profile: { uid: "user-1", displayName: "Ana Wayper", username: "ana" },
    userDoc: { uid: "user-1", name: "Ana Wayper", username: "ana" },
  },
  source: "local",
  error: null,
}));

const ACTIVE_STATUSES = new Set(["ACTIVE", "RUNNING", "PAUSED", "RECOVERING", "FINISHING"]);

function statusOf(run = {}) {
  return String(run.status || run.runStatus || run.state || run.offlineStatus || "").toUpperCase();
}

function modeOf(run = {}) {
  const raw = String(run.mode || run.type || "free").toLowerCase();
  return raw === "zones" || raw === "zone" || raw === "territory" ? "zones" : "free";
}

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: jest.fn(async (key) => storage.get(key) ?? null),
    setItem: jest.fn(async (key, value) => storage.set(key, value)),
    removeItem: jest.fn(async (key) => storage.delete(key)),
  },
}));

jest.unstable_mockModule("../../firebaseConfig.js", () => ({
  auth: {
    get currentUser() {
      return currentUser;
    },
  },
}));

jest.unstable_mockModule("../../services/runTracking/activeRunTrackingService.js", () => ({
  default: {
    getActiveRunSnapshot,
  },
}));

jest.unstable_mockModule("../../services/feed/feedService.js", () => ({
  loadHomeFeedData,
}));

jest.unstable_mockModule("../runRepository.js", () => ({
  default: {
    list: listRuns,
  },
  list: listRuns,
}));

jest.unstable_mockModule("../userProfileRepository.js", () => ({
  loadCurrentProfile,
}));

jest.unstable_mockModule("../profileStats.js", () => ({
  getRunDistanceMeters: (run = {}) => Math.max(0, Number(run.distanceMeters ?? run.distance ?? 0)),
  getRunDurationSeconds: (run = {}) => Math.max(0, Number(run.durationSeconds ?? run.duration ?? 0)),
  getRunMode: modeOf,
  getRunTimestamp: (run = {}) => new Date(run.finishedAt || run.endedAt || run.date || run.createdAt || 0).getTime() || 0,
  getTerritoryAreaFromRun: (run = {}) => modeOf(run) === "zones" ? Math.max(0, Number(run.areaM2 ?? run.area ?? 0)) : 0,
  isFinishedRunForStats: (run = {}) => !!run && !ACTIVE_STATUSES.has(statusOf(run)),
  recordBelongsToUser: (record = {}, userId = "offline") => {
    const owner = record.userId || record.ownerId || record.uid || null;
    return !owner || String(owner) === String(userId);
  },
}));

const repository = await import("../socialHomeRepository.js");

const finishedRun = (patch = {}) => ({
  id: "run-1",
  localRunId: "run-1",
  userId: "user-1",
  status: "completed",
  mode: "free",
  distanceMeters: 3200,
  durationSeconds: 1500,
  finishedAt: "2026-06-15T10:00:00.000Z",
  ...patch,
});

describe("socialHomeRepository", () => {
  beforeEach(() => {
    storage.clear();
    currentUser = {
      uid: "user-1",
      displayName: "Ana Wayper",
      email: "ana@example.com",
      photoURL: null,
    };
    jest.clearAllMocks();
    getActiveRunSnapshot.mockResolvedValue(null);
    loadHomeFeedData.mockResolvedValue({
      activities: [],
      friends: [],
      summary: {},
      streakDays: 0,
      source: "empty",
      usedFallback: true,
    });
    listRuns.mockResolvedValue({ data: [], source: "local", error: null });
    loadCurrentProfile.mockResolvedValue({
      data: {
        profile: { uid: "user-1", displayName: "Ana Wayper", username: "ana" },
        userDoc: { uid: "user-1", name: "Ana Wayper", username: "ana" },
      },
      source: "local",
      error: null,
    });
  });

  test("lista apenas corridas finalizadas elegiveis para story", async () => {
    getActiveRunSnapshot.mockResolvedValue({ activeRunId: "active-1", status: "RUNNING" });
    listRuns.mockResolvedValue({
      data: [
        finishedRun({ id: "run-ok", localRunId: "run-ok" }),
        finishedRun({
          id: "run-zone",
          localRunId: "run-zone",
          mode: "zones",
          areaM2: 700,
          finishedAt: "2026-06-16T10:00:00.000Z",
        }),
        finishedRun({ id: "active-1", localRunId: "active-1", status: "RUNNING" }),
        finishedRun({ id: "finishing-1", localRunId: "finishing-1", status: "FINISHING" }),
        finishedRun({ id: "other-user", localRunId: "other-user", userId: "user-2" }),
      ],
      source: "local",
      error: null,
    });

    const result = await repository.listMyRecentRunsForStory({ userId: "user-1" });

    expect(result.data.map((run) => run.id)).toEqual(["run-zone", "run-ok"]);
    expect(result.data[0]).toMatchObject({
      mode: "zones",
      territoryAreaM2: 700,
      alreadyInStory: false,
    });
  });

  test("cria story local pendente e bloqueia duplicata da mesma corrida", async () => {
    listRuns.mockResolvedValue({
      data: [finishedRun({ id: "run-story", localRunId: "run-story" })],
      source: "local",
      error: null,
    });

    const first = await repository.createRunStoryFromRun({ id: "run-story" }, {
      now: new Date("2026-06-16T12:00:00.000Z"),
    });
    const second = await repository.createRunStoryFromRun({ id: "run-story" }, {
      now: new Date("2026-06-16T12:01:00.000Z"),
    });
    const rawStories = JSON.parse(storage.get(repository.RUN_STORIES_STORAGE_KEY));

    expect(first.data).toMatchObject({
      runLocalId: "run-story",
      syncStatus: repository.STORY_SYNC_STATUS.PENDING_SYNC,
      source: repository.SOCIAL_HOME_SOURCE.LOCAL,
    });
    expect(second.duplicate).toBe(true);
    expect(rawStories).toHaveLength(1);
  });

  test("compoe stories locais, amigos reais e feed remoto sem promover demo", async () => {
    storage.set(repository.RUN_STORIES_STORAGE_KEY, JSON.stringify([
      {
        localId: "story-1",
        userId: "user-1",
        actor: { id: "user-1", name: "Ana Wayper" },
        createdAt: "2026-06-16T10:00:00.000Z",
        runSummary: finishedRun({ id: "run-story", localRunId: "run-story" }),
        syncStatus: "PENDING_SYNC",
        source: "local",
      },
    ]));
    loadHomeFeedData.mockResolvedValue({
      source: "remote",
      usedFallback: false,
      friends: [
        { id: "friend-1", friendUid: "friend-1", name: "Bia", hasPresence: true, isActive: true },
        { id: "mock-lucas", friendUid: "mock-lucas", name: "Lucas", source: "demo", demo: true },
      ],
      activities: [
        {
          id: "activity-1",
          type: "run",
          userId: "friend-1",
          userName: "Bia",
          createdAt: "2026-06-16T11:00:00.000Z",
          distanceKm: 4.2,
          durationSeconds: 1800,
        },
        {
          id: "demo-1",
          type: "run",
          source: "demo",
          demo: true,
        },
      ],
      summary: {},
      streakDays: 0,
    });

    const result = await repository.loadSocialHome();

    expect(loadHomeFeedData).toHaveBeenCalledWith(expect.objectContaining({ allowDemo: false }));
    expect(result.stories).toHaveLength(1);
    expect(result.pendingStoryUploads).toHaveLength(1);
    expect(result.friends).toHaveLength(1);
    expect(result.friends[0]).toMatchObject({ id: "friend-1", hasPresence: true, isActive: true });
    expect(result.feedItems.map((item) => item.id)).toEqual(["activity-1", "story-1"]);
    expect(result.feedItems.some((item) => item.demo === true || item.source === "demo")).toBe(false);
    expect(result.source).toBe(repository.SOCIAL_HOME_SOURCE.REMOTE);
  });
});
