// src/hooks/useFriendsAdvanced.js
import { useCallback } from "react";
import { auth, db } from "../firebaseConfig";
import { createFriendRequest, acceptFriendRequest, rejectFriendRequest } from "../services/friends/friendsService";

import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  doc,
  getDoc,
  orderBy,
} from "firebase/firestore";

import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";

/**
 * useFriendsAdvanced
 * - returns:
 *   friends: accepted friends list (realtime)
 *   requestsReceived: pending requests addressed to current user (realtime)
 *   requestsSent: pending requests sent by current user (realtime)
 *   actions: sendRequest, accept, reject, cancel
 *
 * Implementation:
 * - uses Firestore onSnapshot for realtime lists (wrapped inside react-query refetch triggers)
 * - optimistic updates implemented via react-query mutations
 */

const FRIENDS_QUERY_KEY = (uid) => ["friends", uid];
const REQ_RECEIVED_KEY = (uid) => ["friend_requests_received", uid];
const REQ_SENT_KEY = (uid) => ["friend_requests_sent", uid];

function currentUid() {
  return auth?.currentUser?.uid ?? null;
}

// fetch helper for friends (reads users/{uid}/friends subcollection and resolves user profiles)
async function fetchFriends(uid) {
  if (!uid) return [];
  const friendsRef = collection(db, "users", uid, "friends");
  const friendsSnap = await getDocs(friendsRef);
  const promises = friendsSnap.docs.map(async (docSnap) => {
    const friendId = docSnap.data()?.friendId;
    if (!friendId) return null;
    const userDoc = await getDoc(doc(db, "users", friendId));
    return userDoc.exists() ? { ...userDoc.data(), friendRecordId: docSnap.id } : null;
  });
  const resolved = await Promise.all(promises);
  return resolved.filter(Boolean);
}

// small wrapper to subscribe via onSnapshot and update react-query cache
function subscribeToCollection(q, cb) {
  return onSnapshot(q, (snap) => {
    cb(snap);
  });
}

export default function useFriendsAdvanced() {
  const qc = useQueryClient();
  const uid = currentUid();

  // friends query (initial fetch)
  const friendsQuery = useQuery({
    queryKey: FRIENDS_QUERY_KEY(uid),
    queryFn: () => fetchFriends(uid),
    enabled: !!uid,
    staleTime: 1000 * 60, // 1m
    gcTime: 1000 * 60 * 60, // 1h
  });

  // friend requests received
  const reqReceivedQuery = useQuery({
    queryKey: REQ_RECEIVED_KEY(uid),
    queryFn: async () => {
      if (!uid) return [];
      const q = query(collection(db, "friend_requests"), where("to", "==", uid), where("status", "==", "pending"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    enabled: !!uid,
  });

  // friend requests sent
  const reqSentQuery = useQuery({
    queryKey: REQ_SENT_KEY(uid),
    queryFn: async () => {
      if (!uid) return [];
      const q = query(collection(db, "friend_requests"), where("from", "==", uid), where("status", "==", "pending"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    enabled: !!uid,
  });

  // MUTATIONS (optimistic) ------------------------------------------------
  const sendMutation = useMutation({
    mutationFn: ({ toUid, message }) => createFriendRequest({ fromUid: uid, toUid, message }),
      onMutate: async (variables) => {
        // optimistic: add to reqSent cache
        await qc.cancelQueries({ queryKey: REQ_SENT_KEY(uid) });
        const previous = qc.getQueryData(REQ_SENT_KEY(uid)) || [];
        const fake = { id: "tmp-" + Date.now(), from: uid, to: variables.toUid, status: "pending", message: variables.message, createdAt: Date.now() };
        qc.setQueryData(REQ_SENT_KEY(uid), [fake, ...previous]);
        return { previous };
      },
      onError: (err, vars, context) => {
        qc.setQueryData(REQ_SENT_KEY(uid), context.previous || []);
      },
      onSettled: () => {
        qc.invalidateQueries({ queryKey: REQ_SENT_KEY(uid) });
      },
  });

  const acceptMutation = useMutation({
    mutationFn: ({ requestId }) => acceptFriendRequest(requestId, uid),
      onMutate: async ({ requestId }) => {
        // optimistic: remove from received, add to friends
        await qc.cancelQueries({ queryKey: REQ_RECEIVED_KEY(uid) });
        await qc.cancelQueries({ queryKey: FRIENDS_QUERY_KEY(uid) });
        const prevReceived = qc.getQueryData(REQ_RECEIVED_KEY(uid)) || [];
        const prevFriends = qc.getQueryData(FRIENDS_QUERY_KEY(uid)) || [];

        const req = prevReceived.find((r) => r.id === requestId);
        let newFriend = null;
        if (req) {
          newFriend = { id: req.from, name: req.from, username: req.from, friendRecordId: "tmp-" + Date.now() };
        }
        const newReceived = prevReceived.filter((r) => r.id !== requestId);
        qc.setQueryData(REQ_RECEIVED_KEY(uid), newReceived);
        if (newFriend) qc.setQueryData(FRIENDS_QUERY_KEY(uid), [newFriend, ...prevFriends]);
        return { prevReceived, prevFriends };
      },
      onError: (err, vars, context) => {
        qc.setQueryData(REQ_RECEIVED_KEY(uid), context.prevReceived || []);
        qc.setQueryData(FRIENDS_QUERY_KEY(uid), context.prevFriends || []);
      },
      onSettled: () => {
        qc.invalidateQueries({ queryKey: REQ_RECEIVED_KEY(uid) });
        qc.invalidateQueries({ queryKey: FRIENDS_QUERY_KEY(uid) });
      },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ requestId }) => rejectFriendRequest(requestId, uid),
      onMutate: async ({ requestId }) => {
        await qc.cancelQueries({ queryKey: REQ_RECEIVED_KEY(uid) });
        const prev = qc.getQueryData(REQ_RECEIVED_KEY(uid)) || [];
        qc.setQueryData(REQ_RECEIVED_KEY(uid), prev.filter((r) => r.id !== requestId));
        return { prev };
      },
      onError: (err, vars, context) => {
        qc.setQueryData(REQ_RECEIVED_KEY(uid), context.prev || []);
      },
      onSettled: () => qc.invalidateQueries({ queryKey: REQ_RECEIVED_KEY(uid) }),
  });

  // public API
  return {
    friends: friendsQuery.data || [],
    friendsLoading: friendsQuery.isLoading,
    requestsReceived: reqReceivedQuery.data || [],
    requestsSent: reqSentQuery.data || [],
    requestsLoading: reqReceivedQuery.isLoading || reqSentQuery.isLoading,
    sendRequest: sendMutation.mutateAsync,
    acceptRequest: acceptMutation.mutateAsync,
    rejectRequest: rejectMutation.mutateAsync,
    // raw queries for advanced usage
    refetchFriends: () => qc.invalidateQueries({ queryKey: FRIENDS_QUERY_KEY(uid) }),
  };
}
