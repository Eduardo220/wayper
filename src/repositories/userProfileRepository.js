import { auth, db, storage } from "../firebaseConfig.js";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  DEFAULT_PROFILE,
  fetchRemoteProfile,
  loadProfile,
  saveProfile,
} from "../services/profile/profileService.js";
import { getLocalProfileStats } from "./profileStats.js";

export const USER_PROFILE_SOURCE = {
  LOCAL: "local",
  REMOTE: "remote",
  CACHE: "cache",
};

const ok = (data, meta = {}) => ({
  data,
  source: meta.source || USER_PROFILE_SOURCE.LOCAL,
  loading: false,
  error: null,
  ...meta,
});

const fail = (error, fallback, meta = {}) => ({
  data: fallback,
  source: meta.source || USER_PROFILE_SOURCE.LOCAL,
  loading: false,
  error,
  ...meta,
});

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function normalizeUserDoc(uid, data = {}) {
  if (!uid && !data) return null;
  const id = uid || data.uid || data.id || null;
  if (!id) return null;

  return {
    ...data,
    id,
    uid: id,
    name: data.name || data.displayName || data.username || "",
    displayName: data.displayName || data.name || data.username || "",
    bio: data.bio || "",
    avatar: data.avatar || data.photoURL || null,
    photoURL: data.photoURL || data.avatar || null,
    username: data.username || data.email?.split("@")?.[0] || "",
    isPrivate: data.isPrivate === true || data.profileVisibility === "private",
    profileVisibility: data.profileVisibility || (data.isPrivate ? "private" : "public"),
  };
}

function resolveProfileUserId(user, profile = {}) {
  return String(user?.uid || profile?.uid || "offline");
}

function progressToProfilePatch(progress = {}, profile = {}, localStats = {}) {
  const hasProgress = Number(progress.totalRuns || 0) > 0 || Number(progress.totalXp || 0) > 0;
  const hasStats = localStats?.hasLocalData === true ||
    Number(localStats.totalRuns || 0) > 0 ||
    Number(localStats.totalDistanceMeters || localStats.totalDistance || 0) > 0 ||
    Number(localStats.totalTerritoryAreaM2 || localStats.totalArea || 0) > 0;
  if (!hasProgress && !hasStats) {
    return {
      progress,
      localStats,
      achievementsUnlocked: Number(localStats.achievementsUnlocked ?? profile.achievementsUnlocked ?? 0),
      achievementsTotal: Number(localStats.achievementsTotal ?? profile.achievementsTotal ?? 0),
      recentAchievements: Array.isArray(localStats.recentAchievements) ? localStats.recentAchievements : [],
      pendingSyncCount: Number(localStats.pendingSyncCount ?? 0),
      failedSyncCount: Number(localStats.failedSyncCount ?? 0),
      localProfileSource: "local",
      localFirstProgress: true,
      lastUpdate: localStats.updatedAt || progress.updatedAt || profile.lastUpdate || null,
    };
  }

  return {
    progress,
    localStats,
    totalXp: Number(progress.totalXp || 0),
    xp: Number(progress.xp || 0),
    level: Number(progress.level || 1),
    nextLevelXp: Number(progress.nextLevelXp || DEFAULT_PROFILE.nextLevelXp || 1000),
    progressToNextLevel: Number(progress.progressToNextLevel || 0),
    progressToNextLevelPct: Number(progress.progressToNextLevelPct || 0),
    totalRuns: Number(localStats.totalRuns ?? progress.totalRuns ?? 0),
    freeRuns: Number(localStats.freeRuns ?? progress.freeRuns ?? 0),
    zoneRuns: Number(localStats.zoneRuns ?? progress.zoneRuns ?? 0),
    totalDistance: Number(localStats.totalDistanceMeters ?? progress.totalDistanceMeters ?? 0),
    totalTime: Number(localStats.totalDurationSeconds ?? progress.totalDurationSeconds ?? 0),
    totalArea: Number(localStats.totalTerritoryAreaM2 ?? progress.totalTerritoryAreaM2 ?? 0),
    totalZones: Number(localStats.totalZones ?? progress.territoryCaptures ?? 0),
    longestRun: Number(localStats.longestRunMeters ?? profile.longestRun ?? 0),
    largestZone: Number(localStats.largestZoneAreaM2 ?? profile.largestZone ?? 0),
    bestPace: localStats.bestPaceSecondsPerKm ?? profile.bestPace ?? null,
    averagePace: localStats.averagePaceSecondsPerKm ?? profile.averagePace ?? null,
    weeklyPoints: Number(localStats.weeklyDistanceMeters ?? profile.weeklyPoints ?? 0),
    monthlyPoints: Number(localStats.monthlyDistanceMeters ?? profile.monthlyPoints ?? 0),
    globalPoints: Number(progress.totalXp ?? profile.globalPoints ?? 0),
    monthlyDistance: Number(localStats.monthlyDistanceMeters ?? profile.monthlyDistance ?? 0),
    monthlyArea: Number(localStats.monthlyAreaM2 ?? profile.monthlyArea ?? 0),
    achievementsUnlocked: Number(localStats.achievementsUnlocked ?? profile.achievementsUnlocked ?? 0),
    achievementsTotal: Number(localStats.achievementsTotal ?? profile.achievementsTotal ?? 0),
    recentAchievements: Array.isArray(localStats.recentAchievements) ? localStats.recentAchievements : [],
    pendingSyncCount: Number(localStats.pendingSyncCount ?? 0),
    failedSyncCount: Number(localStats.failedSyncCount ?? 0),
    duplicateRunCount: Number(localStats.duplicateRunCount ?? 0),
    localProfileSource: "local",
    localFirstProgress: true,
    lastUpdate: localStats.updatedAt || progress.updatedAt || profile.lastUpdate || null,
  };
}

function mergeProgressIntoProfile(profile = {}, progress = {}, localStats = {}) {
  return {
    ...profile,
    ...progressToProfilePatch(progress, profile, localStats),
  };
}

function mergeProgressIntoUserDoc(userDoc, progress = {}, localStats = {}) {
  if (!userDoc) return userDoc;
  return {
    ...userDoc,
    ...progressToProfilePatch(progress, userDoc, localStats),
  };
}

function buildData(profile, userDoc) {
  return {
    profile: profile || { ...DEFAULT_PROFILE },
    userDoc: userDoc || null,
  };
}

async function getRemoteUserDoc(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return normalizeUserDoc(snap.id || uid, snap.data());
}

export async function loadCurrentProfile() {
  const localProfile = await loadProfile();
  const user = auth.currentUser;
  const localStats = await getLocalProfileStats({ userId: resolveProfileUserId(user, localProfile) });
  const progress = localStats.progress || {};
  const mergedProfile = mergeProgressIntoProfile(localProfile, progress, localStats);

  if (!user?.uid) {
    return ok(buildData(mergedProfile, null), { source: USER_PROFILE_SOURCE.LOCAL });
  }

  try {
    const userDoc = mergeProgressIntoUserDoc(await getRemoteUserDoc(user.uid), progress, localStats);
    return ok(buildData(mergedProfile, userDoc), {
      source: userDoc ? USER_PROFILE_SOURCE.REMOTE : USER_PROFILE_SOURCE.LOCAL,
    });
  } catch (error) {
    return fail(error, buildData(mergedProfile, null), {
      source: USER_PROFILE_SOURCE.LOCAL,
    });
  }
}

export function subscribeCurrentUserProfile(callback) {
  const user = auth.currentUser;
  let active = true;

  const emitLocal = async (error = null) => {
    const localProfile = await loadProfile();
    const localStats = await getLocalProfileStats({ userId: resolveProfileUserId(user, localProfile) });
    const localProgress = localStats.progress || {};
    const mergedProfile = mergeProgressIntoProfile(localProfile, localProgress, localStats);
    if (!active) return;
    callback({
      data: buildData(mergedProfile, null),
      profile: mergedProfile,
      userDoc: null,
      source: USER_PROFILE_SOURCE.LOCAL,
      loading: false,
      error,
    });
  };

  if (!user?.uid) {
    emitLocal();
    return () => {
      active = false;
    };
  }

  try {
    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),
      async (snap) => {
        const localProfile = await loadProfile();
        const localStats = await getLocalProfileStats({ userId: resolveProfileUserId(user, localProfile) });
        const localProgress = localStats.progress || {};
        const mergedProfile = mergeProgressIntoProfile(localProfile, localProgress, localStats);
        if (!active) return;
        const userDoc = snap.exists()
          ? mergeProgressIntoUserDoc(normalizeUserDoc(snap.id || user.uid, snap.data()), localProgress, localStats)
          : null;
        callback({
          data: buildData(mergedProfile, userDoc),
          profile: mergedProfile,
          userDoc,
          source: userDoc ? USER_PROFILE_SOURCE.REMOTE : USER_PROFILE_SOURCE.LOCAL,
          loading: false,
          error: null,
        });
      },
      async (error) => {
        await emitLocal(error);
      }
    );

    return () => {
      active = false;
      try {
        unsubscribe?.();
      } catch {}
    };
  } catch (error) {
    emitLocal(error);
    return () => {
      active = false;
    };
  }
}

export async function updateCurrentUserProfile(patch = {}) {
  const user = auth.currentUser;
  const displayName = patch.displayName ?? patch.name;
  const avatarCandidate = patch.avatarLocalUri ?? patch.avatar;
  const remoteAvatarCandidate = patch.avatarRemoteUrl ?? (
    /^https?:\/\//i.test(String(patch.avatar || "")) ? patch.avatar : undefined
  );
  const localPatch = compactObject({
    displayName,
    bio: patch.bio,
    avatar: avatarCandidate,
    photoURL: remoteAvatarCandidate,
    isPrivate: patch.isPrivate,
    profileVisibility: patch.profileVisibility,
  });

  const profile = await saveProfile(localPatch);
  const uid = user?.uid || profile?.uid || null;
  const remotePatch = compactObject({
    uid,
    name: patch.name ?? displayName,
    displayName,
    bio: patch.bio,
    avatar: remoteAvatarCandidate,
    photoURL: remoteAvatarCandidate,
    isPrivate: patch.isPrivate,
    profileVisibility: patch.profileVisibility,
    updatedAt: serverTimestamp(),
  });

  if (!user?.uid) {
    return ok(buildData(profile, normalizeUserDoc(uid, remotePatch)), {
      source: USER_PROFILE_SOURCE.LOCAL,
      offlineStatus: "LOCAL_ONLY",
    });
  }

  try {
    await setDoc(doc(db, "users", user.uid), remotePatch, { merge: true });
    return ok(buildData(profile, normalizeUserDoc(user.uid, remotePatch)), {
      source: USER_PROFILE_SOURCE.REMOTE,
      syncStatus: "SYNCED",
    });
  } catch (error) {
    return fail(error, buildData(profile, normalizeUserDoc(user.uid, remotePatch)), {
      source: USER_PROFILE_SOURCE.LOCAL,
      syncStatus: "SYNC_FAILED",
    });
  }
}

export async function updatePrivacy(isPrivate) {
  return updateCurrentUserProfile({
    isPrivate: !!isPrivate,
    profileVisibility: isPrivate ? "private" : "public",
  });
}

export async function uploadAvatarImage(uri, storagePath) {
  if (!uri) return fail(new Error("missing_image_uri"), null, { source: USER_PROFILE_SOURCE.REMOTE });

  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    const ref = storageRef(storage, storagePath);
    const snap = await uploadBytes(ref, blob, { contentType: blob.type || "image/jpeg" });
    return ok(await getDownloadURL(snap.ref), { source: USER_PROFILE_SOURCE.REMOTE });
  } catch (error) {
    return fail(error, null, { source: USER_PROFILE_SOURCE.REMOTE });
  }
}

export async function syncCurrentProfile() {
  try {
    const remoteProfile = await fetchRemoteProfile();
    const localStats = await getLocalProfileStats({ userId: auth.currentUser?.uid || remoteProfile?.uid || "offline" });
    const progress = localStats.progress || {};
    if (remoteProfile) {
      return ok(buildData(mergeProgressIntoProfile(remoteProfile, progress, localStats), null), {
        source: USER_PROFILE_SOURCE.REMOTE,
        syncStatus: "SYNCED",
      });
    }

    const localProfile = await loadProfile();
    return ok(buildData(mergeProgressIntoProfile(localProfile, progress, localStats), null), {
      source: USER_PROFILE_SOURCE.LOCAL,
      syncStatus: "LOCAL_ONLY",
    });
  } catch (error) {
    const localProfile = await loadProfile();
    const localStats = await getLocalProfileStats({ userId: auth.currentUser?.uid || localProfile?.uid || "offline" });
    const progress = localStats.progress || {};
    return fail(error, buildData(mergeProgressIntoProfile(localProfile, progress, localStats), null), {
      source: USER_PROFILE_SOURCE.LOCAL,
      syncStatus: "SYNC_FAILED",
    });
  }
}

export async function getPublicProfile(uid) {
  try {
    const userDoc = await getRemoteUserDoc(uid);
    return ok(userDoc, {
      source: userDoc ? USER_PROFILE_SOURCE.REMOTE : USER_PROFILE_SOURCE.LOCAL,
    });
  } catch (error) {
    return fail(error, null, { source: USER_PROFILE_SOURCE.LOCAL });
  }
}

export default {
  USER_PROFILE_SOURCE,
  loadCurrentProfile,
  subscribeCurrentUserProfile,
  updateCurrentUserProfile,
  updatePrivacy,
  uploadAvatarImage,
  syncCurrentProfile,
  getPublicProfile,
  getLocalProfileStats,
};
