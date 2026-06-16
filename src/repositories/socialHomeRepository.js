import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "../firebaseConfig.js";
import activeRunTrackingService from "../services/runTracking/activeRunTrackingService.js";
import { loadHomeFeedData } from "../services/feed/feedService.js";
import { calculatePaceSecondsPerKm } from "../utils/pace.js";
import runRepository from "./runRepository.js";
import { loadCurrentProfile } from "./userProfileRepository.js";
import {
  getRunDistanceMeters,
  getRunDurationSeconds,
  getRunMode,
  getRunTimestamp,
  getTerritoryAreaFromRun,
  isFinishedRunForStats,
  recordBelongsToUser,
} from "./profileStats.js";

export const RUN_STORIES_STORAGE_KEY = "wayper_run_stories_v1";
export const ACTIVITY_FEED_CACHE_STORAGE_KEY = "wayper_activity_feed_cache_v1";
export const SOCIAL_HOME_SCHEMA_VERSION = 1;

export const SOCIAL_HOME_SOURCE = {
  REMOTE: "remote",
  CACHE: "cache",
  LOCAL: "local",
  EMPTY: "empty",
};

export const STORY_SYNC_STATUS = {
  PENDING_SYNC: "PENDING_SYNC",
  SYNCED: "SYNCED",
  SYNC_FAILED: "SYNC_FAILED",
  LOCAL_ONLY: "LOCAL_ONLY",
};

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(["ACTIVE", "RUNNING", "PAUSED", "RECOVERING", "FINISHING"]);

const ok = (data, meta = {}) => ({
  data,
  source: meta.source || SOCIAL_HOME_SOURCE.LOCAL,
  error: null,
  ...meta,
});

const fail = (error, fallback, meta = {}) => ({
  data: fallback,
  source: meta.source || SOCIAL_HOME_SOURCE.LOCAL,
  error,
  ...meta,
});

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function nowIso(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  return now.toISOString();
}

function resolveUserId(profileResult = null, options = {}) {
  return String(
    options.userId ||
      auth.currentUser?.uid ||
      profileResult?.data?.userDoc?.uid ||
      profileResult?.data?.userDoc?.id ||
      profileResult?.data?.profile?.uid ||
      "offline"
  );
}

function resolveDisplayProfile(profileResult = null) {
  const profile = profileResult?.data?.profile || {};
  const userDoc = profileResult?.data?.userDoc || {};
  return {
    uid: userDoc.uid || userDoc.id || profile.uid || auth.currentUser?.uid || "offline",
    name:
      userDoc.name ||
      userDoc.displayName ||
      profile.displayName ||
      profile.name ||
      auth.currentUser?.displayName ||
      "Atleta Wayper",
    username:
      userDoc.username ||
      profile.username ||
      auth.currentUser?.email?.split("@")?.[0] ||
      "wayper",
    avatar:
      userDoc.avatar ||
      userDoc.photoURL ||
      profile.avatar ||
      profile.photoURL ||
      auth.currentUser?.photoURL ||
      null,
  };
}

function runIdentityValues(run = {}) {
  return [run.localRunId, run.remoteRunId, run.id, run.runId, run.legacyId]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .map((value) => String(value));
}

function hasSameRunIdentity(left = {}, right = {}) {
  const ids = new Set(runIdentityValues(left));
  return runIdentityValues(right).some((id) => ids.has(id));
}

function sameRunLookup(run = {}, lookup = {}) {
  return hasSameRunIdentity(run, lookup);
}

function isActiveOrFinishingRun(run = {}) {
  const status = normalizeStatus(run.status || run.runStatus || run.state);
  const offlineStatus = normalizeStatus(run.offlineStatus || run.localStatus);
  return ACTIVE_STATUSES.has(status) || ACTIVE_STATUSES.has(offlineStatus);
}

function getRunTitle(run = {}) {
  const mode = getRunMode(run);
  return run.name || run.title || (mode === "zones" ? "Corrida por zonas" : "Corrida livre");
}

export function normalizeRunSummaryForStory(run = {}) {
  const distanceMeters = getRunDistanceMeters(run);
  const durationSeconds = getRunDurationSeconds(run);
  const mode = getRunMode(run);
  const territoryAreaM2 = mode === "zones" ? getTerritoryAreaFromRun(run) : 0;
  const finishedAt = toIso(
    run.finishedAt || run.endedAt || run.endTime || run.date || run.createdAt,
    new Date(getRunTimestamp(run) || Date.now()).toISOString()
  );

  return {
    id: run.id || run.localRunId || run.remoteRunId || run.runId || run.legacyId || null,
    localRunId: run.localRunId || null,
    remoteRunId: run.remoteRunId || null,
    runId: run.runId || null,
    title: getRunTitle(run),
    mode,
    type: mode === "zones" ? "zone" : "run",
    distanceMeters,
    durationSeconds,
    paceSecondsPerKm: calculatePaceSecondsPerKm(durationSeconds, distanceMeters / 1000) || null,
    territoryAreaM2,
    finishedAt,
    syncStatus: normalizeStatus(run.syncStatus || run.offlineStatus || (run.synced ? "SYNCED" : "LOCAL_ONLY")),
    source: SOCIAL_HOME_SOURCE.LOCAL,
    schemaVersion: SOCIAL_HOME_SCHEMA_VERSION,
  };
}

function normalizeFriend(friend = {}) {
  const id = String(friend.id || friend.friendUid || friend.uid || friend.userId || "");
  if (friend.demo === true || friend.source === "demo" || id.startsWith("mock-")) return null;

  const hasPresence = friend.hasPresence === true ||
    friend.online != null ||
    friend.lastActiveAt != null ||
    friend.lastSeen != null ||
    friend.lastActivityAt != null ||
    friend.status?.state != null;

  return {
    id,
    friendUid: friend.friendUid || friend.uid || friend.userId || friend.id || null,
    name: friend.name || friend.displayName || friend.username || "Atleta",
    username: friend.username || null,
    avatar: friend.avatar || friend.photoURL || null,
    hasPresence,
    isActive: hasPresence && friend.isActive === true,
    source: friend.source || SOCIAL_HOME_SOURCE.REMOTE,
  };
}

function normalizeFeedItem(item = {}, source = SOCIAL_HOME_SOURCE.REMOTE) {
  if (!item || item.demo === true || item.source === "demo") return null;
  const type = item.type === "zone" ? "zone" : "run";
  return {
    ...item,
    id: String(item.id || item.activityId || item.runId || item.zoneId || `${type}_${item.userId || "unknown"}_${item.createdAt || Date.now()}`),
    activityId: item.activityId || item.id || null,
    type,
    source: item.source || source,
    distanceKm: toNumber(item.distanceKm, 0),
    durationSeconds: toNumber(item.durationSeconds, 0),
    avgPaceSecondsPerKm: item.avgPaceSecondsPerKm == null ? null : toNumber(item.avgPaceSecondsPerKm, null),
    areaM2: type === "zone" ? toNumber(item.areaM2, 0) : null,
    createdAt: toIso(item.createdAt || item.timestamp || item.date, new Date().toISOString()),
  };
}

function normalizeStory(record = {}, fallback = {}) {
  const createdAt = toIso(record.createdAt, fallback.createdAt || new Date().toISOString());
  const expiresAt = record.expiresAt ? toIso(record.expiresAt, null) : null;
  const runSummary = record.runSummary || {};
  const userId = record.userId || fallback.userId || auth.currentUser?.uid || "offline";

  return {
    localId: String(record.localId || record.id || `story_${userId}_${createdAt}`),
    remoteId: record.remoteId || null,
    userId,
    actor: {
      id: record.actor?.id || userId,
      name: record.actor?.name || fallback.profile?.name || "Voce",
      avatar: record.actor?.avatar || fallback.profile?.avatar || null,
      username: record.actor?.username || fallback.profile?.username || null,
    },
    runLocalId: record.runLocalId || runSummary.localRunId || null,
    runRemoteId: record.runRemoteId || runSummary.remoteRunId || null,
    type: record.type || "run_card",
    visibility: record.visibility || "friends",
    createdAt,
    expiresAt,
    media: record.media || null,
    runSummary: normalizeRunSummaryForStory(runSummary),
    syncStatus: normalizeStatus(record.syncStatus || STORY_SYNC_STATUS.PENDING_SYNC),
    source: record.source || SOCIAL_HOME_SOURCE.LOCAL,
    schemaVersion: Number(record.schemaVersion || SOCIAL_HOME_SCHEMA_VERSION),
  };
}

function isStoryExpired(story = {}, options = {}) {
  if (!story.expiresAt) return false;
  const expiresAtMs = new Date(story.expiresAt).getTime();
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now;
}

async function readJsonList(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJsonList(key, value = []) {
  await AsyncStorage.setItem(key, JSON.stringify(Array.isArray(value) ? value : []));
}

export async function listLocalRunStories(options = {}) {
  try {
    const userId = String(options.userId || auth.currentUser?.uid || "offline");
    const profile = options.profile || null;
    const stories = (await readJsonList(RUN_STORIES_STORAGE_KEY))
      .map((item) => normalizeStory(item, { userId, profile }))
      .filter((story) => !isStoryExpired(story, options))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return ok(stories, { source: stories.length ? SOCIAL_HOME_SOURCE.LOCAL : SOCIAL_HOME_SOURCE.EMPTY });
  } catch (error) {
    return fail(error, [], { source: SOCIAL_HOME_SOURCE.EMPTY });
  }
}

export async function saveActivityFeedCache(items = []) {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => normalizeFeedItem(item, item.source || SOCIAL_HOME_SOURCE.CACHE))
    .filter(Boolean)
    .slice(0, 40);

  await writeJsonList(ACTIVITY_FEED_CACHE_STORAGE_KEY, normalized);
  return normalized;
}

export async function loadActivityFeedCache() {
  const cached = (await readJsonList(ACTIVITY_FEED_CACHE_STORAGE_KEY))
    .map((item) => normalizeFeedItem(item, SOCIAL_HOME_SOURCE.CACHE))
    .filter(Boolean);
  return ok(cached, { source: cached.length ? SOCIAL_HOME_SOURCE.CACHE : SOCIAL_HOME_SOURCE.EMPTY });
}

function buildStoryFeedItem(story = {}) {
  const summary = story.runSummary || {};
  const type = summary.type === "zone" || summary.mode === "zones" ? "zone" : "run";
  return normalizeFeedItem({
    id: story.localId,
    activityId: story.localId,
    type,
    userId: story.userId,
    userName: story.actor?.name || "Voce",
    userAvatar: story.actor?.avatar || null,
    createdAt: story.createdAt,
    distanceKm: toNumber(summary.distanceMeters, 0) / 1000,
    durationSeconds: summary.durationSeconds,
    avgPaceSecondsPerKm: summary.paceSecondsPerKm,
    areaM2: type === "zone" ? summary.territoryAreaM2 : null,
    likesCount: 0,
    commentsCount: 0,
    syncStatus: story.syncStatus,
    source: story.source || SOCIAL_HOME_SOURCE.LOCAL,
    storyLocalId: story.localId,
  }, story.source || SOCIAL_HOME_SOURCE.LOCAL);
}

function dedupeFeedItems(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item) continue;
    const key = String(item.id || item.activityId || "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export function normalizeRecentRunForStory(run = {}, stories = []) {
  const summary = normalizeRunSummaryForStory(run);
  const alreadyInStory = stories.some((story) => hasSameRunIdentity(story.runSummary, summary));
  return {
    ...summary,
    alreadyInStory,
    raw: run,
  };
}

export async function listMyRecentRunsForStory(options = {}) {
  try {
    const userId = String(options.userId || auth.currentUser?.uid || "offline");
    const activeRun = options.activeRun || await activeRunTrackingService.getActiveRunSnapshot?.().catch(() => null);
    const activeLookup = activeRun?.activeRunId ? { id: activeRun.activeRunId, localRunId: activeRun.activeRunId } : {};
    const stories = Array.isArray(options.stories) ? options.stories : (await listLocalRunStories({ userId })).data;
    const result = await runRepository.list();
    const runs = Array.isArray(result?.data) ? result.data : [];
    const recent = runs
      .filter((run) => isFinishedRunForStats(run))
      .filter((run) => !isActiveOrFinishingRun(run))
      .filter((run) => recordBelongsToUser(run, userId))
      .filter((run) => !sameRunLookup(run, activeLookup))
      .sort((a, b) => getRunTimestamp(b) - getRunTimestamp(a))
      .slice(0, options.limit || 12)
      .map((run) => normalizeRecentRunForStory(run, stories));

    return ok(recent, { source: recent.length ? SOCIAL_HOME_SOURCE.LOCAL : SOCIAL_HOME_SOURCE.EMPTY, error: result?.error || null });
  } catch (error) {
    return fail(error, [], { source: SOCIAL_HOME_SOURCE.EMPTY });
  }
}

export async function createRunStoryFromRun(runOrLookup = {}, options = {}) {
  const userId = String(options.userId || auth.currentUser?.uid || "offline");
  const profileResult = options.profileResult || await loadCurrentProfile().catch(() => null);
  const profile = options.profile || resolveDisplayProfile(profileResult);
  const now = options.now instanceof Date ? options.now : new Date();
  const lookup = runOrLookup?.raw ? runOrLookup.raw : runOrLookup;
  const runsResult = await runRepository.list();
  const runs = Array.isArray(runsResult?.data) ? runsResult.data : [];
  const run = runs.find((item) => sameRunLookup(item, lookup)) || (lookup?.distanceMeters || lookup?.distance ? lookup : null);

  if (!run || !isFinishedRunForStats(run) || isActiveOrFinishingRun(run)) {
    return fail(new Error("run_not_finished"), null, { source: SOCIAL_HOME_SOURCE.EMPTY, code: "RUN_NOT_FINISHED" });
  }

  if (!recordBelongsToUser(run, userId)) {
    return fail(new Error("run_not_owned"), null, { source: SOCIAL_HOME_SOURCE.EMPTY, code: "RUN_NOT_OWNED" });
  }

  const existing = await listLocalRunStories({ userId, profile, now });
  const runSummary = normalizeRunSummaryForStory(run);
  const duplicate = existing.data.find((story) => hasSameRunIdentity(story.runSummary, runSummary));
  if (duplicate && options.allowDuplicate !== true) {
    return ok(duplicate, {
      source: SOCIAL_HOME_SOURCE.LOCAL,
      duplicate: true,
      code: "DUPLICATE_STORY",
    });
  }

  const createdAt = nowIso({ now });
  const story = normalizeStory({
    localId: `story_${runSummary.id || runSummary.localRunId || "run"}_${now.getTime()}`,
    userId,
    actor: {
      id: userId,
      name: profile.name || "Voce",
      avatar: profile.avatar || null,
      username: profile.username || null,
    },
    runLocalId: runSummary.localRunId,
    runRemoteId: runSummary.remoteRunId,
    type: options.type || "run_card",
    visibility: options.visibility || "friends",
    createdAt,
    expiresAt: new Date(now.getTime() + STORY_TTL_MS).toISOString(),
    media: options.media || null,
    runSummary,
    syncStatus: STORY_SYNC_STATUS.PENDING_SYNC,
    source: SOCIAL_HOME_SOURCE.LOCAL,
    schemaVersion: SOCIAL_HOME_SCHEMA_VERSION,
  }, { userId, profile, createdAt });

  const allRaw = await readJsonList(RUN_STORIES_STORAGE_KEY);
  await writeJsonList(RUN_STORIES_STORAGE_KEY, [story, ...allRaw]);

  const cache = await loadActivityFeedCache();
  await saveActivityFeedCache(dedupeFeedItems([buildStoryFeedItem(story), ...(cache.data || [])]));

  return ok(story, {
    source: SOCIAL_HOME_SOURCE.LOCAL,
    duplicate: false,
    pendingSync: true,
  });
}

export async function loadSocialHome(options = {}) {
  const profileSettled = await Promise.allSettled([loadCurrentProfile()]);
  const profileResult = profileSettled[0].status === "fulfilled" ? profileSettled[0].value : null;
  const userId = resolveUserId(profileResult, options);
  const profile = resolveDisplayProfile(profileResult);

  const [activeResult, feedResult, storiesResult, runsResult, cacheResult] = await Promise.allSettled([
    activeRunTrackingService.getActiveRunSnapshot?.(),
    loadHomeFeedData({ limit: options.limit || 20, allowDemo: false }),
    listLocalRunStories({ userId, profile, now: options.now }),
    listMyRecentRunsForStory({ userId, profile, limit: 12 }),
    loadActivityFeedCache(),
  ]);

  const activeRun = activeResult.status === "fulfilled" ? activeResult.value : null;
  const feedData = feedResult.status === "fulfilled" ? feedResult.value : { activities: [], friends: [], source: SOCIAL_HOME_SOURCE.EMPTY, usedFallback: true };
  const stories = storiesResult.status === "fulfilled" ? storiesResult.value.data : [];
  const cacheItems = cacheResult.status === "fulfilled" ? cacheResult.value.data : [];
  const feedSource = feedData.source || (feedData.usedFallback ? SOCIAL_HOME_SOURCE.CACHE : SOCIAL_HOME_SOURCE.REMOTE);
  const remoteFeedItems = (Array.isArray(feedData.activities) ? feedData.activities : [])
    .map((item) => normalizeFeedItem(item, feedSource))
    .filter(Boolean);
  const feedItems = dedupeFeedItems([
    ...stories.map(buildStoryFeedItem).filter(Boolean),
    ...remoteFeedItems,
    ...(remoteFeedItems.length ? [] : cacheItems),
  ]);

  if (remoteFeedItems.length) {
    await saveActivityFeedCache(remoteFeedItems);
  }

  const myRecentRunsForStory = runsResult.status === "fulfilled" ? runsResult.value.data : [];
  const friends = (Array.isArray(feedData.friends) ? feedData.friends : [])
    .map(normalizeFriend)
    .filter((friend) => friend?.id);
  const pendingStoryUploads = stories.filter((story) => story.syncStatus === STORY_SYNC_STATUS.PENDING_SYNC);
  const source = remoteFeedItems.length
    ? feedSource
    : stories.length
      ? SOCIAL_HOME_SOURCE.LOCAL
      : cacheItems.length
        ? SOCIAL_HOME_SOURCE.CACHE
        : SOCIAL_HOME_SOURCE.EMPTY;

  return {
    source,
    updatedAt: new Date().toISOString(),
    userId,
    profile,
    activeRun: activeRun || null,
    stories,
    friends,
    friendActivity: friends,
    feedItems,
    myRecentRunsForStory,
    pendingStoryUploads,
    summary: feedData.summary || {},
    streakDays: feedData.streakDays || 0,
    states: {
      hasStories: stories.length > 0,
      hasFriends: friends.length > 0,
      hasFeed: feedItems.length > 0,
      hasRecentRunsForStory: myRecentRunsForStory.length > 0,
      usedFallback: !!feedData.usedFallback || source !== SOCIAL_HOME_SOURCE.REMOTE,
      isCache: source === SOCIAL_HOME_SOURCE.CACHE,
      isLocal: source === SOCIAL_HOME_SOURCE.LOCAL,
      isEmpty: source === SOCIAL_HOME_SOURCE.EMPTY,
      remoteUnavailable: !!feedData.usedFallback,
    },
    errors: {
      profile: profileSettled[0].status === "rejected" ? profileSettled[0].reason : profileResult?.error || null,
      activeRun: activeResult.status === "rejected" ? activeResult.reason : null,
      feed: feedResult.status === "rejected" ? feedResult.reason : null,
      stories: storiesResult.status === "rejected" ? storiesResult.reason : null,
      runs: runsResult.status === "rejected" ? runsResult.reason : runsResult.value?.error || null,
      cache: cacheResult.status === "rejected" ? cacheResult.reason : null,
    },
  };
}

export default {
  RUN_STORIES_STORAGE_KEY,
  ACTIVITY_FEED_CACHE_STORAGE_KEY,
  SOCIAL_HOME_SOURCE,
  STORY_SYNC_STATUS,
  loadSocialHome,
  listLocalRunStories,
  listMyRecentRunsForStory,
  createRunStoryFromRun,
  normalizeRunSummaryForStory,
  saveActivityFeedCache,
  loadActivityFeedCache,
};
