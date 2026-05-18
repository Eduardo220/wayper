import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { createUserNotification } from "../notifications/notificationService";

function toDate(value) {
  try {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function getCurrentUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  return {
    uid: user.uid,
    name: user.displayName || user.email?.split("@")?.[0] || "Atleta Wayper",
    avatar: user.photoURL || null,
  };
}

function getActivityId(activity = {}) {
  return String(activity.activityId || activity.id || "").trim();
}

function activityPayload(activity = {}) {
  const id = getActivityId(activity);
  return {
    id,
    type: activity.type || "run",
    userId: activity.userId || null,
    userName: activity.userName || "Atleta Wayper",
    userAvatar: activity.userAvatar || null,
    distanceKm: Number(activity.distanceKm || 0),
    durationSeconds: Number(activity.durationSeconds || 0),
    avgPaceSecondsPerKm: activity.avgPaceSecondsPerKm ?? null,
    elevationMeters: activity.elevationMeters ?? null,
    areaM2: activity.type === "zone" ? Number(activity.areaM2 || 0) : null,
    path: activity.path || null,
    polygon: activity.polygon || null,
    timestamp: activity.createdAt ? new Date(activity.createdAt) : serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export function subscribeActivityInteractions(activity, callback) {
  const activityId = getActivityId(activity);
  const uid = auth.currentUser?.uid;
  if (!activityId || typeof callback !== "function") {
    callback?.({
      likesCount: Number(activity?.likesCount || 0),
      commentsCount: Number(activity?.commentsCount || 0),
      likedByMe: false,
    });
    return () => {};
  }

  const state = {
    likesCount: Number(activity?.likesCount || 0),
    commentsCount: Number(activity?.commentsCount || 0),
    likedByMe: false,
  };

  const emit = () => callback({ ...state });
  const unsubs = [];

  try {
    unsubs.push(
      onSnapshot(
        doc(db, "activities", activityId),
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data() || {};
            state.likesCount = Number(data.likesCount ?? state.likesCount ?? 0);
            state.commentsCount = Number(data.commentsCount ?? state.commentsCount ?? 0);
          }
          emit();
        },
        () => emit()
      )
    );
  } catch {}

  if (uid) {
    try {
      unsubs.push(
        onSnapshot(
          doc(db, "activities", activityId, "likes", uid),
          (snapshot) => {
            state.likedByMe = snapshot.exists();
            emit();
          },
          () => emit()
        )
      );
    } catch {}
  }

  emit();
  return () => unsubs.forEach((unsubscribe) => unsubscribe?.());
}

export async function toggleActivityLike(activity) {
  const user = getCurrentUserProfile();
  const activityId = getActivityId(activity);
  if (!user || !activityId) return null;

  const activityRef = doc(db, "activities", activityId);
  const likeRef = doc(db, "activities", activityId, "likes", user.uid);
  let likedNow = false;

  try {
    await runTransaction(db, async (transaction) => {
      const activitySnap = await transaction.get(activityRef);
      const likeSnap = await transaction.get(likeRef);
      transaction.set(
        activityRef,
        activitySnap.exists()
          ? activityPayload(activity)
          : {
              ...activityPayload(activity),
              likesCount: Math.max(0, Number(activity.likesCount || 0)),
              commentsCount: Math.max(0, Number(activity.commentsCount || 0)),
            },
        { merge: true }
      );

      if (likeSnap.exists()) {
        transaction.delete(likeRef);
        transaction.set(activityRef, { likesCount: increment(-1), updatedAt: serverTimestamp() }, { merge: true });
        likedNow = false;
        return;
      }

      transaction.set(likeRef, {
        userId: user.uid,
        userName: user.name,
        userAvatar: user.avatar,
        createdAt: serverTimestamp(),
      });
      transaction.set(activityRef, { likesCount: increment(1), updatedAt: serverTimestamp() }, { merge: true });
      likedNow = true;
    });

    if (likedNow && activity.userId && activity.userId !== user.uid) {
      await createUserNotification({
        toUid: activity.userId,
        actorUid: user.uid,
        activityId,
        type: "like",
        title: "Nova curtida",
        body: `${user.name} curtiu sua atividade.`,
      });
    }

    return likedNow;
  } catch {
    return null;
  }
}

export function subscribeActivityComments(activity, callback) {
  const activityId = getActivityId(activity);
  if (!activityId || typeof callback !== "function") {
    callback?.([]);
    return () => {};
  }

  try {
    return onSnapshot(
      query(collection(db, "activities", activityId, "comments"), orderBy("createdAt", "asc")),
      (snapshot) => {
        callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      () => callback([])
    );
  } catch {
    callback([]);
    return () => {};
  }
}

export async function addActivityComment(activity, text) {
  const clean = String(text || "").trim();
  const user = getCurrentUserProfile();
  const activityId = getActivityId(activity);
  if (!clean || !user || !activityId) return null;

  try {
    const activityRef = doc(db, "activities", activityId);
    const activitySnap = await getDoc(activityRef);
    await setDoc(
      activityRef,
      activitySnap.exists()
        ? activityPayload(activity)
        : {
            ...activityPayload(activity),
            likesCount: Math.max(0, Number(activity.likesCount || 0)),
            commentsCount: Math.max(0, Number(activity.commentsCount || 0)),
          },
      { merge: true }
    );
    const commentRef = await addDoc(collection(db, "activities", activityId, "comments"), {
      text: clean,
      userId: user.uid,
      userName: user.name,
      userAvatar: user.avatar,
      createdAt: serverTimestamp(),
    });
    await setDoc(activityRef, {
      commentsCount: increment(1),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    if (activity.userId && activity.userId !== user.uid) {
      await createUserNotification({
        toUid: activity.userId,
        actorUid: user.uid,
        activityId,
        type: "comment",
        title: "Novo comentário",
        body: `${user.name} comentou na sua atividade.`,
      });
    }

    return commentRef.id;
  } catch {
    return null;
  }
}

export async function deleteActivityComment(activity, commentId) {
  const activityId = getActivityId(activity);
  if (!activityId || !commentId) return false;

  try {
    const commentSnap = await getDoc(doc(db, "activities", activityId, "comments", commentId));
    if (!commentSnap.exists()) return false;
    await deleteDoc(doc(db, "activities", activityId, "comments", commentId));
    await setDoc(doc(db, "activities", activityId), {
      commentsCount: increment(-1),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

export function formatCommentDate(value) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default {
  subscribeActivityInteractions,
  toggleActivityLike,
  subscribeActivityComments,
  addActivityComment,
  deleteActivityComment,
  formatCommentDate,
};
