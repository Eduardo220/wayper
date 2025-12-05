// src/services/friendsService.js
import { db } from "../firebaseConfig";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
  serverTimestamp,
  deleteDoc,
} from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";

/**
 * friendsService - funções para criar/aceitar/rejeitar friend requests
 *
 * Model:
 * - friend_requests/{id} -> { id, from, to, status, createdAt, updatedAt }
 * - users/{uid}/friends/{docId} -> { friendId, createdAt }
 */

// create friend request (id auto ou uuid)
export async function createFriendRequest({ fromUid, toUid, message = "" }) {
  if (!fromUid || !toUid) throw new Error("missing args");
  if (fromUid === toUid) throw new Error("cannot add self");

  // sanitize strings (basic)
  const reqColl = collection(db, "friend_requests");

  // Prevent duplicate pending request (either direction)
  const q = query(
    reqColl,
    where("from", "==", fromUid),
    where("to", "==", toUid),
    where("status", "==", "pending")
  );
  const existing = await getDocs(q);
  if (!existing.empty) throw new Error("request_exists");

  // Also check if reverse pending exists (toUid -> fromUid)
  const qReverse = query(
    reqColl,
    where("from", "==", toUid),
    where("to", "==", fromUid),
    where("status", "==", "pending")
  );
  const existingReverse = await getDocs(qReverse);
  if (!existingReverse.empty) {
    // auto-accept if other had already sent pending request
    const revDoc = existingReverse.docs[0];
    await acceptFriendRequest(revDoc.id, fromUid); // accept on behalf of current user
    return { autoAccepted: true };
  }

  const id = uuidv4();
  const payload = {
    id,
    from: fromUid,
    to: toUid,
    message: safeString(message),
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // add doc
  await setDoc(doc(db, "friend_requests", id), payload);
  return payload;
}

export async function acceptFriendRequest(requestId, accepterUid) {
  if (!requestId || !accepterUid) throw new Error("missing args");
  const reqRef = doc(db, "friend_requests", requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("request_not_found");
  const data = reqSnap.data();
  if (data.status !== "pending") throw new Error("not_pending");
  if (data.to !== accepterUid && data.from !== accepterUid) {
    // only recipient or sender (special cases) can accept
    throw new Error("no_permission");
  }

  // update status -> accepted
  await updateDoc(reqRef, { status: "accepted", updatedAt: serverTimestamp() });

  // create friend entries for both users under their subcollections
  const a = data.from;
  const b = data.to;
  // use setDoc with auto ids to track record ids
  await addDoc(collection(db, "users", a, "friends"), { friendId: b, createdAt: serverTimestamp() });
  await addDoc(collection(db, "users", b, "friends"), { friendId: a, createdAt: serverTimestamp() });

  return true;
}

export async function rejectFriendRequest(requestId, byUid) {
  if (!requestId || !byUid) throw new Error("missing args");
  const reqRef = doc(db, "friend_requests", requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("request_not_found");
  const data = reqSnap.data();
  if (data.status !== "pending") throw new Error("not_pending");
  if (data.to !== byUid && data.from !== byUid) throw new Error("no_permission");

  await updateDoc(reqRef, { status: "rejected", updatedAt: serverTimestamp() });
  return true;
}

export async function cancelFriendRequest(requestId, byUid) {
  // cancel means delete or mark canceled. We'll mark rejected to keep audit trail.
  return rejectFriendRequest(requestId, byUid);
}

// helper
function safeString(v) {
  try {
    return (typeof v === "string" ? v.trim() : "") ?? "";
  } catch {
    return "";
  }
}
