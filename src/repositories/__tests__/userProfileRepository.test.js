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

const FirestoreMock = {
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

jest.unstable_mockModule("../progressionRepository.js", () => ({
  getUserProgress: jest.fn(async () => ({
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
  })),
}));

const repository = await import("../userProfileRepository.js");

describe("userProfileRepository", () => {
  beforeEach(() => {
    remoteDoc = null;
    getDocShouldThrow = false;
    setDocShouldThrow = false;
    jest.clearAllMocks();
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
    expect(result.data.userDoc).toMatchObject({
      name: "Remote User",
      avatar: "https://cdn/remote.jpg",
    });
  });

  test("Firestore falhando retorna cache local controlado", async () => {
    getDocShouldThrow = true;

    const result = await repository.loadCurrentProfile();

    expect(result.source).toBe("local");
    expect(result.error).toBeTruthy();
    expect(result.data.profile.displayName).toBe("Local User");
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
      avatar: "file://avatar.jpg",
      isPrivate: true,
      profileVisibility: "private",
    }));
    expect(result.source).toBe("local");
    expect(result.syncStatus).toBe("SYNC_FAILED");
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
