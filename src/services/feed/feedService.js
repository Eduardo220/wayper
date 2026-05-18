import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import sync from "../../utils/sync";
import { getMutedFeedAuthorIds } from "./feedPostActionsService";

const FEED_CACHE_KEY = "wayper_home_feed_cache_v1";
const FRIENDS_CACHE_KEY = "wayper_home_friends_cache_v1";
const DEFAULT_LIMIT = 20;
const ACTIVE_WINDOW_MS = 1000 * 60 * 60 * 24;
const DEFAULT_AVATAR = "https://i.pravatar.cc/160?u=wayper_default";

const DEV_MOCK_FRIENDS = [
  { id: "mock-lucas", friendUid: "mock-lucas", name: "Lucas", avatar: "https://i.pravatar.cc/160?u=lucas-wayper", isActive: true },
  { id: "mock-marina", friendUid: "mock-marina", name: "Marina", avatar: "https://i.pravatar.cc/160?u=marina-wayper", isActive: true },
  { id: "mock-rafael", friendUid: "mock-rafael", name: "Rafael", avatar: "https://i.pravatar.cc/160?u=rafael-wayper", isActive: false },
  { id: "mock-juliana", friendUid: "mock-juliana", name: "Juliana", avatar: "https://i.pravatar.cc/160?u=juliana-wayper", isActive: true },
  { id: "mock-pedro", friendUid: "mock-pedro", name: "Pedro", avatar: "https://i.pravatar.cc/160?u=pedro-wayper", isActive: false },
  { id: "mock-ana", friendUid: "mock-ana", name: "Ana", avatar: "https://i.pravatar.cc/160?u=ana-wayper", isActive: true },
];

const DEV_MOCK_ACTIVITIES = [
  {
    id: "mock-run-1",
    type: "run",
    userId: "mock-lucas",
    userName: "Lucas",
    userAvatar: "https://i.pravatar.cc/160?u=lucas-wayper",
    createdAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    distanceKm: 8.42,
    durationSeconds: 2672,
    avgPaceSecondsPerKm: 317,
    elevationMeters: 64,
    areaM2: null,
    path: [
      { latitude: -23.561, longitude: -46.656 },
      { latitude: -23.558, longitude: -46.651 },
      { latitude: -23.555, longitude: -46.653 },
      { latitude: -23.552, longitude: -46.648 },
      { latitude: -23.549, longitude: -46.651 },
    ],
    polygon: null,
    likesCount: 18,
    commentsCount: 4,
    isRecord: true,
  },
  {
    id: "mock-zone-1",
    type: "zone",
    userId: "mock-marina",
    userName: "Marina",
    userAvatar: "https://i.pravatar.cc/160?u=marina-wayper",
    createdAt: new Date(Date.now() - 1000 * 60 * 88).toISOString(),
    distanceKm: 5.14,
    durationSeconds: 1945,
    avgPaceSecondsPerKm: 378,
    elevationMeters: null,
    areaM2: 7650,
    path: null,
    polygon: [
      { latitude: -23.559, longitude: -46.662 },
      { latitude: -23.554, longitude: -46.659 },
      { latitude: -23.553, longitude: -46.653 },
      { latitude: -23.558, longitude: -46.650 },
      { latitude: -23.563, longitude: -46.655 },
    ],
    likesCount: 27,
    commentsCount: 8,
    isRecord: false,
  },
];

const safeDevWarn = (...args) => {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn("[homeFeed]", ...args);
  }
};

const chunk = (list = [], size = 10) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const uniq = (list = []) => Array.from(new Set(list.filter(Boolean)));

const toNumber = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function toDate(value) {
  try {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value?.toDate === "function") {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === "object" && Number.isFinite(value.seconds)) {
      return new Date(value.seconds * 1000);
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : toDate(value) || new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const getTimestamp = (item = {}, detail = {}) =>
  toDate(
    item.timestamp ||
      item.createdAt ||
      item.completedAt ||
      item.startedAt ||
      item.date ||
      detail.timestamp ||
      detail.createdAt ||
      detail.completedAt ||
      detail.startedAt ||
      detail.date
  ) || new Date(0);

export function sanitizeCoords(coords = []) {
  if (!Array.isArray(coords)) return [];
  return coords
    .map((point) => {
      if (!point) return null;
      let latitude = Number(point.latitude ?? point.lat);
      let longitude = Number(point.longitude ?? point.lng ?? point.lon);

      if (Array.isArray(point)) {
        const a = Number(point[0]);
        const b = Number(point[1]);
        if (Number.isFinite(a) && Math.abs(a) <= 90 && Number.isFinite(b) && Math.abs(b) <= 180) {
          latitude = a;
          longitude = b;
        } else if (Number.isFinite(b) && Math.abs(b) <= 90 && Number.isFinite(a) && Math.abs(a) <= 180) {
          latitude = b;
          longitude = a;
        }
      }

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return {
        latitude,
        longitude,
        ...(point.timestamp != null ? { timestamp: point.timestamp } : {}),
      };
    })
    .filter(Boolean);
}

const normalizeDistanceKm = (item = {}, detail = {}) => {
  const explicitKm = item.distanceKm ?? item.km ?? detail.distanceKm ?? detail.km;
  const explicitKmValue = toNumber(explicitKm, null);
  if (explicitKmValue != null) return explicitKmValue || null;

  const rawMeters =
    item.distanceKm ??
    item.km ??
    detail.distanceKm ??
    detail.km ??
    item.distance ??
    item.distanceMeters ??
    item.totalMeters ??
    detail.distance ??
    detail.distanceMeters ??
    detail.totalMeters;

  const value = toNumber(rawMeters, 0);
  if (!value) return null;
  return value / 1000;
};

const normalizeDurationSeconds = (item = {}, detail = {}) => {
  const raw =
    item.durationSeconds ??
    item.timeSeconds ??
    detail.durationSeconds ??
    detail.timeSeconds ??
    item.duration ??
    item.elapsedTime ??
    detail.duration ??
    detail.elapsedTime;

  const value = toNumber(raw, 0);
  if (!value) return null;
  return value > 86400 ? Math.round(value / 1000) : Math.round(value);
};

const normalizePace = (item = {}, detail = {}, distanceKm = null, durationSeconds = null) => {
  const raw =
    item.avgPaceSecondsPerKm ??
    item.paceSecondsPerKm ??
    item.avgPace ??
    detail.avgPaceSecondsPerKm ??
    detail.paceSecondsPerKm ??
    detail.avgPace ??
    null;

  const explicit = toNumber(raw, null);
  if (explicit && explicit > 0) return Math.round(explicit);
  if (distanceKm && durationSeconds && distanceKm > 0) return Math.round(durationSeconds / distanceKm);
  return null;
};

const getArea = (item = {}, detail = {}) =>
  toNumber(item.areaM2 ?? item.area ?? detail.areaM2 ?? detail.area, null);

const getLikesCount = (item = {}) => {
  const count = toNumber(item.likesCount ?? item.likeCount, null);
  if (count != null) return count;
  if (Array.isArray(item.likes)) return item.likes.length;
  return 0;
};

const getCommentsCount = (item = {}) => {
  const count = toNumber(item.commentsCount ?? item.commentCount, null);
  if (count != null) return count;
  if (Array.isArray(item.comments)) return item.comments.length;
  return 0;
};

const getDisplayName = (profile = {}, fallback = "Atleta Wayper") =>
  profile.name ||
  profile.displayName ||
  profile.username ||
  profile.email?.split("@")?.[0] ||
  fallback;

const getAvatar = (profile = {}, uid = "wayper") =>
  profile.photoURL || profile.avatar || profile.userAvatar || `${DEFAULT_AVATAR}_${uid}`;

const isRecent = (value) => {
  const date = toDate(value);
  if (!date) return false;
  return Date.now() - date.getTime() <= ACTIVE_WINDOW_MS;
};

const inferType = (item = {}, detail = {}) => {
  const polygon = sanitizeCoords(
    item.polygon ||
      item.coords ||
      item.zoneCoords ||
      item.zone?.coords ||
      detail.polygon ||
      detail.coords ||
      detail.zoneCoords ||
      detail.zone?.coords ||
      []
  );
  const area = getArea(item, detail);
  const mode = String(item.mode || detail.mode || "").toLowerCase();
  const rawType = String(item.type || detail.type || "").toLowerCase();

  if (rawType === "zone" || mode === "zones" || polygon.length >= 3 || Number(area || 0) > 0) {
    return "zone";
  }

  return "run";
};

async function getJsonCache(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function setJsonCache(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

async function fetchFriendIds(uid) {
  if (!uid) return [];
  const snapshot = await getDocs(collection(db, "users", uid, "friends"));
  return uniq(
    snapshot.docs.map((item) => {
      const data = item.data() || {};
      return data.friendId || data.uid || data.userId || data.id;
    })
  );
}

async function fetchProfilesMap(userIds = []) {
  const ids = uniq(userIds);
  const entries = await Promise.all(
    ids.map(async (uid) => {
      try {
        const snapshot = await getDoc(doc(db, "users", uid));
        return [uid, snapshot.exists() ? { uid, ...snapshot.data() } : { uid }];
      } catch {
        return [uid, { uid }];
      }
    })
  );
  return new Map(entries);
}

async function fetchDocPair(collectionName, id) {
  if (!id) return null;
  try {
    const snapshot = await getDoc(doc(db, collectionName, id));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch {
    return null;
  }
}

async function fetchUserDocPair(uid, collectionName, id) {
  if (!uid || !id) return null;
  try {
    const snapshot = await getDoc(doc(db, "users", uid, collectionName, id));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch {
    return null;
  }
}

async function hydrateActivity(activity) {
  const typeHint = inferType(activity);
  const runId = activity.runId || activity.run?.id || (typeHint === "run" ? activity.id : null);
  const zoneId = activity.zoneId || activity.zone?.id || (typeHint === "zone" ? activity.id : null);
  const userId = activity.userId || activity.uid;

  const [runDoc, userRunDoc, zoneDoc, userZoneDoc] = await Promise.all([
    runId ? fetchDocPair("runs", runId) : null,
    runId ? fetchUserDocPair(userId, "runs", runId) : null,
    zoneId ? fetchDocPair("zones", zoneId) : null,
    zoneId ? fetchUserDocPair(userId, "zones", zoneId) : null,
  ]);

  return {
    ...activity,
    __run: runDoc || userRunDoc || activity.run || null,
    __zone: zoneDoc || userZoneDoc || activity.zone || null,
  };
}

function normalizeActivity(item = {}, profilesMap = new Map(), currentUser = null) {
  const userId = item.userId || item.uid || item.__userId || currentUser?.uid || "offline";
  const type = inferType(item, item.__zone || item.__run || {});
  const detail = type === "zone" ? item.__zone || item.__run || {} : item.__run || {};
  const profile = profilesMap.get(userId) || {};
  const createdAt = getTimestamp(item, detail);
  const distanceKm = normalizeDistanceKm(item, detail);
  const durationSeconds = normalizeDurationSeconds(item, detail);
  const avgPaceSecondsPerKm = normalizePace(item, detail, distanceKm, durationSeconds);
  const polygon = sanitizeCoords(
    item.polygon ||
      item.coords ||
      item.zoneCoords ||
      item.zone?.coords ||
      detail.polygon ||
      detail.coords ||
      detail.zoneCoords ||
      detail.zone?.coords ||
      []
  );
  const path = sanitizeCoords(item.path || item.route || detail.path || detail.route || []);
  const areaM2 = getArea(item, detail);

  return {
    id: String(item.id || item.runId || item.zoneId || `${type}_${userId}_${createdAt.getTime()}`),
    type,
    userId,
    userName: item.userName || item.actorName || getDisplayName(profile, userId === currentUser?.uid ? "Voce" : "Atleta Wayper"),
    userAvatar: item.userAvatar || item.actorAvatar || getAvatar(profile, userId),
    createdAt: createdAt.toISOString(),
    distanceKm,
    durationSeconds,
    avgPaceSecondsPerKm,
    elevationMeters: toNumber(item.elevationMeters ?? item.elevation ?? detail.elevationMeters ?? detail.elevation, null),
    areaM2: type === "zone" ? areaM2 || 0 : null,
    path: path.length >= 2 ? path : null,
    polygon: type === "zone" && polygon.length >= 3 ? polygon : null,
    likesCount: getLikesCount(item),
    commentsCount: getCommentsCount(item),
    isRecord: !!(item.isRecord || item.record || item.newRecord || detail.isRecord),
  };
}

async function fetchActivitiesForUsers(userIds = [], maxItems = DEFAULT_LIMIT) {
  const rows = [];
  for (const ids of chunk(userIds, 10)) {
    try {
      const q = query(
        collection(db, "activities"),
        where("userId", "in", ids),
        orderBy("timestamp", "desc"),
        firestoreLimit(maxItems)
      );
      const snapshot = await getDocs(q);
      snapshot.forEach((item) => {
        const data = item.data() || {};
        if (data.visibility === "private") return;
        rows.push({ id: item.id, ...data });
      });
    } catch (error) {
      safeDevWarn("activities friends query failed", error?.message || error);
    }
  }

  return rows;
}

async function fetchRecentUserRunsAndZones(userIds = [], maxItems = DEFAULT_LIMIT) {
  const rows = [];
  const cappedUserIds = userIds.slice(0, 12);

  await Promise.all(
    cappedUserIds.map(async (uid) => {
      const runQueries = [
        query(collection(db, "users", uid, "runs"), orderBy("createdAt", "desc"), firestoreLimit(8)),
        query(collection(db, "users", uid, "runs"), orderBy("date", "desc"), firestoreLimit(8)),
      ];
      const zoneQueries = [
        query(collection(db, "users", uid, "zones"), orderBy("createdAt", "desc"), firestoreLimit(6)),
        query(collection(db, "users", uid, "zones"), orderBy("date", "desc"), firestoreLimit(6)),
      ];

      for (const q of runQueries) {
        try {
          const snapshot = await getDocs(q);
          snapshot.forEach((item) => rows.push({ id: item.id, ...item.data(), __userId: uid, type: "run" }));
          break;
        } catch {}
      }

      for (const q of zoneQueries) {
        try {
          const snapshot = await getDocs(q);
          snapshot.forEach((item) => rows.push({ id: item.id, ...item.data(), __userId: uid, type: "zone" }));
          break;
        } catch {}
      }
    })
  );

  return rows.slice(0, maxItems * 2);
}

async function fetchPublicActivities(maxItems = DEFAULT_LIMIT) {
  const rows = [];

  try {
    const q = query(collection(db, "activities"), orderBy("timestamp", "desc"), firestoreLimit(maxItems));
    const snapshot = await getDocs(q);
    snapshot.forEach((item) => {
      const data = item.data() || {};
      if (data.visibility === "private") return;
      rows.push({ id: item.id, ...data });
    });
  } catch (error) {
    safeDevWarn("public activities query failed", error?.message || error);
  }

  if (rows.length) return rows;

  const rootQueries = [
    {
      type: "run",
      queries: [
        query(collection(db, "runs"), orderBy("createdAt", "desc"), firestoreLimit(maxItems)),
        query(collection(db, "runs"), orderBy("date", "desc"), firestoreLimit(maxItems)),
      ],
    },
    {
      type: "zone",
      queries: [
        query(collection(db, "zones"), orderBy("createdAt", "desc"), firestoreLimit(maxItems)),
        query(collection(db, "zones"), orderBy("date", "desc"), firestoreLimit(maxItems)),
      ],
    },
  ];

  await Promise.all(
    rootQueries.map(async (entry) => {
      for (const q of entry.queries) {
        try {
          const snapshot = await getDocs(q);
          snapshot.forEach((item) => {
            const data = item.data() || {};
            if (data.visibility === "private") return;
            rows.push({ id: item.id, type: entry.type, ...data });
          });
          break;
        } catch (error) {
          safeDevWarn(`root ${entry.type} query failed`, error?.message || error);
        }
      }
    })
  );

  return rows;
}

async function loadLocalFallback(maxItems = DEFAULT_LIMIT) {
  try {
    const user = auth.currentUser;
    const profile = {
      uid: user?.uid || "offline",
      name: user?.displayName || user?.email?.split("@")?.[0] || "Voce",
      photoURL: user?.photoURL || null,
    };
    const profiles = new Map([[profile.uid, profile]]);
    const [runs, zones] = await Promise.all([sync.loadLocalRuns?.(), sync.loadLocalZones?.()]);
    const rows = [
      ...(Array.isArray(runs) ? runs.map((item) => ({ ...item, type: "run", __userId: profile.uid })) : []),
      ...(Array.isArray(zones) ? zones.map((item) => ({ ...item, type: "zone", __userId: profile.uid })) : []),
    ];
    return rows
      .map((item) => normalizeActivity(item, profiles, user))
      .sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt))
      .slice(0, maxItems);
  } catch {
    return [];
  }
}

function getActivityUserIds(rows = []) {
  return uniq(rows.map((item) => item.userId || item.uid || item.__userId));
}

async function normalizeRows(rows = [], maxItems = DEFAULT_LIMIT) {
  const currentUser = auth.currentUser;
  const hydrated = await Promise.all(rows.slice(0, maxItems * 2).map((item) => hydrateActivity(item)));
  const profilesMap = await fetchProfilesMap(getActivityUserIds(hydrated));
  return hydrated
    .map((item) => normalizeActivity(item, profilesMap, currentUser))
    .sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt))
    .filter((item) => item.userId !== currentUser?.uid || item.type === "zone" || item.type === "run")
    .slice(0, maxItems);
}

function buildSummary(activities = [], currentUid = null) {
  const now = new Date();
  const todayKey = localDateKey(now);
  let exploredKm = 0;
  let conqueredM2 = 0;

  activities.forEach((item) => {
    if (currentUid && item.userId === currentUid) return;
    const date = toDate(item.createdAt);
    if (!date || localDateKey(date) !== todayKey) return;
    exploredKm += Number(item.distanceKm || 0);
    if (item.type === "zone") conqueredM2 += Number(item.areaM2 || 0);
  });

  return {
    friendsExploredKm: exploredKm,
    friendsConqueredM2: conqueredM2,
  };
}

async function calculateStreak(uid) {
  if (!uid) return 0;
  const dates = new Set();

  const addDate = (value) => {
    const date = toDate(value);
    if (date) dates.add(localDateKey(date));
  };

  try {
    const localRuns = await sync.loadLocalRuns?.();
    if (Array.isArray(localRuns)) localRuns.forEach((run) => addDate(run.date || run.createdAt));
  } catch {}

  try {
    const q = query(collection(db, "users", uid, "runs"), orderBy("date", "desc"), firestoreLimit(80));
    const snapshot = await getDocs(q);
    snapshot.forEach((item) => addDate(item.data()?.date || item.data()?.createdAt));
  } catch {}

  if (!dates.size) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const todayKey = localDateKey(today);
  const yesterdayKey = localDateKey(yesterday);
  if (!dates.has(todayKey) && !dates.has(yesterdayKey)) return 0;

  let cursor = dates.has(todayKey) ? today : yesterday;
  let count = 0;

  while (dates.has(localDateKey(cursor))) {
    count += 1;
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() - 1);
  }

  return count;
}

export async function loadActiveFriends(uid) {
  if (!uid) return [];

  try {
    const friendIds = await fetchFriendIds(uid);
    const profiles = await fetchProfilesMap(friendIds);
    const friends = friendIds.map((friendUid) => {
      const profile = profiles.get(friendUid) || {};
      return {
        id: friendUid,
        friendUid,
        name: getDisplayName(profile, "Atleta"),
        avatar: getAvatar(profile, friendUid),
        isActive:
          profile.online === true ||
          profile.status?.state === "online" ||
          isRecent(profile.lastActiveAt || profile.lastSeen || profile.lastActivityAt || profile.lastUpdate),
      };
    });

    await setJsonCache(FRIENDS_CACHE_KEY, friends);
    if (friends.length) return friends;
    return typeof __DEV__ !== "undefined" && __DEV__ ? DEV_MOCK_FRIENDS : [];
  } catch (error) {
    safeDevWarn("friends fallback", error?.message || error);
    const cached = await getJsonCache(FRIENDS_CACHE_KEY, []);
    if (cached.length) return cached;
    return DEV_MOCK_FRIENDS;
  }
}

export async function loadHomeFeedData({ limit = DEFAULT_LIMIT } = {}) {
  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || null;
  let activities = [];
  let friends = [];
  let friendIds = [];
  let usedFallback = false;
  let mutedAuthorIds = new Set();

  if (uid) {
    try {
      mutedAuthorIds = new Set(await getMutedFeedAuthorIds(uid));
    } catch {}
  }

  const filterMutedAuthors = (items = []) =>
    (Array.isArray(items) ? items : []).filter((item) => !mutedAuthorIds.has(item.userId || item.uid || item.__userId));

  try {
    if (uid) {
      friendIds = await fetchFriendIds(uid);
      friends = await loadActiveFriends(uid);
    }

    let rows = friendIds.length ? await fetchActivitiesForUsers(friendIds, limit) : [];
    if (!rows.length && friendIds.length) {
      rows = await fetchRecentUserRunsAndZones(friendIds, limit);
    }

    if (!rows.length) {
      rows = await fetchPublicActivities(limit);
    }

    if (rows.length) {
      activities = filterMutedAuthors(await normalizeRows(rows, limit * 2)).slice(0, limit);
      await setJsonCache(FEED_CACHE_KEY, activities);
    }
  } catch (error) {
    usedFallback = true;
    safeDevWarn("load feed failed", error?.message || error);
  }

  if (!activities.length) {
    const cached = await getJsonCache(FEED_CACHE_KEY, []);
    if (cached.length) {
      activities = filterMutedAuthors(cached).slice(0, limit);
      usedFallback = true;
    }
  }

  if (!activities.length) {
    activities = filterMutedAuthors(await loadLocalFallback(limit * 2)).slice(0, limit);
    usedFallback = true;
  }

  if (!activities.length && typeof __DEV__ !== "undefined" && __DEV__) {
    activities = filterMutedAuthors(DEV_MOCK_ACTIVITIES).slice(0, limit);
    usedFallback = true;
  }

  if (!friends.length && typeof __DEV__ !== "undefined" && __DEV__) {
    friends = DEV_MOCK_FRIENDS;
  }

  const summary = buildSummary(activities, uid);
  const streakDays = await calculateStreak(uid);

  return {
    activities,
    friends,
    summary,
    streakDays,
    usedFallback,
  };
}

export function formatDistanceKm(value) {
  const number = Number(value || 0);
  return `${number.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} km`;
}

export function formatAreaM2(value) {
  const number = Math.max(0, Math.round(Number(value || 0)));
  return `${number.toLocaleString("pt-BR")} m²`;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatPace(secondsPerKm) {
  const pace = Number(secondsPerKm);
  if (!Number.isFinite(pace) || pace <= 0) return "-- /km";
  const total = Math.round(pace);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}’${String(seconds).padStart(2, "0")}’’ /km`;
}

export function formatActivityDate(value) {
  const date = toDate(value);
  if (!date) return "";

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (dateOnly.getTime() === today.getTime()) return `Hoje às ${time}`;
  if (dateOnly.getTime() === yesterday.getTime()) return `Ontem às ${time}`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default {
  loadHomeFeedData,
  loadActiveFriends,
  formatDistanceKm,
  formatAreaM2,
  formatDuration,
  formatPace,
  formatActivityDate,
  sanitizeCoords,
  toDate,
};
