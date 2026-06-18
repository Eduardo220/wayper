import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import CreateGroupModal from "../../components/Group/CreateGroupModal";
import { auth, db } from "../../firebaseConfig";
import { WayperTheme } from "../../theme/wayperTheme";

const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeGroup = (id, data = {}) => ({
  id,
  avatar: data.avatar || null,
  name: data.name || "Grupo Wayper",
  tag: String(data.tag || "WPR").replace(/^#/, "").toUpperCase(),
  description: data.description || "Corridas, zonas e evolucao em equipe.",
  announcement: data.announcement || "",
  nextRun: data.nextRun || "",
  ownerId: data.ownerId || "",
  membersCount: safeNumber(data.membersCount),
  public: data.public !== false,
  createdAt: data.createdAt,
  raw: data,
});

const formatDate = (value) => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "Novo";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

function GroupAvatar({ group, size = 62 }) {
  const initials = String(group?.tag || group?.name || "WP").slice(0, 2).toUpperCase();
  const radius = size / 2;

  if (group?.avatar) {
    return (
      <View style={[styles.avatarFrame, { width: size, height: size, borderRadius: radius }]}>
        <Image source={{ uri: group.avatar }} style={{ width: "100%", height: "100%", borderRadius: radius - 3 }} />
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[WayperTheme.colors.primary, WayperTheme.colors.cyan]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.avatarFrame, styles.avatarInitialsFrame, { width: size, height: size, borderRadius: radius }]}
    >
      <Text style={styles.avatarInitials}>{initials}</Text>
    </LinearGradient>
  );
}

function StatTile({ icon, label, value, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <View style={styles.statTile}>
      <Ionicons name={icon} size={17} color={color} />
      <Text style={styles.statTileValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statTileLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function GroupCard({
  group,
  member,
  currentGroupId,
  loading,
  onOpen,
  onJoin,
  onInfo,
}) {
  const blockedByAnotherGroup = !!currentGroupId && !member;

  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onOpen} style={styles.cardShell}>
      <LinearGradient
        colors={[
          member ? "rgba(0,230,118,0.18)" : "rgba(56,217,255,0.10)",
          "rgba(11,20,29,0.95)",
          WayperTheme.colors.surfaceElevated,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.groupCard, member && styles.groupCardActive]}
      >
        <View style={styles.groupTop}>
          <GroupAvatar group={group} />
          <View style={styles.groupMain}>
            <View style={styles.groupNameRow}>
              <Text style={styles.groupName} numberOfLines={1}>{group.name}</Text>
              <View style={[styles.tagPill, member && styles.tagPillActive]}>
                <Text style={[styles.tagText, member && styles.tagTextActive]}>#{group.tag}</Text>
              </View>
            </View>
            <Text style={styles.groupDescription} numberOfLines={2}>{group.description}</Text>
          </View>
        </View>

        <View style={styles.groupStats}>
          <StatTile icon="people-outline" label="Membros" value={group.membersCount || 0} />
          <StatTile icon="calendar-outline" label="Criado" value={formatDate(group.createdAt)} accent="cyan" />
          <StatTile icon="radio-outline" label="Status" value={member ? "Dentro" : group.public ? "Aberto" : "Privado"} />
        </View>

        {group.nextRun ? (
          <View style={styles.nextRunRow}>
            <Ionicons name="flag-outline" size={16} color={WayperTheme.colors.cyan} />
            <Text style={styles.nextRunText} numberOfLines={1}>Proxima corrida: {group.nextRun}</Text>
          </View>
        ) : null}

        <View style={styles.groupActions}>
          <TouchableOpacity activeOpacity={0.84} onPress={onInfo} style={styles.secondaryButton}>
            <Ionicons name="information-circle-outline" size={18} color={WayperTheme.colors.text} />
            <Text style={styles.secondaryButtonText}>Info</Text>
          </TouchableOpacity>

          {member ? (
            <TouchableOpacity activeOpacity={0.84} onPress={onOpen} style={styles.primaryButton}>
              <Ionicons name="chatbubbles-outline" size={18} color={WayperTheme.colors.textInverse} />
              <Text style={styles.primaryButtonText}>Abrir chat</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              activeOpacity={0.84}
              disabled={loading || blockedByAnotherGroup}
              onPress={onJoin}
              style={[styles.primaryButton, blockedByAnotherGroup && styles.primaryButtonDisabled]}
            >
              {loading ? (
                <ActivityIndicator size="small" color={WayperTheme.colors.textInverse} />
              ) : (
                <Ionicons name={blockedByAnotherGroup ? "lock-closed-outline" : "enter-outline"} size={18} color={WayperTheme.colors.textInverse} />
              )}
              <Text style={styles.primaryButtonText}>{blockedByAnotherGroup ? "Ja em grupo" : "Entrar"}</Text>
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

export default function GroupsScreen({ navigation }) {
  const [groups, setGroups] = useState([]);
  const [myGroups, setMyGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [joiningId, setJoiningId] = useState(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  const uid = auth.currentUser?.uid;

  useEffect(() => {
    const groupsQuery = query(collection(db, "groups"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      groupsQuery,
      (snapshot) => {
        const nextGroups = [];
        snapshot.forEach((docSnap) => nextGroups.push(normalizeGroup(docSnap.id, docSnap.data())));
        setGroups(nextGroups);
        setLoading(false);
      },
      (error) => {
        console.warn("[Groups] groups snapshot error", error);
        setLoading(false);
      }
    );

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 340,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        speed: 18,
        bounciness: 7,
        useNativeDriver: true,
      }),
    ]).start();

    return () => unsubscribe();
  }, [fadeAnim, slideAnim]);

  useEffect(() => {
    if (!uid) {
      setMyGroups([]);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "users", uid, "groups"),
      async (snapshot) => {
        try {
          const memberships = await Promise.all(
            snapshot.docs.map(async (memberDoc) => {
              const data = memberDoc.data();
              const groupId = data.groupId || memberDoc.id;
              const groupSnap = await getDoc(doc(db, "groups", groupId));
              if (!groupSnap.exists()) return null;

              return {
                id: memberDoc.id,
                groupId,
                role: data.role || "member",
                joinedAt: data.joinedAt,
                group: normalizeGroup(groupSnap.id, groupSnap.data()),
              };
            })
          );

          setMyGroups(memberships.filter(Boolean));
        } catch (error) {
          console.warn("[Groups] membership snapshot error", error);
          setMyGroups([]);
        }
      },
      (error) => {
        console.warn("[Groups] user groups snapshot error", error);
        setMyGroups([]);
      }
    );

    return () => unsubscribe();
  }, [uid]);

  const myGroupIds = useMemo(
    () => new Set(myGroups.map((item) => item.groupId)),
    [myGroups]
  );

  const activeMembership = myGroups[0] || null;
  const activeGroup = activeMembership?.group || null;

  const normalizedSearch = search.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      if (!normalizedSearch) return true;
      return (
        group.name.toLowerCase().includes(normalizedSearch) ||
        group.tag.toLowerCase().includes(normalizedSearch) ||
        group.description.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [groups, normalizedSearch]);

  const listGroups = useMemo(
    () => (activeGroup ? filteredGroups.filter((group) => group.id !== activeGroup.id) : filteredGroups),
    [activeGroup, filteredGroups]
  );

  const openGroup = useCallback(
    (group) => {
      if (!group?.id) return;
      if (myGroupIds.has(group.id)) {
        navigation.navigate("GroupChat", { groupId: group.id });
        return;
      }
      navigation.navigate("GroupDetail", { groupId: group.id });
    },
    [myGroupIds, navigation]
  );

  const openInfo = useCallback(
    (group) => {
      if (!group?.id) return;
      navigation.navigate("GroupDetail", { groupId: group.id });
    },
    [navigation]
  );

  const joinGroup = useCallback(
    async (group) => {
      if (!uid || !group?.id) return;

      if (myGroups.length > 0 && !myGroupIds.has(group.id)) {
        Alert.alert("Grupo ativo", "Voce ja esta em um grupo. Saia dele antes de entrar em outro.");
        return;
      }

      if (myGroupIds.has(group.id)) {
        navigation.navigate("GroupChat", { groupId: group.id });
        return;
      }

      setJoiningId(group.id);
      try {
        const memberRef = doc(db, "groups", group.id, "members", uid);
        const memberSnap = await getDoc(memberRef);

        await setDoc(memberRef, {
          uid,
          role: "member",
          joinedAt: serverTimestamp(),
        });

        await setDoc(doc(db, "users", uid, "groups", group.id), {
          groupId: group.id,
          role: "member",
          joinedAt: serverTimestamp(),
        });

        if (!memberSnap.exists()) {
          await updateDoc(doc(db, "groups", group.id), {
            membersCount: increment(1),
          });
        }

        navigation.navigate("GroupChat", { groupId: group.id });
      } catch (error) {
        console.warn("[Groups] join group failed", error);
        Alert.alert("Erro", "Nao foi possivel entrar no grupo.");
      } finally {
        setJoiningId(null);
      }
    },
    [myGroupIds, myGroups.length, navigation, uid]
  );

  const renderGroup = useCallback(
    ({ item }) => (
      <GroupCard
        group={item}
        member={myGroupIds.has(item.id)}
        currentGroupId={activeGroup?.id}
        loading={joiningId === item.id}
        onOpen={() => openGroup(item)}
        onInfo={() => openInfo(item)}
        onJoin={() => joinGroup(item)}
      />
    ),
    [activeGroup?.id, joinGroup, joiningId, myGroupIds, openGroup, openInfo]
  );

  const renderHeader = useCallback(
    () => (
      <Animated.View style={[styles.headerWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <LinearGradient
          colors={["rgba(0,230,118,0.22)", "rgba(56,217,255,0.08)", "rgba(11,20,29,0.96)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <Ionicons name="chatbubbles-outline" size={30} color={WayperTheme.colors.primary} />
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroEyebrow}>Wayper squads</Text>
              <Text style={styles.heroTitle}>Grupos</Text>
              <Text style={styles.heroSubtitle}>
                {activeGroup
                  ? "Seu grupo esta pronto. Abra o chat para combinar corridas e acompanhar a equipe."
                  : "Escolha um grupo para correr junto, disputar zonas e conversar em tempo real."}
              </Text>
            </View>
          </View>

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{groups.length}</Text>
              <Text style={styles.heroStatLabel}>Grupos publicos</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{activeGroup ? activeGroup.membersCount || 1 : 0}</Text>
              <Text style={styles.heroStatLabel}>{activeGroup ? "No seu grupo" : "Seu grupo"}</Text>
            </View>
          </View>
        </LinearGradient>

        {activeGroup ? (
          <View style={styles.currentGroupBlock}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Seu grupo</Text>
              <Text style={styles.sectionHint}>Toque para abrir o chat</Text>
            </View>
            <GroupCard
              group={activeGroup}
              member
              currentGroupId={activeGroup.id}
              loading={false}
              onOpen={() => navigation.navigate("GroupChat", { groupId: activeGroup.id })}
              onInfo={() => navigation.navigate("GroupDetail", { groupId: activeGroup.id })}
            />
          </View>
        ) : (
          <View style={styles.createPrompt}>
            <View style={styles.createPromptIcon}>
              <Ionicons name="sparkles-outline" size={22} color={WayperTheme.colors.primary} />
            </View>
            <View style={styles.createPromptText}>
              <Text style={styles.createPromptTitle}>Ainda sem grupo</Text>
              <Text style={styles.createPromptSubtitle}>Entre em um grupo existente ou crie o seu.</Text>
            </View>
            <TouchableOpacity activeOpacity={0.84} onPress={() => setShowCreate(true)} style={styles.createButtonCompact}>
              <Ionicons name="add" size={20} color={WayperTheme.colors.textInverse} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.searchCard}>
          <View>
            <Text style={styles.searchTitle}>Pesquisar grupos</Text>
            <Text style={styles.searchSubtitle}>Busque por nome, tag ou estilo de corrida.</Text>
          </View>
          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={18} color={WayperTheme.colors.textSubtle} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Wayper, WPR, longao..."
              placeholderTextColor={WayperTheme.colors.textSubtle}
              style={styles.searchInput}
              autoCapitalize="none"
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch("")} style={styles.clearSearch}>
                <Ionicons name="close" size={16} color={WayperTheme.colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>{activeGroup ? "Explorar grupos" : "Escolha seu grupo"}</Text>
          <TouchableOpacity
            activeOpacity={0.84}
            disabled={!!activeGroup}
            onPress={() => setShowCreate(true)}
            style={[styles.createButton, activeGroup && styles.createButtonDisabled]}
          >
            <Ionicons name={activeGroup ? "lock-closed-outline" : "add"} size={18} color={WayperTheme.colors.textInverse} />
            <Text style={styles.createButtonText}>Criar</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    ),
    [
      activeGroup,
      fadeAnim,
      groups.length,
      navigation,
      search,
      slideAnim,
    ]
  );

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={WayperTheme.colors.primary} />
        <Text style={styles.loadingText}>Carregando grupos...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={listGroups}
        keyExtractor={(item) => item.id}
        renderItem={renderGroup}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="search-outline" size={26} color={WayperTheme.colors.textSubtle} />
            <Text style={styles.emptyTitle}>Nenhum grupo encontrado</Text>
            <Text style={styles.emptyText}>Tente outra busca ou crie um grupo novo para sua turma.</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      <CreateGroupModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(groupId) => {
          setShowCreate(false);
          if (groupId) navigation.navigate("GroupChat", { groupId });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.background,
  },
  loadingText: {
    marginTop: WayperTheme.spacing.md,
    color: WayperTheme.colors.textMuted,
    fontWeight: "800",
  },
  listContent: {
    paddingBottom: 46,
  },
  headerWrap: {
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: WayperTheme.spacing.xl,
  },
  hero: {
    borderRadius: WayperTheme.radius.xxl,
    padding: WayperTheme.spacing.xl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: WayperTheme.spacing.md,
  },
  heroText: {
    flex: 1,
  },
  heroEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  heroTitle: {
    color: WayperTheme.colors.text,
    fontSize: 32,
    fontWeight: "900",
    marginTop: 2,
  },
  heroSubtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: 4,
  },
  heroStats: {
    flexDirection: "row",
    gap: WayperTheme.spacing.md,
    marginTop: WayperTheme.spacing.xl,
  },
  heroStat: {
    flex: 1,
    minHeight: 72,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.lg,
  },
  heroStatValue: {
    color: WayperTheme.colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  heroStatLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  currentGroupBlock: {
    marginTop: WayperTheme.spacing.xl,
  },
  createPrompt: {
    marginTop: WayperTheme.spacing.xl,
    minHeight: 88,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    ...WayperTheme.shadows.card,
  },
  createPromptIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  createPromptText: {
    flex: 1,
    marginLeft: WayperTheme.spacing.md,
  },
  createPromptTitle: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  createPromptSubtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  createButtonCompact: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
  },
  searchCard: {
    marginTop: WayperTheme.spacing.lg,
    padding: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    ...WayperTheme.shadows.card,
  },
  searchTitle: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  searchSubtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 2,
  },
  searchRow: {
    minHeight: 52,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: WayperTheme.spacing.lg,
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.md,
  },
  searchInput: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  clearSearch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceMuted,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: WayperTheme.spacing.xl,
    marginBottom: WayperTheme.spacing.sm,
  },
  sectionTitle: {
    color: WayperTheme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  sectionHint: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "800",
  },
  createButton: {
    minHeight: 42,
    borderRadius: WayperTheme.radius.pill,
    paddingHorizontal: WayperTheme.spacing.lg,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.xs,
  },
  createButtonDisabled: {
    opacity: 0.4,
  },
  createButtonText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 13,
    fontWeight: "900",
  },
  cardShell: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.md,
  },
  groupCard: {
    borderRadius: WayperTheme.radius.xxl,
    padding: WayperTheme.spacing.lg,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  groupCardActive: {
    borderColor: WayperTheme.colors.primaryBorder,
  },
  groupTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarFrame: {
    padding: 3,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    backgroundColor: WayperTheme.colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitialsFrame: {
    padding: 0,
  },
  avatarInitials: {
    color: WayperTheme.colors.textInverse,
    fontSize: 20,
    fontWeight: "900",
  },
  groupMain: {
    flex: 1,
    marginLeft: WayperTheme.spacing.md,
  },
  groupNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
  },
  groupName: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  tagPill: {
    minHeight: 26,
    paddingHorizontal: WayperTheme.spacing.sm,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.cyanSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.cyanBorder,
    justifyContent: "center",
  },
  tagPillActive: {
    backgroundColor: WayperTheme.colors.primarySoft,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  tagText: {
    color: WayperTheme.colors.cyan,
    fontSize: 10,
    fontWeight: "900",
  },
  tagTextActive: {
    color: WayperTheme.colors.primary,
  },
  groupDescription: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 6,
  },
  groupStats: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.lg,
  },
  statTile: {
    flex: 1,
    minHeight: 74,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.md,
  },
  statTileValue: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  statTileLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    marginTop: 2,
  },
  nextRunRow: {
    marginTop: WayperTheme.spacing.md,
    minHeight: 42,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.cyanSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.cyanBorder,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: WayperTheme.spacing.lg,
    gap: WayperTheme.spacing.sm,
  },
  nextRunText: {
    flex: 1,
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  groupActions: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.lg,
  },
  secondaryButton: {
    flex: 0.75,
    minHeight: 48,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: WayperTheme.spacing.xs,
  },
  secondaryButtonText: {
    color: WayperTheme.colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  primaryButton: {
    flex: 1.25,
    minHeight: 48,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: WayperTheme.spacing.xs,
    ...WayperTheme.shadows.greenGlow,
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 13,
    fontWeight: "900",
  },
  emptyCard: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.lg,
    minHeight: 160,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: WayperTheme.spacing.xl,
  },
  emptyTitle: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: WayperTheme.spacing.md,
  },
  emptyText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginTop: WayperTheme.spacing.xs,
    lineHeight: 19,
  },
});
