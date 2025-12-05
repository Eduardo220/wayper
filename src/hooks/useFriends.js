// src/hooks/useFriends.js
import { useEffect, useState, useCallback, useRef } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  getDoc,
  deleteDoc,
  onSnapshot,
  orderBy,
} from "firebase/firestore";
import { db, auth } from "../firebaseConfig";

/**
 * useFriends - hook para gerenciar lista de amigos (realtime), adicionar, remover, buscar.
 */
export default function useFriends() {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  const currentUser = auth.currentUser;
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    if (!currentUser) {
      setFriends([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const friendsRef = collection(db, "users", currentUser.uid, "friends");
    // Ao usar onSnapshot, pegamos live updates
    unsubscribeRef.current = onSnapshot(
      friendsRef,
      async (snapshot) => {
        try {
          const list = [];
          // coletar friend docs em paralelo
          const promises = snapshot.docs.map(async (docSnap) => {
            const friendId = docSnap.data().friendId;
            const friendDoc = await getDoc(doc(db, "users", friendId));
            if (friendDoc.exists()) {
              return { id: docSnap.id, friendUid: friendId, ...friendDoc.data() };
            }
            return null;
          });

          const resolved = await Promise.all(promises);
          resolved.forEach((item) => item && list.push(item));
          // ordena por level decrescente e por nome como fallback
          list.sort((a, b) => (b.level || 0) - (a.level || 0) || (a.name || "").localeCompare(b.name || ""));
          setFriends(list);
        } catch (e) {
          console.warn("useFriends:onSnapshot error", e);
          setError(e);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        console.warn("friends onSnapshot err", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [currentUser]);

  const addFriendByUsername = useCallback(async (username) => {
    if (!username || !currentUser) throw new Error("username or currentUser missing");

    setAdding(true);
    try {
      // busca usuario pelo username
      const q = query(collection(db, "users"), where("username", "==", username));
      const snap = await getDocs(q);
      if (snap.empty) throw new Error("Usuário não encontrado");

      const friendDoc = snap.docs[0];
      const friendId = friendDoc.id;
      if (friendId === currentUser.uid) throw new Error("Não é possível adicionar a si mesmo");

      // verificar se ja existe
      const already = friends.some((f) => f.friendUid === friendId);
      if (already) throw new Error("Usuário já é amigo");

      // adicionar
      await addDoc(collection(db, "users", currentUser.uid, "friends"), {
        friendId,
        addedAt: new Date(),
      });

      return { ok: true };
    } finally {
      setAdding(false);
    }
  }, [currentUser, friends]);

  const removeFriend = useCallback(async (friendRecordId) => {
    if (!friendRecordId || !currentUser) throw new Error("invalid args");
    // operação direta no Firestore (pode ser envolvido por um modal confirm no UI)
    await deleteDoc(doc(db, "users", currentUser.uid, "friends", friendRecordId));
  }, [currentUser]);

  const findUserByUsername = useCallback(async (username) => {
    if (!username) return null;
    const q = query(collection(db, "users"), where("username", "==", username));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }, []);

  return {
    friends,
    loading,
    adding,
    error,
    addFriendByUsername,
    removeFriend,
    findUserByUsername,
  };
}
