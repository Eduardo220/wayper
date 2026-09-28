import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";

import { db } from "../../firebaseConfig";
import { colors } from "../../theme/colors";
import HomeAvatar from "../Home/HomeAvatar";

export default function GroupMembersList({ groupId }) {
  const [members, setMembers] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadMembers = async () => {
      try {
        const membersRef = collection(db, "groups", groupId, "members");
        const snapshot = await getDocs(membersRef);
        const nextMembers = [];

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          const userDoc = await fetchUser(data.uid);
          nextMembers.push({
            id: docSnap.id,
            uid: data.uid,
            role: data.role,
            joinedAt: data.joinedAt,
            nickname: data.nickname,
            user: userDoc,
          });
        }

        if (mounted) setMembers(nextMembers);
      } catch (error) {
        console.warn("members fetch", error);
        if (mounted) setMembers([]);
      }
    };

    loadMembers();
    return () => {
      mounted = false;
    };
  }, [groupId]);

  async function fetchUser(uid) {
    try {
      const userDoc = await getDoc(doc(db, "users", uid));
      return userDoc.exists() ? userDoc.data() : null;
    } catch {
      return null;
    }
  }

  if (!members) {
    return <ActivityIndicator style={styles.loading} color={colors.primary} />;
  }

  const render = ({ item }) => (
    <View style={styles.row}>
      <HomeAvatar
        uri={item.user?.avatar || item.user?.photoURL || null}
        name={item.user?.name || item.nickname || item.uid}
        size={44}
        style={styles.avatar}
      />
      <View style={styles.memberInfo}>
        <Text style={styles.name}>{item.user?.name || item.nickname || item.uid}</Text>
        <Text style={styles.small}>{item.role}</Text>
      </View>
      <Text style={styles.joined}>{new Date(item.joinedAt?.toDate?.() || Date.now()).toLocaleDateString()}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Membros</Text>
      <FlatList data={members} keyExtractor={(item) => item.id} renderItem={render} />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 12 },
  container: { marginTop: 12 },
  title: { color: colors.textSoft, fontWeight: "800" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.backgroundCard,
    padding: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  avatar: { width: 44, height: 44, borderRadius: 10 },
  memberInfo: { flex: 1, marginLeft: 12 },
  name: { color: colors.textMain, fontWeight: "800" },
  small: { color: colors.textMuted, fontSize: 12 },
  joined: { color: colors.textMuted },
});
