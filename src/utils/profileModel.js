import { calculatePaceSecondsPerKm, formatPaceFromSeconds } from "./pace.js";

export const PROFILE_TABS = [
  ["runs", "Corridas", "walk-outline"],
  ["territory", "Território", "map-outline"],
  ["achievements", "Conquistas", "medal-outline"],
];

export const knownNumber = (value) => value == null || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0
  ? null : Number(value);

export function normalizeProfileUserId(params = {}, currentUserId) {
  params = params && typeof params === "object" ? params : {};
  const field = ["userId", "playerId", "friendId"].find((key) => Object.hasOwn(params, key));
  const requested = field ? params[field] : undefined;
  const candidate = requested === undefined ? currentUserId : requested;
  const userId = typeof candidate === "string" ? candidate.trim() : "";
  const invalid = !userId || userId === "." || userId === ".." || userId.length > 128 || /[\s/\x00-\x1f]/.test(userId);
  return { userId: invalid ? null : userId, own: !invalid && userId === currentUserId, invalid };
}

export function normalizeProfile(data, identity) {
  if (!data || identity.invalid) return null;
  const privateProfile = data.isPrivate === true || data.profileVisibility === "private";
  const restricted = !identity.own && privateProfile;
  const emailPrefix = data.email?.split("@")[0];
  const safeName = (value) => typeof value === "string" && value !== emailPrefix && !value.includes("@") ? value : null;
  const number = (value) => restricted ? null : knownNumber(value);
  return {
    ...identity, restricted, privateProfile,
    name: safeName(data.name) || safeName(data.displayName) || safeName(data.username) || "Atleta Wayper",
    username: safeName(data.username), avatar: typeof (data.avatar || data.photoURL) === "string" ? data.avatar || data.photoURL : null,
    cover: !restricted && typeof data.cover === "string" ? data.cover : null,
    city: !restricted && typeof data.city === "string" ? data.city : null, bio: !restricted && typeof data.bio === "string" ? data.bio : null,
    level: number(data.level), xp: number(data.totalXp ?? data.globalPoints),
    progressPct: number(data.progressToNextLevelPct),
    distance: number(data.totalDistance ?? data.distance), runs: number(data.totalRuns ?? data.runs),
    zones: number(data.totalZones ?? data.zonesCaptured), area: number(data.totalArea ?? data.area),
    longestRun: number(data.longestRun), bestPace: number(data.bestPace), averagePace: number(data.averagePace),
    largestZone: number(data.largestZone), totalTime: number(data.totalTime),
    freeRuns: number(data.freeRuns), zoneRuns: number(data.zoneRuns), retakes: number(data.retakes),
    league: null, followers: null, following: null,
  };
}

export function profileLink(userId, scheme = typeof __DEV__ !== "undefined" && __DEV__ ? "wayper-dev" : "wayper") {
  const identity = normalizeProfileUserId({ userId });
  return identity.invalid ? null : `${scheme}://profile/${encodeURIComponent(identity.userId)}`;
}

export function parseProfileLink(url) {
  if (typeof url !== "string") return null;
  const match = /^wayper(?:-dev)?:\/\/profile\/([^/?#]+)(?:\?[^#]*)?$/i.exec(url);
  if (!match) return null;
  try { return normalizeProfileUserId({ userId: decodeURIComponent(match[1]) }).userId; }
  catch { return null; }
}

export const formatCount = (n) => n == null ? "—" : n.toLocaleString("pt-BR");
export const formatKm = (n) => n == null ? "—" : `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;
export const formatArea = (n) => n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km²` : `${Math.round(n).toLocaleString("pt-BR")} m²`;
export function formatDuration(seconds) {
  if (seconds == null) return "—";
  const total = Math.max(0, Math.round(seconds));
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
    .filter((_, i) => i || total >= 3600).map((n, i) => i ? String(n).padStart(2, "0") : n).join(":");
}
export const formatPace = (n) => n == null || n <= 0 ? "—" : `${formatPaceFromSeconds(n)}/km`;
function profileDate(value) {
  try {
    const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value || "");
    return Number.isNaN(date.getTime()) ? null : date;
  } catch { return null; }
}
export function formatDate(value) {
  return profileDate(value)?.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }) || "Data indisponível";
}

// Public activities expose aggregates only; nested legacy GPS/metadata never reach detail or share.
export function publicProfileRun(run, userId) {
  const distance = knownNumber(run.distanceMeters ?? run.distance);
  const duration = knownNumber(run.durationSeconds ?? run.duration);
  return {
    id: `public:${userId}:${run.id}`, userId, readOnly: true, pathHidden: true,
    date: profileDate(run.finishedAt || run.date || run.createdAt)?.toISOString() || null,
    title: typeof (run.title || run.name) === "string" ? run.title || run.name : null,
    distance, duration, area: knownNumber(run.areaM2 ?? run.area),
    pace: distance && duration ? calculatePaceSecondsPerKm(duration, distance / 1000) : null,
    xp: knownNumber(run.xpEarned ?? run.xp),
    zonesCaptured: knownNumber(run.territorySummary?.capturedCount ?? run.zonesCaptured),
    mode: run.mode, path: [], coords: [],
  };
}
