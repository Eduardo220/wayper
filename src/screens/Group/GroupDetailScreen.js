import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
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
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebaseConfig";
import { WayperTheme } from "../../theme/wayperTheme";
import HomeAvatar from "../../components/Home/HomeAvatar";

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
});

const normalizeUser = (id, data = {}) => ({
  id,
  uid: id,
  avatar: data.avatar || data.photoURL || null,
  name: data.name || data.displayName || data.username || "Atleta Wayper",
  username: data.username || data.email?.split("@")?.[0] || "wayper",
  level: safeNumber(data.level, 1),
  totalDistance: safeNumber(data.totalDistance ?? data.distance),
  totalArea: safeNumber(data.totalArea ?? data.area),
});

const formatDate = (value) => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "Novo";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const formatKm = (meters = 0) => `${(safeNumber(meters) / 1000).toFixed(2)} km`;

const formatArea = (m2 = 0) => {
  const safe = safeNumber(m2);
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(2)} km2`;
  return `${Math.round(safe)} m2`;
};

function GroupAvatar({ group }) {
  const initials = String(group?.tag || group?.name || "WP").slice(0, 2).toUpperCase();

  if (group?.avatar) {
    return (
      <View style={styles.groupAvatarFrame}>
        <Image source={{ uri: group.avatar }} style={styles.groupAvatarImage} />
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[WayperTheme.colors.primary, WayperTheme.colors.cyan]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.groupAvatarFrame}
    >
      <Text style={styles.groupAvatarInitials}>{initials}</Text>
    </LinearGradient>
  );
}

function InfoTile({ icon, label, value, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <View style={styles.infoTile}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.infoLabel}>{label}</Text>
    </View>
  );
}

function MemberCard({ member, onPress }) {
  const user = member.user;
  const roleLabel = member.role === "owner" ? "Lider" : member.role === "coLeader" ? "Vice" : "Membro";

  return (
    <TouchableOpacity activeOpacity={0.86} onPress={onPress} style={styles.memberCard}>
      <HomeAvatar uri={user?.avatar || null} name={user?.name || member.nickname || member.uid} size={52} style={styles.memberAvatar} />
      <View style={styles.memberInfo}>
        <Text style={styles.memberName} numberOfLines={1}>{user?.name || member.nickname || member.uid}</Text>
        <Text style={styles.memberUsername} numberOfLines={1}>@{user?.username || "wayper"}</Text>
        <View style={styles.memberStats}>
          <Text style={styles.memberStat}>Nivel {user?.level || 1}</Text>
          <Text style={styles.memberDot}>•</Text>
          <Text style={styles.memberStat}>{formatKm(user?.totalDistance || 0)}</Text>
        </View>
      </View>
      <View style={styles.rolePill}>
        <Text style={styles.roleText}>{roleLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function GroupDetailScreen({ route, navigation }) {
  const groupId = route?.params?.groupId;
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [myGroups, setMyGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!groupId) {
      navigation.goBack();
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, "groups", groupId),
      (snapshot) => {
        if (snapshot.exists()) {
          setGroup(normalizeGroup(snapshot.id, snapshot.data()));
        } else {
          navigation.goBack();
        }
        setLoading(false);
      },
      (error) => {
        console.warn("[GroupDetail] group snapshot error", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [groupId, navigation]);

  useEffect(() => {
    if (!groupId) return undefined;

    const unsubscribe = onSnapshot(
      collection(db, "groups", groupId, "members"),
      async (snapshot) => {
        try {
          const resolved = await Promise.all(
            snapshot.docs.map(async (memberDoc) => {
              const data = memberDoc.data();
              const memberUid = data.uid || memberDoc.id;
              let user = null;

              try {
                const userSnap = await getDoc(doc(db, "users", memberUid));
                user = userSnap.exists() ? normalizeUser(userSnap.id, userSnap.data()) : null;
              } catch {}

              return {
                id: memberDoc.id,
                uid: memberUid,
                role: data.role || "member",
                joinedAt: data.joinedAt,
                nickname: data.nickname,
                user,
              };
            })
          );

          resolved.sort((a, b) => {
            const roleRank = { owner: 0, coLeader: 1, member: 2 };
            return (roleRank[a.role] ?? 2) - (roleRank[b.role] ?? 2);
          });

          setMembers(resolved);
        } catch (error) {
          console.warn("[GroupDetail] members snapshot error", error);
          setMembers([]);
        } finally {
          setMembersLoading(false);
        }
      },
      (error) => {
        console.warn("[GroupDetail] members listener error", error);
        setMembers([]);
        setMembersLoading(false);
      }
    );

    return () => unsubscribe();
  }, [groupId]);

  useEffect(() => {
    if (!uid) {
      setMyGroups([]);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "users", uid, "groups"),
      (snapshot) => {
        setMyGroups(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      (error) => {
        console.warn("[GroupDetail] user groups listener error", error);
        setMyGroups([]);
      }
    );

    return () => unsubscribe();
  }, [uid]);

  const myGroupIds = useMemo(
    () => new Set(myGroups.map((item) => item.groupId || item.id)),
    [myGroups]
  );

  const isMember = !!groupId && myGroupIds.has(groupId);
  const currentMember = members.find((item) => item.uid === uid);
  const leader = members.find((item) => item.role === "owner");

  const joinGroup = useCallback(async () => {
    if (!uid || !groupId || !group) return;

    if (myGroups.length > 0 && !myGroupIds.has(groupId)) {
      Alert.alert("Grupo ativo", "Voce ja esta em um grupo. Saia dele antes de entrar em outro.");
      return;
    }

    if (isMember) {
      navigation.navigate("GroupChat", { groupId });
      return;
    }

    setJoining(true);
    try {
      const memberRef = doc(db, "groups", groupId, "members", uid);
      const memberSnap = await getDoc(memberRef);

      await setDoc(memberRef, {
        uid,
        role: "member",
        joinedAt: serverTimestamp(),
      });

      await setDoc(doc(db, "users", uid, "groups", groupId), {
        groupId,
        role: "member",
        joinedAt: serverTimestamp(),
      });

      if (!memberSnap.exists()) {
        await updateDoc(doc(db, "groups", groupId), {
          membersCount: increment(1),
        });
      }

      navigation.navigate("GroupChat", { groupId });
    } catch (error) {
      console.warn("[GroupDetail] join group failed", error);
      Alert.alert("Erro", "Nao foi possivel entrar no grupo.");
    } finally {
      setJoining(false);
    }
  }, [group, groupId, isMember, myGroupIds, myGroups.length, navigation, uid]);

  const openMember = useCallback(
    (member) => {
      const memberUid = member?.uid;
      if (!memberUid) return;

      const parent = navigation.getParent?.();
      if (memberUid === uid) {
        parent?.navigate("Perfil");
        return;
      }

      parent?.navigate("Amigos", {
        screen: "FriendProfile",
        params: { friendId: memberUid },
      });
    },
    [navigation, uid]
  );

  if (loading || !group) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={WayperTheme.colors.primary} />
        <Text style={styles.loadingText}>Carregando grupo...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <LinearGradient
        colors={["rgba(0,230,118,0.20)", "rgba(56,217,255,0.08)", "rgba(11,20,29,0.97)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <TouchableOpacity activeOpacity={0.84} onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={23} color={WayperTheme.colors.text} />
        </TouchableOpacity>

        <View style={styles.heroMain}>
          <GroupAvatar group={group} />
          <View style={styles.heroText}>
            <Text style={styles.eyebrow}>Informacoes do grupo</Text>
            <Text style={styles.title} numberOfLines={2}>{group.name}</Text>
            <View style={styles.tagRow}>
              <View style={styles.tagPill}>
                <Text style={styles.tagText}>#{group.tag}</Text>
              </View>
              <Text style={styles.memberRoleText}>
                {isMember ? currentMember?.role === "owner" ? "Voce e lider" : "Voce e membro" : "Aberto para entrada"}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.description}>{group.description}</Text>

        <View style={styles.infoGrid}>
          <InfoTile icon="people-outline" label="Membros" value={group.membersCount || members.length} />
          <InfoTile icon="calendar-outline" label="Criado" value={formatDate(group.createdAt)} accent="cyan" />
          <InfoTile icon="shield-checkmark-outline" label="Lider" value={leader?.user?.name || "Wayper"} />
        </View>

        <TouchableOpacity
          activeOpacity={0.84}
          onPress={isMember ? () => navigation.navigate("GroupChat", { groupId }) : joinGroup}
          disabled={joining}
          style={styles.primaryAction}
        >
          {joining ? (
            <ActivityIndicator size="small" color={WayperTheme.colors.textInverse} />
          ) : (
            <Ionicons name={isMember ? "chatbubbles-outline" : "enter-outline"} size={19} color={WayperTheme.colors.textInverse} />
          )}
          <Text style={styles.primaryActionText}>{isMember ? "Abrir chat" : "Entrar no grupo"}</Text>
        </TouchableOpacity>
      </LinearGradient>

      {group.announcement ? (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="megaphone-outline" size={19} color={WayperTheme.colors.primary} />
            <Text style={styles.sectionTitle}>Anuncio</Text>
          </View>
          <Text style={styles.sectionText}>{group.announcement}</Text>
        </View>
      ) : null}

      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="flag-outline" size={19} color={WayperTheme.colors.cyan} />
          <Text style={styles.sectionTitle}>Proxima corrida</Text>
        </View>
        <Text style={styles.sectionText}>{group.nextRun || "Nenhuma corrida marcada ainda."}</Text>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="people-outline" size={19} color={WayperTheme.colors.primary} />
          <Text style={styles.sectionTitle}>Membros</Text>
          <Text style={styles.sectionCount}>{members.length}</Text>
        </View>

        {membersLoading ? (
          <ActivityIndicator color={WayperTheme.colors.primary} style={styles.membersLoading} />
        ) : members.length === 0 ? (
          <Text style={styles.sectionText}>Nenhum membro encontrado.</Text>
        ) : (
          members.map((member) => (
            <MemberCard key={member.id} member={member} onPress={() => openMember(member)} />
          ))
        )}
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="analytics-outline" size={19} color={WayperTheme.colors.cyan} />
          <Text style={styles.sectionTitle}>Resumo da equipe</Text>
        </View>
        <View style={styles.summaryRow}>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryValue}>{members.length}</Text>
            <Text style={styles.summaryLabel}>Atletas</Text>
          </View>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryValue}>{formatKm(members.reduce((sum, item) => sum + safeNumber(item.user?.totalDistance), 0))}</Text>
            <Text style={styles.summaryLabel}>Distancia</Text>
          </View>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryValue}>{formatArea(members.reduce((sum, item) => sum + safeNumber(item.user?.totalArea), 0))}</Text>
            <Text style={styles.summaryLabel}>Area</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
  },
  content: {
    padding: WayperTheme.spacing.page,
    paddingBottom: 46,
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
  hero: {
    borderRadius: WayperTheme.radius.xxl,
    padding: WayperTheme.spacing.xl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: WayperTheme.spacing.lg,
  },
  heroMain: {
    flexDirection: "row",
    alignItems: "center",
  },
  groupAvatarFrame: {
    width: 88,
    height: 88,
    borderRadius: 44,
    padding: 4,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    backgroundColor: WayperTheme.colors.primarySoft,
  },
  groupAvatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 40,
  },
  groupAvatarInitials: {
    color: WayperTheme.colors.textInverse,
    fontSize: 26,
    fontWeight: "900",
  },
  heroText: {
    flex: 1,
    marginLeft: WayperTheme.spacing.lg,
  },
  eyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 28,
    fontWeight: "900",
    marginTop: 2,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.sm,
  },
  tagPill: {
    minHeight: 28,
    paddingHorizontal: WayperTheme.spacing.md,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    justifyContent: "center",
  },
  tagText: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  memberRoleText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  description: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    marginTop: WayperTheme.spacing.lg,
  },
  infoGrid: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.lg,
  },
  infoTile: {
    flex: 1,
    minHeight: 78,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.md,
    justifyContent: "center",
  },
  infoValue: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 4,
  },
  infoLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    marginTop: 2,
  },
  primaryAction: {
    minHeight: 56,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.xl,
    ...WayperTheme.shadows.greenGlow,
  },
  primaryActionText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 15,
    fontWeight: "900",
  },
  sectionCard: {
    marginTop: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xxl,
    padding: WayperTheme.spacing.lg,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    ...WayperTheme.shadows.card,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
    marginBottom: WayperTheme.spacing.md,
  },
  sectionTitle: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  sectionCount: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "900",
  },
  sectionText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
  },
  membersLoading: {
    marginVertical: WayperTheme.spacing.lg,
  },
  memberCard: {
    minHeight: 80,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    marginTop: WayperTheme.spacing.sm,
  },
  memberAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: WayperTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  memberInfo: {
    flex: 1,
    marginLeft: WayperTheme.spacing.md,
  },
  memberName: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  memberUsername: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 1,
  },
  memberStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.xs,
    marginTop: 4,
  },
  memberStat: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: "800",
  },
  memberDot: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: "900",
  },
  rolePill: {
    minHeight: 30,
    paddingHorizontal: WayperTheme.spacing.md,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    justifyContent: "center",
  },
  roleText: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  summaryRow: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
  },
  summaryPill: {
    flex: 1,
    minHeight: 70,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.md,
  },
  summaryValue: {
    color: WayperTheme.colors.primary,
    fontSize: 15,
    fontWeight: "900",
  },
  summaryLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    marginTop: 2,
  },
});
