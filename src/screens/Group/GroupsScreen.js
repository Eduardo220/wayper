import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import CreateGroupModal from "../../components/Group/CreateGroupModal";
import { db } from "../../firebaseConfig";
import { colors } from "../../theme/colors";

export default function GroupsScreen({ navigation }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const groupsQuery = query(collection(db, "groups"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      groupsQuery,
      (snapshot) => {
        const nextGroups = [];
        snapshot.forEach((docSnap) => nextGroups.push({ id: docSnap.id, ...docSnap.data() }));
        setGroups(nextGroups);
        setLoading(false);
      },
      (error) => {
        console.warn("groups snapshot error", error);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredGroups = groups.filter((group) => {
    if (!normalizedSearch) return true;

    return group.name?.toLowerCase().includes(normalizedSearch)
      || group.tag?.toLowerCase().includes(normalizedSearch);
  });

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate("GroupDetail", { groupId: item.id })}
    >
      <View style={styles.cardInfo}>
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText}>{(item.tag || "").slice(0, 2).toUpperCase()}</Text>
        </View>
        <View style={styles.textColumn}>
          <Text style={styles.groupName}>
            {item.name} <Text style={styles.tag}>#{item.tag}</Text>
          </Text>
          <Text style={styles.desc}>{item.description || ""}</Text>
        </View>
      </View>

      <View style={styles.memberColumn}>
        <Text style={styles.small}>Membros</Text>
        <Text style={styles.count}>{item.membersCount || 0}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Grupos</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)} style={styles.createBtn}>
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.createText}>Criar</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Procurar grupo ou tag"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
        />
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} />
      ) : (
        <FlatList
          data={filteredGroups}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}

      <CreateGroupModal visible={showCreate} onClose={() => setShowCreate(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
    paddingTop: Platform.OS === "ios" ? 56 : 20,
  },
  title: { fontSize: 22, fontWeight: "900", color: colors.textMain },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    padding: 10,
    borderRadius: 10,
  },
  createText: { color: colors.white, marginLeft: 8 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.backgroundCard,
    padding: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  searchInput: { flex: 1, marginLeft: 8, color: colors.textMain },
  loading: { marginTop: 20 },
  listContent: { paddingVertical: 12 },
  card: {
    backgroundColor: colors.backgroundCard,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderColor: colors.border,
    borderWidth: 1,
  },
  cardInfo: { flexDirection: "row", alignItems: "center", flex: 1 },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: colors.white },
  textColumn: { marginLeft: 12, flex: 1 },
  groupName: { color: colors.textMain, fontWeight: "800" },
  tag: { color: colors.textMuted, fontWeight: "700" },
  desc: { color: colors.textMuted, fontSize: 12, maxWidth: 250 },
  memberColumn: { alignItems: "flex-end" },
  small: { color: colors.textMuted, fontSize: 12 },
  count: { color: colors.textMain, fontWeight: "900" },
});
