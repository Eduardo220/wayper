import { auth, db, storage } from "../firebaseConfig.js";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  DEFAULT_PROFILE,
  fetchRemoteProfile,
  loadProfile,
  saveProfile,
} from "../services/profile/profileService.js";
import { getUserProgress } from "./progressionRepository.js";

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

function progressToProfilePatch(progress = {}, profile = {}) {
  const hasProgress = Number(progress.totalRuns || 0) > 0 || Number(progress.totalXp || 0) > 0;
  if (!hasProgress) return {};

  return {
    progress,
    totalXp: Number(progress.totalXp || 0),
    xp: Number(progress.xp || 0),
    level: Number(progress.level || 1),
    nextLevelXp: Number(progress.nextLevelXp || DEFAULT_PROFILE.nextLevelXp || 1000),
    progressToNextLevel: Number(progress.progressToNextLevel || 0),
    progressToNextLevelPct: Number(progress.progressToNextLevelPct || 0),
    totalRuns: Number(progress.totalRuns || 0),
    totalDistance: Number(progress.totalDistanceMeters || 0),
    totalTime: Number(progress.totalDurationSeconds || 0),
    totalArea: Number(progress.totalTerritoryAreaM2 || 0),
    totalZones: Number(progress.territoryCaptures || 0),
    localFirstProgress: true,
    lastUpdate: progress.updatedAt || profile.lastUpdate || null,
  };
}

function mergeProgressIntoProfile(profile = {}, progress = {}) {
  return {
    ...profile,
    ...progressToProfilePatch(progress, profile),
  };
}

function mergeProgressIntoUserDoc(userDoc, progress = {}) {
  if (!userDoc) return userDoc;
  return {
    ...userDoc,
    ...progressToProfilePatch(progress, userDoc),
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
  const progress = await getUserProgress({ userId: user?.uid || localProfile?.uid || "offline" });
  const mergedProfile = mergeProgressIntoProfile(localProfile, progress);

  if (!user?.uid) {
    return ok(buildData(mergedProfile, null), { source: USER_PROFILE_SOURCE.LOCAL });
  }

  try {
    const userDoc = mergeProgressIntoUserDoc(await getRemoteUserDoc(user.uid), progress);
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
    const localProgress = await getUserProgress({ userId: user?.uid || localProfile?.uid || "offline" });
    const mergedProfile = mergeProgressIntoProfile(localProfile, localProgress);
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
        const localProgress = await getUserProgress({ userId: user.uid || localProfile?.uid || "offline" });
        const mergedProfile = mergeProgressIntoProfile(localProfile, localProgress);
        if (!active) return;
        const userDoc = snap.exists()
          ? mergeProgressIntoUserDoc(normalizeUserDoc(snap.id || user.uid, snap.data()), localProgress)
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
  const localPatch = compactObject({
    displayName,
    bio: patch.bio,
    avatar: patch.avatar,
    photoURL: patch.avatar,
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
    avatar: patch.avatar,
    photoURL: patch.avatar,
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
    const progress = await getUserProgress({ userId: auth.currentUser?.uid || remoteProfile?.uid || "offline" });
    if (remoteProfile) {
      return ok(buildData(mergeProgressIntoProfile(remoteProfile, progress), null), {
        source: USER_PROFILE_SOURCE.REMOTE,
        syncStatus: "SYNCED",
      });
    }

    const localProfile = await loadProfile();
    return ok(buildData(mergeProgressIntoProfile(localProfile, progress), null), {
      source: USER_PROFILE_SOURCE.LOCAL,
      syncStatus: "LOCAL_ONLY",
    });
  } catch (error) {
    const localProfile = await loadProfile();
    const progress = await getUserProgress({ userId: auth.currentUser?.uid || localProfile?.uid || "offline" });
    return fail(error, buildData(mergeProgressIntoProfile(localProfile, progress), null), {
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
};
