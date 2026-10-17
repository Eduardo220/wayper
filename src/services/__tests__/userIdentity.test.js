import { beforeEach, expect, jest, test } from "@jest/globals";
const documents = new Map();
let serial = Promise.resolve();
const doc = jest.fn((db, ...parts) => parts.join("/"));
const snapshot = (ref) => ({ exists: () => documents.has(ref), data: () => documents.get(ref) });
const updateDoc = jest.fn(async (ref, data) => documents.set(ref, { ...documents.get(ref), ...data }));
const runTransaction = jest.fn((db, callback) => {
  const job = serial.then(async () => {
    const writes = [];
    const result = await callback({ get: async (ref) => snapshot(ref), set: (ref, data) => writes.push([ref, data]) });
    for (const [ref, data] of writes) documents.set(ref, data);
    return result;
  });
  serial = job.catch(() => {});
  return job;
});
jest.unstable_mockModule("../../firebaseConfig.js", () => ({ db: {} }));
jest.unstable_mockModule("firebase/firestore", () => ({
  doc, getDoc: jest.fn(async (ref) => snapshot(ref)), updateDoc, runTransaction,
  collection: (db, name) => name, query: (collection, where) => ({ collection, where }), where: (key, op, value) => value,
  getDocs: jest.fn(async ({ where: username }) => ({ empty: ![...documents].some(([key, value]) => key.startsWith("users/") && value.username === username) })),
  serverTimestamp: () => "NOW",
}));
const { createUserIfNotExists, updateUser } = await import("../userService.js");
beforeEach(() => { documents.clear(); jest.clearAllMocks(); serial = Promise.resolve(); });

test("initial creation requires a nonempty normalized username, reserves it atomically and preserves existing usernames", async () => {
  const first = await createUserIfNotExists({ uid: "u1", displayName: "Initial" }, "My.Name");
  expect(first.username).toBe("my.name");
  expect(documents.get("usernames/my.name")).toEqual({ uid: "u1" });
  expect(documents.get("users/u1").username).toBe("my.name");
  expect(documents.has("users/u1/runs/_init")).toBe(true);
  expect((await createUserIfNotExists({ uid: "u1" }, "different")).username).toBe("my.name");
});

test("concurrent users cannot reserve the same username; legacy users also retain their names", async () => {
  documents.set("users/legacy", { username: "legacy_name" });
  const legacy = await createUserIfNotExists({ uid: "u3" }, "legacy_name");
  expect(legacy.username).not.toBe("legacy_name");
  const [a, b] = await Promise.all([createUserIfNotExists({ uid: "a" }, "parallel"), createUserIfNotExists({ uid: "b" }, "parallel")]);
  expect(a.username).not.toBe(b.username);
  expect(documents.get(`usernames/${a.username}`).uid).toBe("a");
  expect(documents.get(`usernames/${b.username}`).uid).toBe("b");
  expect(documents.get("users/legacy").username).toBe("legacy_name");
});

test("concurrent initializations of the same user retain the first identity", async () => {
  const [a, b] = await Promise.all([createUserIfNotExists({ uid: "same" }, "first_name"), createUserIfNotExists({ uid: "same" }, "second_name")]);
  expect(a.username).toBe(b.username);
});

test("generic domain update rejects direct and dotted username changes before any write", async () => {
  for (const patch of [{ username: "changed" }, { "username.value": "changed" }]) await expect(updateUser("u1", patch)).rejects.toThrow("username_immutable");
  expect(updateDoc).not.toHaveBeenCalled();
  await updateUser("u1", { name: "New name" });
  expect(updateDoc).toHaveBeenCalledWith("users/u1", { name: "New name", lastActive: "NOW" });
});

test("reservation failure never creates an unreserved user", async () => {
  runTransaction.mockRejectedValueOnce(new Error("offline"));
  expect(await createUserIfNotExists({ uid: "fail" }, "fail_name")).toBeNull();
  expect(documents.has("users/fail")).toBe(false);
});

test("exhausted legacy names never fall back to an unchecked random username", async () => {
  const { getDocs } = await import("firebase/firestore");
  const previous = getDocs.getMockImplementation();
  getDocs.mockResolvedValue({ empty: false });
  try {
    await expect(createUserIfNotExists({ uid: "exhausted" }, "all_taken")).rejects.toThrow("username_unavailable");
    expect(documents.has("users/exhausted")).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  } finally { getDocs.mockImplementation(previous); }
});
