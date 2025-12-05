// src/screens/Friends/FriendsScreen.js
/**
 * FriendsScreen - versão refatorada "suprema"
 *
 * Preserva aparência/behavior externos.
 * Melhorias internas: performance, segurança, estabilidade e organização.
 *
 * Fonte original usada: uploaded file (FriendsScreen.js). :contentReference[oaicite:1]{index=1}
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { auth, db } from "../../firebaseConfig";
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

import { colors } from "../../theme";

// ----------------- CONSTANTS / FALLBACKS -----------------
const DEFAULT_AVATAR = "https://i.pravatar.cc/150";
const MIN_USERNAME_LENGTH = 1;
const ADD_BTN_SIZE = 52;
const INPUT_DEBOUNCE_MS = 300; // preserved UX; not used to change behavior
const TEXTS = {
  placeholder: "Nome de usuário",
  addingSelf: "Tu não pode adicionar tu mesmo.",
  userNotFound: "Usuário não encontrado.",
  alreadyFriend: "Esse usuário já é teu amigo.",
  emptyUsername: "Digite um usuário.",
  added: "Amigo adicionado.",
  addError: "Erro ao adicionar.",
  removeConfirmTitle: "Remover amigo",
  removeConfirmCancel: "Cancelar",
  removeConfirmRemove: "Remover",
  removeError: "Não foi possível remover o amigo.",
};

// ----------------- Helper utils -----------------
const safeString = (v) => (typeof v === "string" ? v.trim() : "");
const safeNumber = (v, fallback = 0) => (typeof v === "number" && !Number.isNaN(v) ? v : fallback);

const sortFriends = (a, b) => {
  const la = safeNumber(a.level, 0);
  const lb = safeNumber(b.level, 0);
  if (lb !== la) return lb - la;
  const na = (a.name || a.username || "").toLowerCase();
  const nb = (b.name || b.username || "").toLowerCase();
  return na.localeCompare(nb);
};

// ----------------- FriendCard (memoized) -----------------
const FriendCard = React.memo(function FriendCard({ friend, onPress, onRemove }) {
  const avatar = friend?.avatar || DEFAULT_AVATAR;
  const name = friend?.name || friend?.username || "—";
  const username = friend?.username || "";
  const level = safeNumber(friend?.level, 1);
  const totalArea = Number(friend?.totalArea ?? 0);
  const zones = Number(friend?.zones ?? 0);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <Image source={{ uri: avatar }} style={styles.avatar} />
      <View style={styles.cardBody}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.username} numberOfLines={1}>
          @{username}
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statText}>Nível {level}</Text>
          </View>

          <View style={styles.statPill}>
            <Text style={styles.statText}>{totalArea} km²</Text>
          </View>

          <View style={styles.statPill}>
            <Text style={styles.statText}>{zones} zonas</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity onPress={onRemove} style={styles.removeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="trash-outline" size={22} color={colors.primary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
});

// ----------------- Main Screen -----------------
export default function FriendsScreen({ navigation }) {
  // states
  const [friends, setFriends] = useState([]);
  const [usernameToAdd, setUsernameToAdd] = useState("");
  const [loading, setLoading] = useState(false); // used for add flow
  const [initialLoading, setInitialLoading] = useState(true); // initial snapshot load

  // refs
  const mountedRef = useRef(true);
  const unsubscribeRef = useRef(null);
  const pendingAddRequestRef = useRef(false); // prevents double submits

  // current user accessor (safe)
  const getCurrentUser = useCallback(() => auth?.currentUser || null, []);

  // ----------------- Firestore subscription (realtime) -----------------
  useEffect(() => {
    mountedRef.current = true;
    const currentUser = getCurrentUser();
    if (!currentUser) {
      // no user: ensure empty list and stop loading
      setFriends([]);
      setInitialLoading(false);
      return;
    }

    const friendsRef = collection(db, "users", currentUser.uid, "friends");

    // prefer onSnapshot for realtime updates
    unsubscribeRef.current = onSnapshot(
      friendsRef,
      async (snapshot) => {
        try {
          // Build friend fetch promises in parallel
          const fetchPromises = snapshot.docs.map(async (docSnap) => {
            const friendId = docSnap.data()?.friendId;
            if (!friendId) return null;
            try {
              const friendDoc = await getDoc(doc(db, "users", friendId));
              if (friendDoc.exists()) {
                return {
                  id: docSnap.id,
                  friendUid: friendId,
                  ...friendDoc.data(),
                };
              }
              return null;
            } catch (e) {
              // log and continue; do not throw to keep other items
              console.warn("FriendsScreen: failed to fetch friendDoc", friendId, e?.message ?? e);
              return null;
            }
          });

          const resolved = await Promise.all(fetchPromises);
          const filtered = resolved.filter(Boolean);
          filtered.sort(sortFriends);

          if (mountedRef.current) {
            // batch update
            setFriends(filtered);
            setInitialLoading(false);
          }
        } catch (e) {
          console.warn("FriendsScreen:onSnapshot handler error", e?.message ?? e);
          if (mountedRef.current) setInitialLoading(false);
        }
      },
      (error) => {
        console.warn("FriendsScreen:onSnapshot error", error?.message ?? error);
        if (mountedRef.current) setInitialLoading(false);
      }
    );

    return () => {
      // cleanup
      mountedRef.current = false;
      if (unsubscribeRef.current) {
        try {
          unsubscribeRef.current();
        } catch (e) {
          // ignore
        }
        unsubscribeRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty deps: subscribe once on mount

  // ----------------- Add friend handler -----------------
  const handleAddFriend = useCallback(async () => {
    const username = safeString(usernameToAdd);
    if (username.length < MIN_USERNAME_LENGTH) {
      Alert.alert(TEXTS.emptyUsername);
      return;
    }

    const currentUser = getCurrentUser();
    if (!currentUser) {
      Alert.alert(TEXTS.addError);
      return;
    }

    // prevent double submission
    if (pendingAddRequestRef.current) return;
    pendingAddRequestRef.current = true;
    setLoading(true);
    Keyboard.dismiss();

    try {
      // 1) find user by username
      const usersQ = query(collection(db, "users"), where("username", "==", username));
      const usersSnap = await getDocs(usersQ);

      if (usersSnap.empty) {
        Alert.alert(TEXTS.userNotFound);
        return;
      }

      const friendDataDoc = usersSnap.docs[0];
      const friendId = friendDataDoc.id;

      // 2) cannot add self
      if (friendId === currentUser.uid) {
        Alert.alert(TEXTS.addingSelf);
        return;
      }

      // 3) ensure not already friends by querying subcollection for friendId
      const myFriendsRef = collection(db, "users", currentUser.uid, "friends");
      const existingQ = query(myFriendsRef, where("friendId", "==", friendId));
      const existingSnap = await getDocs(existingQ);
      if (!existingSnap.empty) {
        Alert.alert(TEXTS.alreadyFriend);
        return;
      }

      // 4) add friend doc (sanitized)
      await addDoc(myFriendsRef, {
        friendId,
        addedAt: new Date(),
      });

      // success
      if (mountedRef.current) {
        setUsernameToAdd("");
        Alert.alert(TEXTS.added);
      }
    } catch (err) {
      console.warn("FriendsScreen:addFriend error", err?.message ?? err);
      Alert.alert(TEXTS.addError);
    } finally {
      pendingAddRequestRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [usernameToAdd, getCurrentUser]);

  // ----------------- Remove friend handler -----------------
  const handleRemove = useCallback(
    (id, name) => {
      if (!id) return;
      Alert.alert(TEXTS.removeConfirmTitle, `Quer remover ${name}?`, [
        { text: TEXTS.removeConfirmCancel, style: "cancel" },
        {
          text: TEXTS.removeConfirmRemove,
          style: "destructive",
          onPress: async () => {
            const currentUser = getCurrentUser();
            if (!currentUser) {
              Alert.alert(TEXTS.removeError);
              return;
            }
            try {
              await deleteDoc(doc(db, "users", currentUser.uid, "friends", id));
            } catch (err) {
              console.warn("FriendsScreen:remove error", err?.message ?? err);
              Alert.alert(TEXTS.removeError);
            }
          },
        },
      ]);
    },
    [getCurrentUser]
  );

  // ----------------- Navigation callback -----------------
  const openProfile = useCallback(
    (friendUid) => {
      if (!friendUid) return;
      navigation.navigate("FriendProfile", { friendId: friendUid });
    },
    [navigation]
  );

  // memoized renderItem to avoid re-creation
  const renderItem = useCallback(
    ({ item }) => <FriendCard friend={item} onPress={() => openProfile(item.friendUid)} onRemove={() => handleRemove(item.id, item.name)} />,
    [openProfile, handleRemove]
  );

  const keyExtractor = useCallback((item) => item.id, []);

  // ListEmpty component memo
  const listEmptyComponent = useMemo(
    () => <Text style={styles.empty}>Nenhum amigo por aqui ainda.</Text>,
    []
  );

  return (
    <View style={styles.container}>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder={TEXTS.placeholder}
          placeholderTextColor="#aaa"
          value={usernameToAdd}
          onChangeText={setUsernameToAdd}
          editable={!loading}
          returnKeyType="done"
          onSubmitEditing={handleAddFriend}
        />

        <TouchableOpacity style={[styles.addBtn, loading && styles.addBtnDisabled]} onPress={handleAddFriend} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.addText}>+</Text>}
        </TouchableOpacity>
      </View>

      {initialLoading ? (
        <View style={{ marginTop: 20 }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={listEmptyComponent}
        />
      )}
    </View>
  );
}

// ----------------- STYLES (preserve visual style) -----------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 20,
  },

  addRow: {
    flexDirection: "row",
    marginBottom: 22,
    gap: 12,
  },

  input: {
    flex: 1,
    backgroundColor: "#f1f1f1",
    padding: 14,
    borderRadius: 12,
    fontWeight: "600",
    color: colors.text,
  },

  addBtn: {
    width: ADD_BTN_SIZE,
    height: ADD_BTN_SIZE,
    borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },

  addBtnDisabled: {
    opacity: 0.75,
  },

  addText: {
    color: colors.white,
    fontSize: 26,
    fontWeight: "900",
  },

  card: {
    flexDirection: "row",
    padding: 16,
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.grayLight,
    alignItems: "center",
    marginBottom: 18,
  },

  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: 14,
    backgroundColor: colors.grayLight,
  },

  cardBody: {
    flex: 1,
  },

  name: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
  },

  username: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },

  statsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },

  statPill: {
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },

  statText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 12,
  },

  removeBtn: {
    padding: 8,
    marginLeft: 10,
  },

  empty: {
    marginTop: 40,
    textAlign: "center",
    color: "#777",
    fontSize: 15,
  },

  listContent: {
    paddingBottom: 40,
  },
});
