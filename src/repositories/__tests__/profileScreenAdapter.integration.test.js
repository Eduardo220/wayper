import { playerProfilePreviewData } from "../../screens/ranking/__fixtures__/playerProfilePreviewData.js";
import { beforeEach, expect, jest, test } from "@jest/globals";

const subscribePublicProfile = jest.fn(), loadCurrentProfile = jest.fn();
const listProfileRuns = jest.fn(), hasProfileFriendship = jest.fn();
const listRuns = jest.fn(), listTerritories = jest.fn(), listLegacyZones = jest.fn(), listEvents = jest.fn(), listAchievements = jest.fn(), fetchTerritoriesByOwnerId = jest.fn();
jest.unstable_mockModule("../userProfileRepository.js", () => ({ subscribePublicProfile, loadCurrentProfile, listProfileRuns, hasProfileFriendship }));
jest.unstable_mockModule("../runRepository.js", () => ({ default: { list: listRuns } }));
jest.unstable_mockModule("../territoryRepository.js", () => ({ default: { list: listTerritories, listLegacyZones, listEvents } }));
jest.unstable_mockModule("../achievementRepository.js", () => ({ listAchievements }));
jest.unstable_mockModule("../profileStats.js", () => ({ getRunTimestamp: (r) => Date.parse(r.date), isFinishedRunForStats: (r) => r.status !== "RUNNING", recordBelongsToUser: (r, id) => !r.userId || r.userId === id }));
jest.unstable_mockModule("../../services/territory/territoryStorageService.js", () => ({ fetchTerritoriesByOwnerId }));
const { subscribeProfileIdentity, loadProfileTab } = await import("../profileScreenAdapter.js");
const own = { userId: "me", own: true };
const publicProfile = { userId: "other", own: false };
beforeEach(() => {
  jest.clearAllMocks();
  subscribePublicProfile.mockImplementation((id, callback) => { callback({ data: { name: "Real", totalRuns: 5 } }); return jest.fn(); });
  listProfileRuns.mockResolvedValue({ items: [], nextCursor: null }); hasProfileFriendship.mockResolvedValue(false);
  listRuns.mockResolvedValue({ data: [] }); listTerritories.mockResolvedValue({ data: [] }); listLegacyZones.mockResolvedValue({ data: [] });
  listEvents.mockResolvedValue({ data: [] });
  listAchievements.mockResolvedValue([]); fetchTerritoriesByOwnerId.mockResolvedValue([]);
});
test("self loads canonical local-first repository without public request", async () => {
  loadCurrentProfile.mockResolvedValue({ data: { profile: { totalRuns: 4, totalXp: 500 }, userDoc: { name: "Eu" } } });
  const callback = jest.fn(); const stop = subscribeProfileIdentity(own, callback); await Promise.resolve();
  expect(callback.mock.calls[0][0].profile).toMatchObject({ own: true, name: "Eu", runs: 4, xp: 500 });
  expect(subscribePublicProfile).not.toHaveBeenCalled(); stop();
});
test("public profile uses remote subscription without current user or ranking fallback", () => {
  const callback = jest.fn(); const stop = subscribeProfileIdentity(publicProfile, callback);
  expect(callback.mock.calls[0][0].profile).toMatchObject({ name: "Real", own: false, runs: 5 });
  expect(loadCurrentProfile).not.toHaveBeenCalled();
  stop();
});
test("invalid identity performs no read", () => {
  const callback = jest.fn(); subscribeProfileIdentity({ invalid: true }, callback)();
  expect(callback).toHaveBeenCalledWith({ profile: null, error: null });
  expect(subscribePublicProfile).not.toHaveBeenCalled(); expect(loadCurrentProfile).not.toHaveBeenCalled();
});
test("public privacy changes, deletion and errors replace prior data; unsubscribe rejects late events", () => {
  let emit; const unsubscribe = jest.fn();
  subscribePublicProfile.mockImplementationOnce((id, callback) => { emit = callback; return unsubscribe; });
  const callback = jest.fn(); const stop = subscribeProfileIdentity(publicProfile, callback);
  emit({ data: { totalRuns: 5 } }); expect(callback.mock.lastCall[0].profile.runs).toBe(5);
  emit({ data: { isPrivate: true, totalRuns: 5 } }); expect(callback.mock.lastCall[0].profile).toMatchObject({ restricted: true, runs: null });
  emit({ data: null }); expect(callback.mock.lastCall[0].profile).toBeNull();
  const error = new Error("permission denied"); emit({ data: null, error });
  expect(callback.mock.lastCall[0]).toEqual({ profile: null, error });
  stop(); emit({ data: { totalRuns: 10 } }); expect(callback).toHaveBeenCalledTimes(4);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
test("own identity load rejects safely and cannot publish after unsubscribe", async () => {
  const error = new Error("local read failed"); loadCurrentProfile.mockRejectedValueOnce(error);
  const callback = jest.fn(); subscribeProfileIdentity(own, callback);
  await Promise.resolve(); await Promise.resolve();
  expect(callback).toHaveBeenCalledWith({ profile: null, error });
  loadCurrentProfile.mockResolvedValueOnce({ data: { profile: { name: "Eu" } } });
  callback.mockClear(); subscribeProfileIdentity(own, callback)(); await Promise.resolve();
  expect(callback).not.toHaveBeenCalled();
});
test("own history filters users and in-flight records and sorts newest first", async () => {
  listRuns.mockResolvedValue({ data: [{ id: "old", date: "2026-01-01" }, { id: "new", date: "2026-10-01", userId: "me" }, { id: "active", status: "RUNNING" }, { id: "foreign", userId: "other" }] });
  expect((await loadProfileTab(own, "runs", "me")).items.map((r) => r.id)).toEqual(["new", "old"]);
});
test("own territory merges legacy with current without duplication or foreign/deleted zones", async () => {
  listTerritories.mockResolvedValue({ data: [{ id: "current", userId: "me" }, { id: "deleted", status: "deleted" }, { id: "foreign", userId: "other" }] });
  listLegacyZones.mockResolvedValue({ data: [{ id: "current" }, { id: "legacy" }] });
  listEvents.mockResolvedValue({ data: [{ id: "event", userId: "me" }, { id: "other-event", userId: "other" }] });
  const result = await loadProfileTab(own, "territory", "me");
  expect(result.items.map((r) => r.id)).toEqual(["current", "legacy"]);
  expect(result.events.map((e) => e.id)).toEqual(["event"]);
});
test("own achievements preserve the entire existing catalog and progress", async () => {
  const catalog = [{ id: "one", progress: 10, target: 100 }, { id: "two", unlocked: true }];
  listAchievements.mockResolvedValue(catalog);
  expect((await loadProfileTab(own, "achievements", "me")).items).toEqual(catalog);
  expect(listAchievements).toHaveBeenCalledWith({ userId: "me" });
});
test("public achievements never read device-local catalog", async () => {
  expect((await loadProfileTab(publicProfile, "achievements", "me")).items).toEqual([]);
  expect(listAchievements).not.toHaveBeenCalled();
});
test.each(["runs", "territory", "achievements"])("private profile forbids all %s reads", async (tab) => {
  expect((await loadProfileTab({ ...publicProfile, restricted: true }, tab, "me")).items).toEqual([]);
  expect(listProfileRuns).not.toHaveBeenCalled(); expect(fetchTerritoriesByOwnerId).not.toHaveBeenCalled(); expect(listAchievements).not.toHaveBeenCalled();
});
test("public history applies visibility and strips exact location before returning", async () => {
  const docs = [
    { id: "allowed", data: () => ({ visibility: "public", path: [{ latitude: 1 }], email: "secret", distance: 1000 }) },
    { id: "private", data: () => ({ visibility: "private" }) },
    { id: "friends", data: () => ({ visibility: "followers" }) },
  ];
  listProfileRuns.mockResolvedValue({ items: docs.map(d => ({ ...d.data(), id: d.id })), nextCursor: null });
  const { items } = await loadProfileTab(publicProfile, "runs", "me");
  expect(items.map((r) => r.id)).toEqual(["public:other:allowed"]);
  expect(JSON.stringify(items)).not.toMatch(/latitude|secret/);
});
test("bilateral friend may see followers-visibility activity without fabricating follower counts", async () => {
  hasProfileFriendship.mockResolvedValue(true); listProfileRuns.mockResolvedValue({ items: [{ id: "r", visibility: "followers" }], nextCursor: null });
  expect((await loadProfileTab(publicProfile, "runs", "me")).items).toHaveLength(1);
});
test("public territory uses existing owner service and privacy sanitizer", async () => {
  fetchTerritoriesByOwnerId.mockResolvedValue([{ id: "public", ownerId: "other", visibility: "public", rawPath: [1], geometry: { type: "Polygon" } }, { id: "private", ownerId: "other", visibility: "private" }]);
  const { items } = await loadProfileTab(publicProfile, "territory", "me");
  expect(items).toHaveLength(1); expect(items[0].rawPath).toBeUndefined();
  expect(fetchTerritoriesByOwnerId).toHaveBeenCalledWith("other", { includeLocal: false, limitTo: 80 });
});
test("repository errors are returned with retained data rather than claimed as empty success", async () => {
  const error = new Error("offline"); listRuns.mockResolvedValue({ data: [], error });
  expect((await loadProfileTab(own, "runs", "me")).error).toBe(error);
});

test("public pagination preserves cursor even when visibility hides an entire page", async () => {
  const cursor = { id: "last" };
  listProfileRuns.mockResolvedValue({ items: [{ id: "hidden", visibility: "private" }], nextCursor: cursor });
  const first = await loadProfileTab(publicProfile, "runs", "me");
  expect(first.items).toEqual([]); expect(first.nextCursor).toBe(cursor);
  await loadProfileTab(publicProfile, "runs", "me", cursor);
  expect(listProfileRuns).toHaveBeenLastCalledWith("other", cursor);
});

test("existing DEV preview identity uses the canonical model without remote or local-owner reads", async () => {
  global.__DEV__ = true;
  try {
    const callback = jest.fn();
    subscribeProfileIdentity({ userId: "preview-km-0", own: false, preview: true }, callback, playerProfilePreviewData("preview-km-0"))();
    const profile = callback.mock.lastCall[0].profile;
    expect(profile).toMatchObject({ userId: "preview-km-0", own: false, preview: true, name: "Ryn", distance: 8020000, followers: null, following: null });
    for (const tab of ["runs", "territory", "achievements"]) expect((await loadProfileTab(profile, tab, "me")).items).toEqual([]);
    expect(subscribePublicProfile).not.toHaveBeenCalled(); expect(loadCurrentProfile).not.toHaveBeenCalled();
    expect(listProfileRuns).not.toHaveBeenCalled(); expect(hasProfileFriendship).not.toHaveBeenCalled();
    expect(listRuns).not.toHaveBeenCalled(); expect(fetchTerritoriesByOwnerId).not.toHaveBeenCalled(); expect(listAchievements).not.toHaveBeenCalled();
  } finally { delete global.__DEV__; }
});
test("preview requires DEV and the explicit route flag; unknown preview IDs never become real users", () => {
  const callback = jest.fn();
  global.__DEV__ = false;
  subscribeProfileIdentity({ userId: "preview-km-0", own: false, preview: true }, callback)();
  expect(callback.mock.lastCall[0].profile.preview).toBe(false);
  expect(subscribePublicProfile).toHaveBeenCalledTimes(1);
  global.__DEV__ = true;
  try {
    subscribeProfileIdentity({ userId: "preview-km-0", own: false }, callback)();
    expect(subscribePublicProfile).toHaveBeenCalledTimes(2);
    subscribeProfileIdentity({ userId: "preview-unknown", own: false, preview: true }, callback)();
    expect(callback.mock.lastCall[0].profile).toBeNull();
    expect(subscribePublicProfile).toHaveBeenCalledTimes(2);
  } finally { delete global.__DEV__; }
});
