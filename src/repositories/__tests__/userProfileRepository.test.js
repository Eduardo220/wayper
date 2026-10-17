import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let remoteDoc = null;
let getDocShouldThrow = false;
let setDocShouldThrow = false;

const loadProfile = jest.fn(async () => ({
  uid: "user-1",
  displayName: "Local User",
  xp: 10,
}));
const saveProfile = jest.fn(async (patch) => ({
  uid: "user-1",
  displayName: patch.displayName || "Local User",
  ...patch,
}));
const fetchRemoteProfile = jest.fn(async () => null);
const getLocalProfileStats = jest.fn(async () => ({
  source: "local",
  userId: "user-1",
  hasLocalData: true,
  totalRuns: 1,
  freeRuns: 1,
  zoneRuns: 0,
  totalDistanceMeters: 1000,
  totalDurationSeconds: 600,
  totalTerritoryAreaM2: 0,
  totalZones: 0,
  longestRunMeters: 1000,
  largestZoneAreaM2: 0,
  bestPaceSecondsPerKm: 600,
  averagePaceSecondsPerKm: 600,
  totalXp: 110,
  xp: 10,
  level: 2,
  nextLevelXp: 150,
  progressToNextLevelPct: 7,
  achievementsUnlocked: 1,
  achievementsTotal: 8,
  pendingSyncCount: 0,
  failedSyncCount: 0,
  updatedAt: "2026-06-15T10:00:00.000Z",
  progress: {
    userId: "user-1",
    totalXp: 110,
    xp: 10,
    level: 2,
    nextLevelXp: 150,
    totalRuns: 1,
    totalDistanceMeters: 1000,
    totalDurationSeconds: 600,
    totalTerritoryAreaM2: 0,
    territoryCaptures: 0,
  },
}));

const FirestoreMock = {
  collection: jest.fn((...parts) => ({ path: parts.join("/") })),
  query: jest.fn((...parts) => parts),
  where: jest.fn((...parts) => parts),
  orderBy: jest.fn((...parts) => parts),
  limit: jest.fn((count) => count),
  startAfter: jest.fn((cursor) => cursor),
  getDocs: jest.fn(async () => ({ docs: [], empty: true })),
  doc: jest.fn((...parts) => ({ path: parts.join("/") })),
  getDoc: jest.fn(async () => {
    if (getDocShouldThrow) throw new Error("firestore offline");
    return {
      exists: () => !!remoteDoc,
      id: "user-1",
      data: () => remoteDoc,
    };
  }),
  onSnapshot: jest.fn((ref, onNext, onError) => {
    if (getDocShouldThrow) {
      onError?.(new Error("snapshot offline"));
    } else {
      onNext({
        exists: () => !!remoteDoc,
        id: "user-1",
        data: () => remoteDoc,
      });
    }
    return jest.fn();
  }),
  serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
  setDoc: jest.fn(async () => {
    if (setDocShouldThrow) throw new Error("write offline");
  }),
};

jest.unstable_mockModule("../../firebaseConfig.js", () => ({
  auth: { currentUser: { uid: "user-1", email: "local@example.com" } },
  db: {},
  storage: {},
}));

jest.unstable_mockModule("firebase/firestore", () => FirestoreMock);

jest.unstable_mockModule("firebase/storage", () => ({
  getDownloadURL: jest.fn(async () => "https://cdn/avatar.jpg"),
  ref: jest.fn(() => ({})),
  uploadBytes: jest.fn(async () => ({ ref: {} })),
}));

jest.unstable_mockModule("../../services/profile/profileService.js", () => ({
  DEFAULT_PROFILE: { uid: null, level: 1, xp: 0 },
  fetchRemoteProfile,
  loadProfile,
  saveProfile,
}));

jest.unstable_mockModule("../../utils/fileSystemLegacy.js", () => ({ FileSystemLegacy: {
  documentDirectory: "file://documents/", makeDirectoryAsync: jest.fn(async () => {}), copyAsync: jest.fn(async () => {}),
} }));

jest.unstable_mockModule("../profileStats.js", () => ({
  getLocalProfileStats,
}));

const repository = await import("../userProfileRepository.js");

test("profile history uses date ordering and opaque pagination cursor in the existing Firestore owner", async () => {
  const docs = Array.from({ length: 12 }, (_, i) => ({ id: `run-${i}`, data: () => ({ distance: 1000, userId: "wrong" }) }));
  FirestoreMock.getDocs.mockResolvedValueOnce({ docs, size: 12 });
  const first = await repository.listProfileRuns("public-user");
  expect(first.items[0].userId).toBe("public-user"); expect(first.nextCursor).toBe(docs[11]);
  FirestoreMock.getDocs.mockResolvedValueOnce({ docs: [], size: 0 });
  expect((await repository.listProfileRuns("public-user", first.nextCursor)).nextCursor).toBeNull();
  expect(FirestoreMock.startAfter).toHaveBeenLastCalledWith(docs[11]);
  expect(FirestoreMock.orderBy).toHaveBeenCalledWith("date", "desc");
});

test("bilateral friendship query matches friendId rather than assuming document id", async () => {
  FirestoreMock.getDocs.mockResolvedValueOnce({ empty: false });
  expect(await repository.hasProfileFriendship("viewer", "other")).toBe(true);
  expect(FirestoreMock.where).toHaveBeenCalledWith("friendId", "==", "other");
});

describe("userProfileRepository", () => {
  beforeEach(() => {
    remoteDoc = null;
    getDocShouldThrow = false;
    setDocShouldThrow = false;
    jest.clearAllMocks();
  });

  test("assinatura pública observa privacidade, remoção e falha sem reter o documento anterior", () => {
    remoteDoc = { name: "Remote User" };
    const callback = jest.fn(); const stop = repository.subscribePublicProfile("user-1", callback);
    const [, next, error] = FirestoreMock.onSnapshot.mock.lastCall;
    expect(callback.mock.lastCall[0].data.name).toBe("Remote User");
    next({ exists: () => true, id: "user-1", data: () => ({ isPrivate: true }) });
    expect(callback.mock.lastCall[0].data.isPrivate).toBe(true);
    next({ exists: () => false }); expect(callback.mock.lastCall[0].data).toBeNull();
    const denied = new Error("permission denied"); error(denied);
    expect(callback.mock.lastCall[0]).toMatchObject({ data: null, error: denied });
    stop(); expect(FirestoreMock.onSnapshot.mock.results.at(-1).value).toHaveBeenCalledTimes(1);
  });

  test("falha síncrona ao assinar perfil público não quebra a tela", () => {
    const error = new Error("invalid Firestore state");
    FirestoreMock.onSnapshot.mockImplementationOnce(() => { throw error; });
    const callback = jest.fn(); const stop = repository.subscribePublicProfile("user-1", callback);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ data: null, error }));
    expect(() => stop()).not.toThrow();
  });

  test("retorna perfil remoto quando Firestore responde", async () => {
    remoteDoc = {
      name: "Remote User",
      bio: "bio",
      avatar: "https://cdn/remote.jpg",
      profileVisibility: "public",
    };

    const result = await repository.loadCurrentProfile();

    expect(result.source).toBe("remote");
    expect(result.data.profile.displayName).toBe("Local User");
    expect(result.data.profile).toMatchObject({
      totalRuns: 1,
      totalDistance: 1000,
      totalXp: 110,
      level: 2,
      achievementsUnlocked: 1,
    });
    expect(result.data.userDoc).toMatchObject({
      name: "Local User",
      avatar: "https://cdn/remote.jpg",
    });
  });

  test("remote profile without username never invents identity from email", async () => {
    remoteDoc = { email: "legacy@example.com", name: "Legacy" };
    const result = await repository.loadCurrentProfile();
    expect(result.data.userDoc.username).toBe("");
  });

  test("Firestore falhando retorna cache local controlado", async () => {
    getDocShouldThrow = true;

    const result = await repository.loadCurrentProfile();

    expect(result.source).toBe("local");
    expect(result.error).toBeTruthy();
    expect(result.data.profile.displayName).toBe("Local User");
    expect(result.data.profile.totalRuns).toBe(1);
    expect(result.data.userDoc).toBeNull();
  });

  test("update salva local mesmo quando Firestore falha", async () => {
    setDocShouldThrow = true;

    const result = await repository.updateCurrentUserProfile({
      name: "Novo Nome",
      bio: "offline bio",
      avatar: "file://avatar.jpg",
      isPrivate: true,
      profileVisibility: "private",
    });

    expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      displayName: "Novo Nome",
      bio: "offline bio",
      avatar: expect.stringMatching(/^file:\/\/documents\/avatars\//),
      isPrivate: true,
      profileVisibility: "private",
    }), { localOnly: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(FirestoreMock.setDoc.mock.calls.every(([, patch]) => !String(patch.avatar || "").startsWith("file://"))).toBe(true);
    expect(result.source).toBe("local");
    expect(result.syncStatus).toBe("SYNC_PENDING");
    expect(result.data.userDoc).toMatchObject({
      name: "Novo Nome",
      profileVisibility: "private",
    });
  });

  test("subscribe usa fallback local quando snapshot falha", async () => {
    getDocShouldThrow = true;
    const received = [];

    const unsubscribe = repository.subscribeCurrentUserProfile((result) => received.push(result));
    await Promise.resolve();
    await Promise.resolve();

    unsubscribe();
    expect(received[0]).toMatchObject({
      source: "local",
      data: {
        profile: expect.objectContaining({ displayName: "Local User" }),
        userDoc: null,
      },
    });
  });
});

test("common mutation rejects username, ignores external metrics and persists only approved fields", async () => {
  jest.clearAllMocks();
  await expect(repository.updateCurrentUserProfile({ username: "changed" })).rejects.toThrow("username_immutable");
  await expect(repository.updateCurrentUserProfile({ "username.value": "changed" })).rejects.toThrow("username_immutable");
  expect(saveProfile).not.toHaveBeenCalled();
  await repository.updateCurrentUserProfile({ name: "Nome", city: "Cidade", bio: "linha 1\nlinha 2", xp: 900, level: 99, totalRuns: 500, totalArea: 999, ranking: 1, achievements: ["fake"] });
  expect(saveProfile).toHaveBeenCalledWith({ displayName: "Nome", city: "Cidade", bio: "linha 1\nlinha 2" }, { localOnly: true });
  const remote = FirestoreMock.setDoc.mock.lastCall[1];
  expect(remote).toMatchObject({ name: "Nome", city: "Cidade", bio: "linha 1\nlinha 2" });
  for (const field of ["username", "xp", "level", "totalRuns", "totalArea", "ranking", "achievements"]) expect(remote).not.toHaveProperty(field);
});

test.each([true, false])("visibility uses the current paired contract: %p", async (value) => {
  jest.clearAllMocks();
  await repository.updatePrivacy(value);
  expect(saveProfile).toHaveBeenCalledWith({ isPrivate: value, profileVisibility: value ? "private" : "public" }, { localOnly: true });
});

test.each([{ name: " " }, { name: "a".repeat(51) }, { city: "a".repeat(51) }, { bio: "a".repeat(161) }])("invalid profile field fails before persistence %p", async (patch) => {
  jest.clearAllMocks();
  await expect(repository.updateCurrentUserProfile(patch)).rejects.toThrow("invalid_profile_");
  expect(saveProfile).not.toHaveBeenCalled();
});

test("cover persistence keeps a durable image and never mutates avatar or external metrics", async () => {
  jest.clearAllMocks();
  const result = await repository.updateCurrentUserProfile({ coverLocalUri: "file://picker-cover.jpg", xp: 999, totalRuns: 400 });
  expect(saveProfile).toHaveBeenCalledWith({ cover: expect.stringMatching(/^file:\/\/documents\/covers\//) }, { localOnly: true });
  expect(result.data.profile.cover).toMatch(/^file:\/\/documents\/covers\//);
  expect(saveProfile.mock.lastCall[0]).not.toHaveProperty("avatar");
});
