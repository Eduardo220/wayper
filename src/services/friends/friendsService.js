// src/services/firestore/friendsService.js
// WAYPER QUANTUM SUPREME MASTER ULTRA EDITION
// Antifraude, anti-spam, atômico, escalável e extremamente rápido.

import { db } from "../../firebaseConfig";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
} from "firebase/firestore";

/* ============================================================
   CONFIG
============================================================ */
const ENABLE_LOGS = false;
function log(...a) {
  if (ENABLE_LOGS) console.log("[friendsService]", ...a);
}

/* ============================================================
   CACHE ANTI-DUPLICAÇÃO (O(1))
============================================================ */
const pendingCache = new Set(); // `${from}_${to}`
const makeId = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function cacheKey(a, b) {
  return `${a}_${b}`;
}

/* ============================================================
   SAFE STRING
============================================================ */
function safeString(v) {
  if (!v || typeof v !== "string") return "";
  return v.trim();
}

/* ============================================================
   CHECK SE JÁ SÃO AMIGOS (consulta ultra rápida)
============================================================ */
async function alreadyFriends(a, b) {
  const ref = collection(db, `users/${a}/friends`);
  const q = query(ref, where("friendId", "==", b));
  const snap = await getDocs(q);
  return !snap.empty;
}

/* ============================================================
   CREATE FRIEND REQUEST (ANTI SPAM + DUPLICATE PROOF)
============================================================ */
export async function createFriendRequest({ fromUid, toUid, message = "" }) {
  if (!fromUid || !toUid) throw new Error("missing_args");
  if (fromUid === toUid) throw new Error("cannot_add_self");

  // anti flood
  const key = cacheKey(fromUid, toUid);
  if (pendingCache.has(key)) {
    throw new Error("request_pending_cached");
  }

  // Já são amigos?
  if (await alreadyFriends(fromUid, toUid)) {
    return { alreadyFriends: true };
  }

  const reqColl = collection(db, "friend_requests");

  // consulta 1 — já existe pending direto
  const q1 = query(
    reqColl,
    where("from", "==", fromUid),
    where("to", "==", toUid),
    where("status", "==", "pending")
  );
  const direct = await getDocs(q1);
  if (!direct.empty) {
    pendingCache.add(key);
    throw new Error("request_exists");
  }

  // consulta 2 — já existe pending reverso (auto-aceitar!)
  const q2 = query(
    reqColl,
    where("from", "==", toUid),
    where("to", "==", fromUid),
    where("status", "==", "pending")
  );
  const reverse = await getDocs(q2);

  if (!reverse.empty) {
    const docId = reverse.docs[0].id;
    await acceptFriendRequest(docId, fromUid);
    return { autoAccepted: true };
  }

  // cria o pedido
  const id = makeId();
  const payload = {
    id,
    from: fromUid,
    to: toUid,
    message: safeString(message),
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, "friend_requests", id), payload);

  pendingCache.add(key);

  return payload;
}

/* ============================================================
   ACCEPT REQUEST (ATÔMICO + 2-WAY FRIENDSHIP)
============================================================ */
export async function acceptFriendRequest(requestId, accepterUid) {
  if (!requestId || !accepterUid) throw new Error("missing_args");

  const reqRef = doc(db, "friend_requests", requestId);
  const reqSnap = await getDoc(reqRef);

  if (!reqSnap.exists()) throw new Error("request_not_found");

  const data = reqSnap.data();

  if (data.status !== "pending") throw new Error("not_pending");

  if (data.to !== accepterUid && data.from !== accepterUid) {
    throw new Error("no_permission");
  }

  const a = data.from;
  const b = data.to;

  // se já eram amigos, atualiza e fecha
  if (await alreadyFriends(a, b)) {
    await updateDoc(reqRef, {
      status: "accepted",
      updatedAt: serverTimestamp(),
    });
    return { alreadyFriends: true };
  }

  // ATOMIC WRITE — evita inconsistências
  const batch = writeBatch(db);

  // update do request
  batch.update(reqRef, {
    status: "accepted",
    updatedAt: serverTimestamp(),
  });

  // registra amizade nos dois lados
  const entryA = doc(collection(db, `users/${a}/friends`));
  batch.set(entryA, {
    friendId: b,
    createdAt: serverTimestamp(),
  });

  const entryB = doc(collection(db, `users/${b}/friends`));
  batch.set(entryB, {
    friendId: a,
    createdAt: serverTimestamp(),
  });

  await batch.commit();

  // limpa caches
  pendingCache.delete(cacheKey(a, b));
  pendingCache.delete(cacheKey(b, a));

  return { success: true };
}

/* ============================================================
   REJECT REQUEST
============================================================ */
export async function rejectFriendRequest(requestId, uid) {
  const reqRef = doc(db, "friend_requests", requestId);
  const reqSnap = await getDoc(reqRef);

  if (!reqSnap.exists()) throw new Error("request_not_found");

  const data = reqSnap.data();

  if (data.status !== "pending") throw new Error("not_pending");

  if (data.to !== uid && data.from !== uid) {
    throw new Error("no_permission");
  }

  await updateDoc(reqRef, {
    status: "rejected",
    updatedAt: serverTimestamp(),
  });

  pendingCache.delete(cacheKey(data.from, data.to));

  return { rejected: true };
}

/* ============================================================
   CANCEL (simples alias para reject)
============================================================ */
export async function cancelFriendRequest(requestId, uid) {
  return rejectFriendRequest(requestId, uid);
}

/* ============================================================
   REMOVE FRIENDSHIP (2-WAY)
============================================================ */
async function findFriendshipDocs(ownerUid, friendUid) {
  const ref = collection(db, `users/${ownerUid}/friends`);
  const q = query(ref, where("friendId", "==", friendUid));
  const snap = await getDocs(q);
  return snap.docs.map((item) => item.ref);
}

export async function removeFriendship(uid, friendUid) {
  if (!uid || !friendUid) throw new Error("missing_args");
  if (uid === friendUid) throw new Error("cannot_remove_self");

  const [forwardRefs, reverseRefs] = await Promise.all([
    findFriendshipDocs(uid, friendUid),
    findFriendshipDocs(friendUid, uid),
  ]);

  const batch = writeBatch(db);
  [...forwardRefs, ...reverseRefs].forEach((ref) => batch.delete(ref));

  const requestQueries = [
    query(collection(db, "friend_requests"), where("from", "==", uid), where("to", "==", friendUid)),
    query(collection(db, "friend_requests"), where("from", "==", friendUid), where("to", "==", uid)),
  ];

  const requestSnaps = await Promise.all(requestQueries.map((q) => getDocs(q)));
  requestSnaps.forEach((snap) => {
    snap.docs.forEach((item) => {
      batch.set(item.ref, {
        status: "removed",
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
  });

  await batch.commit();
  pendingCache.delete(cacheKey(uid, friendUid));
  pendingCache.delete(cacheKey(friendUid, uid));

  return { success: true };
}
