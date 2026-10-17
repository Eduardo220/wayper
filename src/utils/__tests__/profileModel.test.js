import { expect, test } from "@jest/globals";
import { formatArea, formatDate, formatDuration, normalizeProfile, normalizeProfileUserId, parseProfileLink, profileLink, publicProfileRun } from "../profileModel.js";

test("self resolves current user; explicit ID and legacy aliases resolve the same public identity", () => {
  expect(normalizeProfileUserId({}, "me")).toEqual({ userId: "me", own: true, invalid: false });
  for (const key of ["userId", "playerId", "friendId"]) expect(normalizeProfileUserId({ [key]: " other " }, "me")).toEqual({ userId: "other", own: false, invalid: false });
});
test.each(["", " ", "/", "a/b", ".", "..", 123, null, "x\ny", "x".repeat(129)])("invalid ID %p never resolves self", (userId) => {
  expect(normalizeProfileUserId({ userId }, "me")).toMatchObject({ userId: null, own: false, invalid: true });
});
test("public normalization uses allowlist, hides email-derived identity and preserves unknown", () => {
  const profile = normalizeProfile({ username: "secret", displayName: "secret", email: "secret@example.com", phone: "123", address: "private", totalDistance: 1234, totalRuns: 2 }, { userId: "p", own: false });
  expect(profile).toMatchObject({ name: "Atleta Wayper", username: null, runs: 2, distance: 1234, level: null, zones: null, followers: null, following: null, league: null });
  expect(JSON.stringify(profile)).not.toMatch(/secret|email|phone|address|example/);
});
test("private public identity never leaks metrics or bio; own profile retains them", () => {
  const source = { name: "Real", isPrivate: true, bio: "secret bio", city: "secret city", cover: "file://private-cover.jpg", totalDistance: 4200, level: 3 };
  expect(normalizeProfile(source, { userId: "other", own: false })).toMatchObject({ restricted: true, bio: null, city: null, cover: null, distance: null, level: null });
  expect(normalizeProfile(source, { userId: "me", own: true })).toMatchObject({ restricted: false, distance: 4200, level: 3, cover: "file://private-cover.jpg" });
});
test("real records retain units and missing values remain unknown", () => {
  const profile = normalizeProfile({ longestRun: 21000, bestPace: 250, averagePace: 350, largestZone: 1000000, totalTime: 10000, totalXp: 550 }, { userId: "me", own: true });
  expect(profile).toMatchObject({ longestRun: 21000, bestPace: 250, averagePace: 350, largestZone: 1000000, totalTime: 10000, xp: 550 });
  expect(formatDuration(3661)).toBe("1:01:01");
  expect(formatDuration(null)).toBe("—");
  expect(formatArea(1000000)).toBe("1 km²");
});
test.each(["wayper", "wayper-dev"])("%s internal profile link round-trips", (scheme) => {
  expect(parseProfileLink(profileLink("uid+real", scheme))).toBe("uid+real");
});
test.each(["https://wayper.app/@someone", "wayper://profile/", "wayper://profile/a%2Fb", "wayper://profile/%00", "wayper://profile/%", "wayper://run/active"])("invalid or unrelated URL %p is rejected", (url) => {
  expect(parseProfileLink(url)).toBeNull();
});
test("public run projection drops all raw and nested GPS, exact locations and user metadata", () => {
  const run = publicProfileRun({ id: "run", distance: 5000, duration: 1800, date: "2026-10-14", path: [{ latitude: 1 }], coords: [1], routeSegments: [[1]], route: { rawPath: [1] }, zoneCoords: [1], user: { email: "secret" }, address: "home", territorySummary: { capturedCount: 3, geometry: [1] }, xp: 240 }, "p");
  expect(run).toMatchObject({ id: "public:p:run", distance: 5000, duration: 1800, pace: 360, zonesCaptured: 3, xp: 240, readOnly: true, pathHidden: true, path: [] });
  expect(JSON.stringify(run)).not.toMatch(/latitude|routeSegments|geometry|home|secret|rawPath/);
});

test("legacy timestamps become serializable detail dates; malformed optional fields cannot crash Text", () => {
  expect(publicProfileRun({ id: "r", date: { toDate: () => new Date("2026-10-14T10:00:00Z") } }, "p").date).toBe("2026-10-14T10:00:00.000Z");
  expect(formatDate({ toDate: () => { throw new Error("bad timestamp"); } })).toBe("Data indisponível");
  expect(normalizeProfile({ bio: {}, city: {}, avatar: {}, cover: {} }, { own: false })).toMatchObject({ bio: null, city: null, avatar: null, cover: null });
  expect(normalizeProfileUserId(null, "me").own).toBe(true);
});
