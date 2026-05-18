import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { removeFriendship } from "../friends/friendsService";

const FEED_PREFS_CACHE_KEY = "wayper_feed_author_preferences_v1";

const getUid = () => auth.currentUser?.uid || null;
const getAuthorId = (activity = {}) => String(activity.userId || activity.uid || "").trim();
const getActivityId = (activity = {}) => String(activity.activityId || activity.id || activity.runId || activity.zoneId || "").trim();

async function getCachedPreferences(uid) {
  try {
    const raw = await AsyncStorage.getItem(`${FEED_PREFS_CACHE_KEY}:${uid || "offline"}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function setCachedPreferences(uid, value) {
  try {
    await AsyncStorage.setItem(`${FEED_PREFS_CACHE_KEY}:${uid || "offline"}`, JSON.stringify(value || {}));
  } catch {}
}

async function mergeCachedAuthorPreference(uid, authorUid, patch) {
  if (!uid || !authorUid) return;
  const cache = await getCachedPreferences(uid);
  cache[authorUid] = {
    ...(cache[authorUid] || {}),
    targetUid: authorUid,
    ...patch,
  };
  await setCachedPreferences(uid, cache);
}

export async function getMutedFeedAuthorIds(uid = getUid()) {
  if (!uid) return [];

  const muted = new Set();
  try {
    const snapshot = await getDocs(
      query(collection(db, "users", uid, "feedPreferences"), where("muted", "==", true))
    );
    snapshot.forEach((item) => {
      const data = item.data() || {};
      muted.add(data.targetUid || item.id);
    });
  } catch {}

  try {
    const cache = await getCachedPreferences(uid);
    Object.entries(cache || {}).forEach(([authorUid, pref]) => {
      if (pref?.muted) muted.add(pref.targetUid || authorUid);
    });
  } catch {}

  return Array.from(muted).filter(Boolean);
}

export async function getFeedAuthorPreference(authorUid, uid = getUid()) {
  if (!uid || !authorUid) return { notifyPosts: false, muted: false };

  try {
    const snapshot = await getDoc(doc(db, "users", uid, "feedPreferences", authorUid));
    if (snapshot.exists()) {
      const data = snapshot.data() || {};
      return {
        notifyPosts: !!data.notifyPosts,
        muted: !!data.muted,
      };
    }
  } catch {}

  const cache = await getCachedPreferences(uid);
  return {
    notifyPosts: !!cache?.[authorUid]?.notifyPosts,
    muted: !!cache?.[authorUid]?.muted,
  };
}

export async function setAuthorPostNotifications(activity, enabled = true) {
  const uid = getUid();
  const authorUid = getAuthorId(activity);
  if (!uid || !authorUid || uid === authorUid) return { ok: false, reason: "invalid_author" };

  const payload = {
    ownerUid: uid,
    targetUid: authorUid,
    targetName: activity?.userName || "Atleta Wayper",
    targetAvatar: activity?.userAvatar || null,
    notifyPosts: !!enabled,
    updatedAt: serverTimestamp(),
  };

  await mergeCachedAuthorPreference(uid, authorUid, { ...payload, updatedAt: new Date().toISOString() });

  try {
    await setDoc(doc(db, "users", uid, "feedPreferences", authorUid), payload, { merge: true });
  } catch {}

  return { ok: true, enabled: !!enabled };
}

export async function muteActivityAuthor(activity) {
  const uid = getUid();
  const authorUid = getAuthorId(activity);
  if (!uid || !authorUid || uid === authorUid) return { ok: false, reason: "invalid_author" };

  const payload = {
    ownerUid: uid,
    targetUid: authorUid,
    targetName: activity?.userName || "Atleta Wayper",
    targetAvatar: activity?.userAvatar || null,
    muted: true,
    mutedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await mergeCachedAuthorPreference(uid, authorUid, {
    ...payload,
    mutedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  try {
    await setDoc(doc(db, "users", uid, "feedPreferences", authorUid), payload, { merge: true });
  } catch {}

  return { ok: true, authorUid };
}

export async function removeFriendshipWithActivityAuthor(activity) {
  const uid = getUid();
  const authorUid = getAuthorId(activity);
  if (!uid || !authorUid || uid === authorUid) return { ok: false, reason: "invalid_author" };

  try {
    await removeFriendship(uid, authorUid);
    return { ok: true, authorUid };
  } catch {
    return { ok: false, reason: "remove_failed" };
  }
}

export async function reportActivity(activity, reason = "inappropriate") {
  const uid = getUid();
  const authorUid = getAuthorId(activity);
  const activityId = getActivityId(activity);
  if (!uid || !activityId) return { ok: false, reason: "invalid_activity" };

  const payload = {
    reporterUid: uid,
    activityId,
    activityType: activity?.type || "run",
    authorUid: authorUid || null,
    authorName: activity?.userName || null,
    reason,
    status: "open",
    createdAt: serverTimestamp(),
  };

  try {
    await Promise.all([
      addDoc(collection(db, "activity_reports"), payload),
      setDoc(doc(db, "users", uid, "activityReports", activityId), payload, { merge: true }),
    ]);
    return { ok: true };
  } catch {
    return { ok: false, reason: "report_failed" };
  }
}

export default {
  getMutedFeedAuthorIds,
  getFeedAuthorPreference,
  setAuthorPostNotifications,
  muteActivityAuthor,
  removeFriendshipWithActivityAuthor,
  reportActivity,
};
