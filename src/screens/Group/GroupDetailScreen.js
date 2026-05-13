import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { doc, getDoc, increment, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

import GroupChat from "../../components/Group/GroupChat";
import GroupMembersList from "../../components/Group/GroupMembersList";
import { auth, db } from "../../firebaseConfig";
import { colors } from "../../theme/colors";

export default function GroupDetailScreen({ route, navigation }) {
  const groupId = route?.params?.groupId;
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMember, setIsMember] = useState(false);
  const [memberRole, setMemberRole] = useState(null);

  const joinGroup = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !groupId || isMember) return;

    try {
      await setDoc(doc(db, "groups", groupId, "members", uid), {
        uid,
        role: "member",
        joinedAt: serverTimestamp(),
      });
      await setDoc(doc(db, "users", uid, "groups", groupId), {
        groupId,
        role: "member",
        joinedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "groups", groupId), {
        membersCount: increment(1),
      });
      setIsMember(true);
      setMemberRole("member");
    } catch (error) {
      console.warn("join group failed", error);
    }
  };

  useEffect(() => {
    if (!groupId) {
      navigation.goBack();
      return undefined;
    }

    const groupRef = doc(db, "groups", groupId);
    const unsubscribe = onSnapshot(groupRef, (snapshot) => {
      if (snapshot.exists()) {
        setGroup({ id: snapshot.id, ...snapshot.data() });
      } else {
        navigation.goBack();
      }
      setLoading(false);
    });

    const checkMembership = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      const memberRef = doc(db, "groups", groupId, "members", uid);
      const snapshot = await getDoc(memberRef);

      if (snapshot.exists()) {
        setIsMember(true);
        setMemberRole(snapshot.data().role);
      } else {
        setIsMember(false);
        setMemberRole(null);
      }
    };

    checkMembership();
    return () => unsubscribe();
  }, [groupId, navigation]);

  if (loading || !group) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatarWrap}>
          <Image source={{ uri: group.avatar || "https://i.pravatar.cc/150?u=wayper_group" }} style={styles.avatar} />
        </View>

        <View style={styles.headerText}>
          <Text style={styles.name}>
            {group.name} <Text style={styles.tag}>#{group.tag}</Text>
          </Text>

          <Text style={styles.desc}>{group.description}</Text>

          <View style={styles.metaRow}>
            <Text style={styles.small}>Membros: {group.membersCount || 0}</Text>
            <Text style={[styles.small, styles.ownerText]}>
              Criado por: {group.ownerId}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: isMember ? colors.backgroundCard : colors.primary }]}
          onPress={joinGroup}
          disabled={isMember}
        >
          <Text style={styles.actionText}>{isMember ? "Dentro" : "Entrar"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.backgroundCard }]}>
          <Text style={{ color: colors.textMain }}>Convidar</Text>
        </TouchableOpacity>

        {memberRole === "owner" && (
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.accent }]}>
            <Text style={styles.actionText}>Gerenciar</Text>
          </TouchableOpacity>
        )}
      </View>

      {group.announcement && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Anúncio</Text>
          <Text style={styles.sectionText}>{group.announcement}</Text>
        </View>
      )}

      {group.nextRun ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Próxima corrida</Text>
          <Text style={styles.sectionText}>{group.nextRun}</Text>
        </View>
      ) : null}

      <GroupMembersList groupId={groupId} />

      <Text style={styles.chatTitle}>Chat do grupo</Text>
      <GroupChat groupId={groupId} />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingScreen: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
    paddingTop: Platform.OS === "ios" ? 56 : 20,
  },
  header: {
    flexDirection: "row",
    backgroundColor: colors.backgroundCard,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarWrap: {
    width: 84,
    height: 84,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatar: { width: 80, height: 80, borderRadius: 10 },
  headerText: { flex: 1, marginLeft: 12 },
  name: { color: colors.textMain, fontWeight: "900", fontSize: 18 },
  tag: { color: colors.textMuted, fontWeight: "700" },
  desc: { color: colors.textMuted, marginTop: 6 },
  metaRow: { flexDirection: "row", marginTop: 8 },
  small: { color: colors.textMuted },
  ownerText: { marginLeft: 12 },
  btnRow: { flexDirection: "row", gap: 12, marginTop: 12 },
  actionBtn: {
    padding: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  actionText: { color: colors.white },
  section: {
    backgroundColor: colors.backgroundCard,
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
    borderColor: colors.border,
    borderWidth: 1,
  },
  sectionTitle: { color: colors.textSoft, fontWeight: "800", marginBottom: 6 },
  sectionText: { color: colors.textMain },
  chatTitle: {
    color: colors.textMain,
    fontWeight: "900",
    marginTop: 18,
    marginBottom: 6,
    fontSize: 16,
  },
});
