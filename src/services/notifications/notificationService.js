import {
  collection,
  doc,
  getDoc,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";

function toDate(value) {
  try {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    if (typeof value === "object" && Number.isFinite(value.seconds)) return new Date(value.seconds * 1000);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function normalizeNotification(id, data = {}) {
  const type = data.type || "info";
  const fallbackTitle =
    type === "like"
      ? "Nova curtida"
      : type === "comment"
        ? "Novo comentário"
        : type === "friend_request"
          ? "Solicitação de amizade"
          : "Notificação";

  return {
    id,
    type,
    title: data.title || fallbackTitle,
    body: data.body || data.message || "",
    actorUid: data.actorUid || data.from || null,
    activityId: data.activityId || null,
    createdAt: data.createdAt || data.timestamp || data.updatedAt || null,
    read: !!data.read,
  };
}

function sortNotifications(items = []) {
  return items
    .slice()
    .sort((a, b) => {
      const ad = toDate(a.createdAt)?.getTime() || 0;
      const bd = toDate(b.createdAt)?.getTime() || 0;
      return bd - ad;
    })
    .slice(0, 30);
}

export async function createUserNotification({
  toUid,
  type = "info",
  title,
  body,
  actorUid = null,
  activityId = null,
} = {}) {
  if (!toUid) return null;

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const payload = {
    id,
    type,
    title: title || "Notificação",
    body: body || "",
    actorUid,
    activityId,
    read: false,
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, "users", toUid, "notifications", id), payload);
    return payload;
  } catch {
    return null;
  }
}

export function subscribeHomeNotifications(uid, callback) {
  if (!uid || typeof callback !== "function") {
    callback?.([]);
    return () => {};
  }

  const buckets = {
    notifications: [],
    publicNotifications: [],
    friendRequests: [],
  };

  const emit = () => {
    const merged = sortNotifications([
      ...buckets.notifications,
      ...buckets.publicNotifications,
      ...buckets.friendRequests,
    ]);
    callback(merged);
  };

  const unsubs = [];

  try {
    unsubs.push(
      onSnapshot(
        query(collection(db, "users", uid, "notifications"), orderBy("createdAt", "desc"), firestoreLimit(30)),
        (snapshot) => {
          buckets.notifications = snapshot.docs.map((item) => normalizeNotification(item.id, item.data()));
          emit();
        },
        () => {
          buckets.notifications = [];
          emit();
        }
      )
    );
  } catch {}

  try {
    unsubs.push(
      onSnapshot(
        query(collection(db, "notifications"), where("toUid", "==", uid), orderBy("createdAt", "desc"), firestoreLimit(20)),
        (snapshot) => {
          buckets.publicNotifications = snapshot.docs.map((item) => normalizeNotification(item.id, item.data()));
          emit();
        },
        () => {
          buckets.publicNotifications = [];
          emit();
        }
      )
    );
  } catch {}

  try {
    unsubs.push(
      onSnapshot(
        query(collection(db, "friend_requests"), where("to", "==", uid), where("status", "==", "pending")),
        async (snapshot) => {
          const rows = await Promise.all(
            snapshot.docs.map(async (item) => {
              const data = item.data() || {};
              let name = "Alguém";
              try {
                const userSnap = await getDoc(doc(db, "users", data.from));
                const user = userSnap.exists() ? userSnap.data() : {};
                name = user.name || user.displayName || user.username || name;
              } catch {}

              return normalizeNotification(`friend_${item.id}`, {
                type: "friend_request",
                title: "Solicitação de amizade",
                body: `${name} quer se conectar com você.`,
                actorUid: data.from,
                createdAt: data.createdAt || data.updatedAt,
                read: false,
              });
            })
          );
          buckets.friendRequests = rows;
          emit();
        },
        () => {
          buckets.friendRequests = [];
          emit();
        }
      )
    );
  } catch {}

  emit();
  return () => unsubs.forEach((unsubscribe) => unsubscribe?.());
}

export function subscribeUnreadGroupMessages(uid, callback) {
  if (!uid || typeof callback !== "function") {
    callback?.(0);
    return () => {};
  }

  let messageUnsubs = [];
  const counts = new Map();

  const emit = () => {
    const total = Array.from(counts.values()).reduce((sum, value) => sum + Number(value || 0), 0);
    callback(total);
  };

  const cleanupMessages = () => {
    messageUnsubs.forEach((unsubscribe) => unsubscribe?.());
    messageUnsubs = [];
    counts.clear();
  };

  const membershipUnsub = onSnapshot(
    collection(db, "users", uid, "groups"),
    (snapshot) => {
      cleanupMessages();

      snapshot.docs.forEach((memberDoc) => {
        const membership = memberDoc.data() || {};
        const groupId = membership.groupId || memberDoc.id;
        const lastReadAt = toDate(membership.lastReadAt || membership.readAt || membership.lastSeenAt);

        try {
          const messagesQuery = query(
            collection(db, "groups", groupId, "messages"),
            orderBy("createdAt", "desc"),
            firestoreLimit(60)
          );

          const unsub = onSnapshot(
            messagesQuery,
            (messagesSnap) => {
              let unread = 0;
              messagesSnap.forEach((messageDoc) => {
                const message = messageDoc.data() || {};
                const sender = message.userId || message.fromUid;
                if (sender === uid) return;
                const createdAt = toDate(message.createdAt);
                if (!createdAt) return;
                if (!lastReadAt || createdAt.getTime() > lastReadAt.getTime()) unread += 1;
              });
              counts.set(groupId, unread);
              emit();
            },
            () => {
              counts.set(groupId, 0);
              emit();
            }
          );
          messageUnsubs.push(unsub);
        } catch {
          counts.set(groupId, 0);
        }
      });

      emit();
    },
    () => {
      cleanupMessages();
      emit();
    }
  );

  return () => {
    membershipUnsub?.();
    cleanupMessages();
  };
}

export async function markGroupMessagesRead(uid, groupId) {
  if (!uid || !groupId) return;
  const payload = { groupId, lastReadAt: serverTimestamp() };
  try {
    await Promise.all([
      setDoc(doc(db, "users", uid, "groups", groupId), payload, { merge: true }),
      setDoc(doc(db, "groups", groupId, "members", uid), { lastReadAt: serverTimestamp() }, { merge: true }),
    ]);
  } catch {}
}

export function formatNotificationDate(value) {
  const date = toDate(value);
  if (!date) return "";
  const now = new Date();
  const diffMinutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (diffMinutes < 1) return "agora";
  if (diffMinutes < 60) return `${diffMinutes} min`;
  if (diffMinutes < 60 * 24) return `${Math.floor(diffMinutes / 60)} h`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default {
  createUserNotification,
  subscribeHomeNotifications,
  subscribeUnreadGroupMessages,
  markGroupMessagesRead,
  formatNotificationDate,
};
