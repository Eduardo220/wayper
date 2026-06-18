import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Keyboard,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { auth, db } from "../../firebaseConfig";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  createFriendRequest,
  rejectFriendRequest,
} from "../../services/friends/friendsService";
import { WayperTheme } from "../../theme/wayperTheme";
import HomeAvatar from "../../components/Home/HomeAvatar";

const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const formatKm = (meters = 0) => `${(safeNumber(meters) / 1000).toFixed(2)} km`;

const formatArea = (m2 = 0) => {
  const safe = safeNumber(m2);
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(2)} km2`;
  return `${Math.round(safe)} m2`;
};

const normalizeUser = (id, data = {}) => ({
  id,
  uid: id,
  avatar: data.avatar || data.photoURL || null,
  name: data.name || data.displayName || data.username || "Atleta Wayper",
  username: data.username || data.email?.split("@")?.[0] || "wayper",
  bio: data.bio || "",
  level: safeNumber(data.level, 1),
  xp: safeNumber(data.xp),
  totalDistance: safeNumber(data.totalDistance ?? data.distance),
  totalArea: safeNumber(data.totalArea ?? data.area),
  totalRuns: safeNumber(data.totalRuns),
  totalZones: safeNumber(data.totalZones ?? data.zones),
  isPrivate: !!data.isPrivate || data.profileVisibility === "private",
  raw: data,
});

async function fetchUser(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return normalizeUser(snap.id, snap.data());
}

async function searchUsers(term, currentUid) {
  const clean = String(term || "").trim().replace(/^@/, "");
  if (!clean) return [];

  const usersRef = collection(db, "users");
  const candidates = [
    ["username", clean],
    ["username", clean.toLowerCase()],
    ["name", clean],
    ["displayName", clean],
  ];
  const found = new Map();

  for (const [field, value] of candidates) {
    try {
      const snap = await getDocs(query(usersRef, where(field, "==", value)));
      snap.forEach((item) => {
        if (item.id !== currentUid) found.set(item.id, normalizeUser(item.id, item.data()));
      });
    } catch (error) {
      console.warn("[Friends] search query failed", field, error);
    }
  }

  return Array.from(found.values());
}

function sortFriends(a, b) {
  if (b.level !== a.level) return b.level - a.level;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

function StatPill({ label, value, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, { color }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ProfilePreviewCard({
  user,
  relation,
  onPress,
  onPrimary,
  onSecondary,
  primaryLabel,
  secondaryLabel,
  primaryIcon,
  secondaryIcon,
  loading,
}) {
  const isPrivate = user?.isPrivate;
  const relationLabel = {
    friend: "Amigo",
    pending_outgoing: "Solicitado",
    pending_incoming: "Solicitacao recebida",
    self: "Voce",
    none: "Novo contato",
  }[relation || "none"];

  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onPress} style={styles.previewShell}>
      <LinearGradient
        colors={["rgba(0,230,118,0.16)", "rgba(56,217,255,0.07)", WayperTheme.colors.surfaceElevated]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.previewCard}
      >
        <View style={styles.previewTop}>
          <View style={styles.avatarShell}>
            <HomeAvatar uri={user.avatar} name={user.name} size={76} />
          </View>

          <View style={styles.previewIdentity}>
            <View style={styles.previewNameRow}>
              <Text style={styles.previewName} numberOfLines={1}>{user.name}</Text>
              <View style={styles.relationPill}>
                <Text style={styles.relationText}>{relationLabel}</Text>
              </View>
            </View>
            <Text style={styles.previewUsername} numberOfLines={1}>@{user.username}</Text>
            <Text style={styles.previewBio} numberOfLines={2}>
              {isPrivate ? "Perfil privado. Envie uma solicitacao para acompanhar de perto." : user.bio || "Corredor Wayper em evolucao."}
            </Text>
          </View>
        </View>

        <View style={styles.previewStats}>
          <StatPill label="Nivel" value={user.level} />
          <StatPill label="Km" value={formatKm(user.totalDistance)} />
          <StatPill label="Zonas" value={user.totalZones} accent="cyan" />
          <StatPill label="Area" value={formatArea(user.totalArea)} accent="cyan" />
        </View>

        {(primaryLabel || secondaryLabel) ? (
          <View style={styles.previewActions}>
            {secondaryLabel ? (
              <TouchableOpacity activeOpacity={0.84} onPress={loading ? undefined : onSecondary} style={styles.secondaryAction}>
                {loading && !primaryLabel ? (
                  <ActivityIndicator size="small" color={WayperTheme.colors.text} />
                ) : (
                  <Ionicons name={secondaryIcon || "close-outline"} size={18} color={WayperTheme.colors.text} />
                )}
                <Text style={styles.secondaryActionText}>{secondaryLabel}</Text>
              </TouchableOpacity>
            ) : null}
            {primaryLabel ? (
              <TouchableOpacity activeOpacity={0.84} onPress={loading ? undefined : onPrimary} style={styles.primaryAction}>
                {loading ? (
                  <ActivityIndicator size="small" color={WayperTheme.colors.textInverse} />
                ) : (
                  <Ionicons name={primaryIcon || "person-add-outline"} size={18} color={WayperTheme.colors.textInverse} />
                )}
                <Text style={styles.primaryActionText}>{primaryLabel}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </LinearGradient>
    </TouchableOpacity>
  );
}

function TabButton({ label, count, active, onPress, icon }) {
  return (
    <TouchableOpacity activeOpacity={0.84} onPress={onPress} style={[styles.tabButton, active && styles.tabButtonActive]}>
      <Ionicons name={icon} size={16} color={active ? WayperTheme.colors.textInverse : WayperTheme.colors.textMuted} />
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      {count > 0 ? (
        <View style={[styles.tabCount, active && styles.tabCountActive]}>
          <Text style={[styles.tabCountText, active && styles.tabCountTextActive]}>{count}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export default function FriendsScreen({ navigation }) {
  const [friends, setFriends] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [activeTab, setActiveTab] = useState("friends");
  const [initialLoading, setInitialLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionKey, setActionKey] = useState(null);

  const mountedRef = useRef(true);
  const unsubFriendsRef = useRef(null);
  const unsubIncomingRef = useRef(null);
  const unsubOutgoingRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  const currentUid = auth.currentUser?.uid;

  const enrichRequests = useCallback(async (snapshot, direction) => {
    const current = auth.currentUser?.uid;
    const pending = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => item.status === "pending");

    const enriched = await Promise.all(
      pending.map(async (request) => {
        const otherUid = direction === "incoming" ? request.from : request.to;
        const user = await fetchUser(otherUid);
        if (!user || user.id === current) return null;
        return { ...request, user };
      })
    );

    return enriched.filter(Boolean);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const uid = auth.currentUser?.uid;

    if (!uid) {
      setFriends([]);
      setInitialLoading(false);
      return undefined;
    }

    unsubFriendsRef.current = onSnapshot(
      collection(db, "users", uid, "friends"),
      async (snapshot) => {
        try {
          const resolved = await Promise.all(
            snapshot.docs.map(async (friendDoc) => {
              const friendUid = friendDoc.data()?.friendId;
              const user = await fetchUser(friendUid);
              return user ? { ...user, friendDocId: friendDoc.id, friendUid } : null;
            })
          );
          if (mountedRef.current) {
            setFriends(resolved.filter(Boolean).sort(sortFriends));
            setInitialLoading(false);
          }
        } catch (error) {
          console.warn("[Friends] friends snapshot failed", error);
          if (mountedRef.current) setInitialLoading(false);
        }
      },
      (error) => {
        console.warn("[Friends] friends snapshot error", error);
        if (mountedRef.current) setInitialLoading(false);
      }
    );

    unsubIncomingRef.current = onSnapshot(
      query(collection(db, "friend_requests"), where("to", "==", uid)),
      async (snapshot) => {
        const list = await enrichRequests(snapshot, "incoming");
        if (mountedRef.current) setIncomingRequests(list);
      },
      (error) => console.warn("[Friends] incoming requests error", error)
    );

    unsubOutgoingRef.current = onSnapshot(
      query(collection(db, "friend_requests"), where("from", "==", uid)),
      async (snapshot) => {
        const list = await enrichRequests(snapshot, "outgoing");
        if (mountedRef.current) setOutgoingRequests(list);
      },
      (error) => console.warn("[Friends] outgoing requests error", error)
    );

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 360,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        speed: 18,
        bounciness: 7,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      mountedRef.current = false;
      try {
        unsubFriendsRef.current?.();
        unsubIncomingRef.current?.();
        unsubOutgoingRef.current?.();
      } catch {}
    };
  }, [enrichRequests, fadeAnim, slideAnim]);

  const friendIds = useMemo(() => new Set(friends.map((item) => item.uid || item.friendUid)), [friends]);
  const incomingIds = useMemo(() => new Set(incomingRequests.map((item) => item.from)), [incomingRequests]);
  const outgoingIds = useMemo(() => new Set(outgoingRequests.map((item) => item.to)), [outgoingRequests]);

  const getRelation = useCallback(
    (uid) => {
      if (!uid) return "none";
      if (uid === currentUid) return "self";
      if (friendIds.has(uid)) return "friend";
      if (outgoingIds.has(uid)) return "pending_outgoing";
      if (incomingIds.has(uid)) return "pending_incoming";
      return "none";
    },
    [currentUid, friendIds, incomingIds, outgoingIds]
  );

  const runSearch = useCallback(async () => {
    const term = searchText.trim();
    if (!term) {
      Alert.alert("Buscar amigos", "Digite um username ou nome para buscar.");
      return;
    }

    Keyboard.dismiss();
    setSearching(true);
    setActiveTab("search");
    try {
      const results = await searchUsers(term, currentUid);
      setSearchResults(results);
      if (results.length === 0) {
        Alert.alert("Buscar amigos", "Nenhuma pessoa encontrada.");
      }
    } catch (error) {
      console.warn("[Friends] search failed", error);
      Alert.alert("Erro", "Nao foi possivel buscar pessoas.");
    } finally {
      setSearching(false);
    }
  }, [currentUid, searchText]);

  const sendRequest = useCallback(async (user) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !user?.uid) return;

    setActionKey(`send-${user.uid}`);
    try {
      const result = await createFriendRequest({ fromUid: uid, toUid: user.uid });
      if (result?.alreadyFriends) {
        Alert.alert("Amigos", "Vocês ja sao amigos.");
      } else if (result?.autoAccepted) {
        Alert.alert("Amigos", "Solicitacao cruzada aceita. Agora voces sao amigos.");
      } else {
        Alert.alert("Solicitacao enviada", `Pedido enviado para ${user.name}.`);
      }
    } catch (error) {
      const code = String(error?.message || "");
      if (code.includes("request_exists") || code.includes("request_pending_cached")) {
        Alert.alert("Solicitacao", "Ja existe uma solicitacao pendente para essa pessoa.");
      } else if (code.includes("cannot_add_self")) {
        Alert.alert("Amigos", "Voce nao pode adicionar voce mesmo.");
      } else {
        console.warn("[Friends] send request failed", error);
        Alert.alert("Erro", "Nao foi possivel enviar a solicitacao.");
      }
    } finally {
      setActionKey(null);
    }
  }, []);

  const acceptRequest = useCallback(async (request) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !request?.id) return;

    setActionKey(`accept-${request.id}`);
    try {
      await acceptFriendRequest(request.id, uid);
      Alert.alert("Amigos", `${request.user?.name || "Pessoa"} agora e seu amigo.`);
    } catch (error) {
      console.warn("[Friends] accept failed", error);
      Alert.alert("Erro", "Nao foi possivel aceitar a solicitacao.");
    } finally {
      setActionKey(null);
    }
  }, []);

  const declineRequest = useCallback(async (request) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !request?.id) return;

    setActionKey(`decline-${request.id}`);
    try {
      await rejectFriendRequest(request.id, uid);
    } catch (error) {
      console.warn("[Friends] decline failed", error);
      Alert.alert("Erro", "Nao foi possivel recusar a solicitacao.");
    } finally {
      setActionKey(null);
    }
  }, []);

  const cancelRequest = useCallback(async (request) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !request?.id) return;

    setActionKey(`cancel-${request.id}`);
    try {
      await cancelFriendRequest(request.id, uid);
    } catch (error) {
      console.warn("[Friends] cancel failed", error);
      Alert.alert("Erro", "Nao foi possivel cancelar a solicitacao.");
    } finally {
      setActionKey(null);
    }
  }, []);

  const removeFriend = useCallback((friend) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !friend?.uid) return;

    Alert.alert("Remover amigo", `Remover ${friend.name} da sua lista?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover",
        style: "destructive",
        onPress: async () => {
          setActionKey(`remove-${friend.uid}`);
          try {
            const mySnap = await getDocs(query(collection(db, "users", uid, "friends"), where("friendId", "==", friend.uid)));
            await Promise.all(mySnap.docs.map((item) => deleteDoc(doc(db, "users", uid, "friends", item.id))));

            const otherSnap = await getDocs(query(collection(db, "users", friend.uid, "friends"), where("friendId", "==", uid)));
            await Promise.all(otherSnap.docs.map((item) => deleteDoc(doc(db, "users", friend.uid, "friends", item.id))));
          } catch (error) {
            console.warn("[Friends] remove failed", error);
            Alert.alert("Erro", "Nao foi possivel remover o amigo.");
          } finally {
            setActionKey(null);
          }
        },
      },
    ]);
  }, []);

  const openProfile = useCallback(
    (friendId) => {
      if (!friendId) return;
      navigation.navigate("FriendProfile", { friendId });
    },
    [navigation]
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (activeTab === "search" && searchText.trim()) await runSearch();
    } finally {
      setRefreshing(false);
    }
  }, [activeTab, runSearch, searchText]);

  const data = useMemo(() => {
    if (activeTab === "requests") return incomingRequests;
    if (activeTab === "sent") return outgoingRequests;
    if (activeTab === "search") return searchResults;
    return friends;
  }, [activeTab, friends, incomingRequests, outgoingRequests, searchResults]);

  const renderItem = useCallback(
    ({ item }) => {
      if (activeTab === "requests") {
        return (
          <ProfilePreviewCard
            user={item.user}
            relation="pending_incoming"
            onPress={() => openProfile(item.user?.uid)}
            primaryLabel="Aceitar"
            primaryIcon="checkmark-outline"
            secondaryLabel="Recusar"
            secondaryIcon="close-outline"
            onPrimary={() => acceptRequest(item)}
            onSecondary={() => declineRequest(item)}
            loading={actionKey === `accept-${item.id}` || actionKey === `decline-${item.id}`}
          />
        );
      }

      if (activeTab === "sent") {
        return (
          <ProfilePreviewCard
            user={item.user}
            relation="pending_outgoing"
            onPress={() => openProfile(item.user?.uid)}
            secondaryLabel="Cancelar"
            secondaryIcon="close-circle-outline"
            onSecondary={() => cancelRequest(item)}
            loading={actionKey === `cancel-${item.id}`}
          />
        );
      }

      if (activeTab === "search") {
        const relation = getRelation(item.uid);
        const incoming = incomingRequests.find((request) => request.from === item.uid);
        return (
          <ProfilePreviewCard
            user={item}
            relation={relation}
            onPress={() => openProfile(item.uid)}
            primaryLabel={relation === "none" ? "Adicionar" : relation === "pending_incoming" ? "Aceitar" : null}
            primaryIcon={relation === "pending_incoming" ? "checkmark-outline" : "person-add-outline"}
            secondaryLabel={relation === "pending_incoming" ? "Recusar" : null}
            secondaryIcon="close-outline"
            onPrimary={() => (relation === "pending_incoming" ? acceptRequest(incoming) : sendRequest(item))}
            onSecondary={() => declineRequest(incoming)}
            loading={actionKey === `send-${item.uid}` || actionKey === `accept-${incoming?.id}`}
          />
        );
      }

      return (
        <ProfilePreviewCard
          user={item}
          relation="friend"
          onPress={() => openProfile(item.uid)}
          primaryLabel="Ver perfil"
          primaryIcon="person-circle-outline"
          secondaryLabel="Remover"
          secondaryIcon="trash-outline"
          onPrimary={() => openProfile(item.uid)}
          onSecondary={() => removeFriend(item)}
          loading={actionKey === `remove-${item.uid}`}
        />
      );
    },
    [acceptRequest, actionKey, activeTab, cancelRequest, declineRequest, getRelation, incomingRequests, openProfile, removeFriend, sendRequest]
  );

  const emptyText = {
    friends: "Nenhum amigo ainda. Busque pessoas e envie uma solicitacao.",
    requests: "Nenhuma solicitacao recebida.",
    sent: "Nenhuma solicitacao enviada.",
    search: "Busque por username ou nome para encontrar pessoas.",
  }[activeTab];

  const renderHeader = useCallback(
    () => (
      <Animated.View style={[styles.headerWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <LinearGradient
          colors={["rgba(0,230,118,0.20)", "rgba(56,217,255,0.08)", "rgba(11,20,29,0.94)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <Ionicons name="people-outline" size={28} color={WayperTheme.colors.primary} />
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroEyebrow}>Wayper social</Text>
              <Text style={styles.heroTitle}>Amigos</Text>
              <Text style={styles.heroSubtitle}>Encontre atletas, envie solicitacoes e acompanhe a evolucao da galera.</Text>
            </View>
          </View>

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{friends.length}</Text>
              <Text style={styles.heroStatLabel}>Amigos</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{incomingRequests.length}</Text>
              <Text style={styles.heroStatLabel}>Pedidos</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.searchCard}>
          <Text style={styles.searchTitle}>Adicionar pessoas</Text>
          <Text style={styles.searchSubtitle}>Busque pelo username ou nome e envie uma solicitacao de amizade.</Text>
          <View style={styles.searchRow}>
            <View style={styles.searchInputShell}>
              <Ionicons name="search-outline" size={18} color={WayperTheme.colors.textSubtle} />
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                placeholder="@usuario ou nome"
                placeholderTextColor={WayperTheme.colors.textSubtle}
                style={styles.searchInput}
                returnKeyType="search"
                onSubmitEditing={runSearch}
              />
            </View>
            <TouchableOpacity activeOpacity={0.84} onPress={runSearch} style={styles.searchButton}>
              {searching ? (
                <ActivityIndicator size="small" color={WayperTheme.colors.textInverse} />
              ) : (
                <Ionicons name="arrow-forward" size={21} color={WayperTheme.colors.textInverse} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.tabsRow}>
          <TabButton label="Amigos" icon="people-outline" active={activeTab === "friends"} onPress={() => setActiveTab("friends")} count={friends.length} />
          <TabButton label="Buscar" icon="search-outline" active={activeTab === "search"} onPress={() => setActiveTab("search")} count={searchResults.length} />
        </View>
        <View style={styles.tabsRow}>
          <TabButton label="Solicitacoes" icon="mail-unread-outline" active={activeTab === "requests"} onPress={() => setActiveTab("requests")} count={incomingRequests.length} />
          <TabButton label="Enviadas" icon="paper-plane-outline" active={activeTab === "sent"} onPress={() => setActiveTab("sent")} count={outgoingRequests.length} />
        </View>

        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {activeTab === "friends" ? "Sua rede" : activeTab === "search" ? "Resultados" : activeTab === "requests" ? "Solicitacoes recebidas" : "Solicitacoes enviadas"}
          </Text>
          <Text style={styles.sectionCount}>{data.length}</Text>
        </View>
      </Animated.View>
    ),
    [
      activeTab,
      data.length,
      fadeAnim,
      friends.length,
      incomingRequests.length,
      outgoingRequests.length,
      runSearch,
      searchResults.length,
      searchText,
      searching,
      slideAnim,
    ]
  );

  if (initialLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={WayperTheme.colors.primary} />
        <Text style={styles.loadingText}>Carregando amigos...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id || item.uid)}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="person-add-outline" size={26} color={WayperTheme.colors.textSubtle} />
            <Text style={styles.emptyTitle}>Nada por aqui</Text>
            <Text style={styles.emptyText}>{emptyText}</Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={WayperTheme.colors.primary}
            colors={[WayperTheme.colors.primary]}
          />
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
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
    fontWeight: "700",
  },
  listContent: {
    paddingBottom: 44,
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
    width: 58,
    height: 58,
    borderRadius: 29,
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
    fontSize: 31,
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
    fontSize: 23,
    fontWeight: "900",
  },
  heroStatLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
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
    lineHeight: 19,
    marginTop: 3,
  },
  searchRow: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.md,
  },
  searchInputShell: {
    flex: 1,
    minHeight: 52,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: WayperTheme.spacing.lg,
    gap: WayperTheme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  searchButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    ...WayperTheme.shadows.greenGlow,
  },
  tabsRow: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.sm,
  },
  tabButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.xs,
  },
  tabButtonActive: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primaryLight,
  },
  tabText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  tabTextActive: {
    color: WayperTheme.colors.textInverse,
  },
  tabCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceElevated,
    paddingHorizontal: 6,
  },
  tabCountActive: {
    backgroundColor: "rgba(3,16,9,0.18)",
  },
  tabCountText: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  tabCountTextActive: {
    color: WayperTheme.colors.textInverse,
  },
  sectionTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: WayperTheme.spacing.xl,
    marginBottom: WayperTheme.spacing.sm,
  },
  sectionTitle: {
    color: WayperTheme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  sectionCount: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 13,
    fontWeight: "900",
  },
  previewShell: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.md,
  },
  previewCard: {
    borderRadius: WayperTheme.radius.xxl,
    padding: WayperTheme.spacing.lg,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  previewTop: {
    flexDirection: "row",
  },
  avatarShell: {
    width: 74,
    height: 74,
    borderRadius: 37,
    padding: 3,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: WayperTheme.spacing.md,
  },
  avatar: {
    width: "100%",
    height: "100%",
    borderRadius: 34,
    backgroundColor: WayperTheme.colors.surfaceSoft,
  },
  previewIdentity: {
    flex: 1,
  },
  previewNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
  },
  previewName: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  relationPill: {
    minHeight: 26,
    paddingHorizontal: WayperTheme.spacing.sm,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    justifyContent: "center",
  },
  relationText: {
    color: WayperTheme.colors.primary,
    fontSize: 10,
    fontWeight: "900",
  },
  previewUsername: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
  previewBio: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 6,
  },
  previewStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.lg,
  },
  statPill: {
    width: "48%",
    minHeight: 58,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.md,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "900",
  },
  statLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 10,
    fontWeight: "900",
    marginTop: 2,
    textTransform: "uppercase",
  },
  previewActions: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.lg,
  },
  primaryAction: {
    flex: 1,
    minHeight: 48,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.xs,
  },
  primaryActionText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 13,
    fontWeight: "900",
  },
  secondaryAction: {
    flex: 1,
    minHeight: 48,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.xs,
  },
  secondaryActionText: {
    color: WayperTheme.colors.text,
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
