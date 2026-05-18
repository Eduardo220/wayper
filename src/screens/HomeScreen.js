import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../firebaseConfig";
import { WayperTheme } from "../theme/wayperTheme";
import HomeHeader from "../components/Home/HomeHeader";
import ActiveFriendsRow from "../components/Home/ActiveFriendsRow";
import ActivityFeedCard from "../components/Home/ActivityFeedCard";
import { loadHomeFeedData } from "../services/feed/feedService";
import {
  formatNotificationDate,
  subscribeHomeNotifications,
  subscribeUnreadGroupMessages,
} from "../services/notifications/notificationService";

function BackgroundMapTexture() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
        <Path d="M-24 122 C62 92 98 162 176 128 S306 34 422 76" stroke="rgba(255,255,255,0.045)" strokeWidth="18" fill="none" strokeLinecap="round" />
        <Path d="M-20 306 C80 270 142 294 208 362 S312 448 424 390" stroke="rgba(255,255,255,0.040)" strokeWidth="13" fill="none" strokeLinecap="round" />
        <Path d="M40 -40 C72 106 66 208 96 306 S132 514 88 884" stroke="rgba(255,255,255,0.035)" strokeWidth="12" fill="none" strokeLinecap="round" />
        <Path d="M286 -42 C252 124 282 196 270 332 S224 578 288 900" stroke="rgba(0,230,118,0.050)" strokeWidth="10" fill="none" strokeLinecap="round" />
        <Line x1="-20" y1="568" x2="420" y2="462" stroke="rgba(0,230,118,0.055)" strokeWidth="2" />
        <Line x1="16" y1="718" x2="410" y2="632" stroke="rgba(255,255,255,0.035)" strokeWidth="8" strokeLinecap="round" />
        <Circle cx="324" cy="162" r="3" fill="rgba(0,230,118,0.20)" />
        <Circle cx="72" cy="492" r="2.5" fill="rgba(0,230,118,0.16)" />
      </Svg>
    </View>
  );
}

function FeedSectionHeader({ usedFallback }) {
  return (
    <View style={styles.feedHeader}>
      <View>
        <Text style={styles.feedTitle}>Feed social</Text>
        <Text style={styles.feedSubtitle}>Corridas e áreas conquistadas pela comunidade.</Text>
      </View>
      {usedFallback ? (
        <View style={styles.cachePill}>
          <Ionicons name="cloud-offline-outline" size={14} color={WayperTheme.colors.primary} />
          <Text style={styles.cachePillText}>cache</Text>
        </View>
      ) : null}
    </View>
  );
}

function getNotificationIcon(type) {
  if (type === "like") return "heart";
  if (type === "comment") return "chatbubble-ellipses";
  if (type === "friend_request") return "person-add";
  if (type === "activity_post") return "pulse";
  return "notifications";
}

function NotificationsModal({ visible, notifications, onClose }) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.notificationSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>Notificações</Text>
              <Text style={styles.sheetSubtitle}>Curtidas, comentários, amizades e avisos recentes.</Text>
            </View>
            <Pressable style={styles.sheetClose} onPress={onClose}>
              <Ionicons name="close" size={20} color={WayperTheme.colors.text} />
            </Pressable>
          </View>

          {notifications.length ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.notificationsList}>
              {notifications.map((item) => (
                <View key={item.id} style={styles.notificationItem}>
                  <View style={styles.notificationIcon}>
                    <Ionicons name={getNotificationIcon(item.type)} size={18} color={WayperTheme.colors.primary} />
                  </View>
                  <View style={styles.notificationTextWrap}>
                    <Text style={styles.notificationTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.notificationBody} numberOfLines={2}>{item.body || "Você tem uma atualização nova."}</Text>
                  </View>
                  <Text style={styles.notificationTime}>{formatNotificationDate(item.createdAt)}</Text>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.notificationEmpty}>
              <Ionicons name="notifications-off-outline" size={26} color={WayperTheme.colors.textSubtle} />
              <Text style={styles.notificationEmptyTitle}>Nada novo por aqui</Text>
              <Text style={styles.notificationEmptyText}>Quando chegarem curtidas, comentários ou pedidos de amizade, eles aparecem aqui.</Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonHeader}>
        <View style={styles.skeletonAvatar} />
        <View style={styles.skeletonLines}>
          <View style={[styles.skeletonLine, { width: "74%" }]} />
          <View style={[styles.skeletonLine, styles.skeletonLineSmall]} />
        </View>
      </View>
      <View style={styles.skeletonPreview} />
      <View style={styles.skeletonMetricRow}>
        <View style={styles.skeletonMetric} />
        <View style={styles.skeletonMetric} />
        <View style={styles.skeletonMetric} />
      </View>
    </View>
  );
}

function EmptyFeed({ onFriendsPress, onMapPress }) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIcon}>
        <Ionicons name="pulse-outline" size={28} color={WayperTheme.colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>Nenhuma atividade recente ainda</Text>
      <Text style={styles.emptyText}>Adicione amigos ou comece uma corrida para movimentar seu feed.</Text>
      <View style={styles.emptyActions}>
        <Pressable style={styles.emptyPrimary} onPress={onFriendsPress}>
          <Ionicons name="people-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.emptyPrimaryText}>Amigos</Text>
        </Pressable>
        <Pressable style={styles.emptySecondary} onPress={onMapPress}>
          <Ionicons name="map-outline" size={18} color={WayperTheme.colors.text} />
          <Text style={styles.emptySecondaryText}>Mapa</Text>
        </Pressable>
      </View>
    </View>
  );
}

function buildRunDetailFromActivity(activity = {}) {
  const isZone = activity.type === "zone";
  const distanceMeters = Math.max(0, Number(activity.distanceKm || 0) * 1000);
  const duration = Math.max(0, Number(activity.durationSeconds || 0));
  const avgSpeed = distanceMeters > 0 && duration > 0 ? Number(((distanceMeters / 1000) / (duration / 3600)).toFixed(2)) : 0;
  const userName = activity.userName || "Atleta Wayper";

  return {
    id: activity.runId || activity.zoneId || activity.id,
    name: activity.name || (isZone ? `${userName} conquistou uma nova area` : `${userName} concluiu uma corrida`),
    date: activity.createdAt || new Date().toISOString(),
    path: Array.isArray(activity.path) ? activity.path : [],
    distance: distanceMeters,
    duration,
    avgSpeed,
    mode: isZone ? "zones" : "free",
    area: isZone ? Number(activity.areaM2 || 0) : 0,
    zoneCoords: isZone && Array.isArray(activity.polygon) ? activity.polygon : [],
    zoneCount: isZone ? 1 : 0,
    effort: activity.effort ?? "--",
    notes: activity.description || activity.notes || "",
    tags: Array.isArray(activity.tags) ? activity.tags : [],
    photoUri: activity.photoUri || null,
    userName,
    userAvatar: activity.userAvatar || null,
    readOnly: true,
    socialActivity: true,
  };
}

export default function HomeScreen({ navigation }) {
  const [activities, setActivities] = useState([]);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [unreadGroupMessages, setUnreadGroupMessages] = useState(0);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await loadHomeFeedData({ limit: 20 });
      setActivities(data.activities || []);
      setFriends(data.friends || []);
      setUsedFallback(!!data.usedFallback);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setNotifications([]);
      setUnreadGroupMessages(0);
      return undefined;
    }

    const unsubscribeNotifications = subscribeHomeNotifications(uid, setNotifications);
    const unsubscribeMessages = subscribeUnreadGroupMessages(uid, setUnreadGroupMessages);

    return () => {
      unsubscribeNotifications?.();
      unsubscribeMessages?.();
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const navigateRoot = useCallback(
    (screen, params) => {
      const parent = navigation.getParent?.();
      if (parent) parent.navigate(screen, params);
      else navigation.navigate(screen, params);
    },
    [navigation]
  );
  const goToFriends = useCallback(() => navigateRoot("Amigos"), [navigateRoot]);
  const goToGroups = useCallback(() => navigateRoot("Grupos"), [navigateRoot]);
  const goToMap = useCallback(() => navigateRoot("Mapa"), [navigateRoot]);
  const openActivityDetail = useCallback(
    (activity) => {
      navigation.navigate("ActivityDetail", {
        activity,
        run: buildRunDetailFromActivity(activity),
        readOnly: true,
      });
    },
    [navigation]
  );
  const hideAuthorActivities = useCallback((authorUid) => {
    if (!authorUid) return;
    setActivities((current) => current.filter((item) => item.userId !== authorUid));
  }, []);
  const handleFriendRemoved = useCallback(
    (authorUid) => {
      if (!authorUid) return;
      setActivities((current) => current.filter((item) => item.userId !== authorUid));
      setFriends((current) => current.filter((item) => item.friendUid !== authorUid && item.id !== authorUid));
    },
    []
  );
  const renderActivity = useCallback(
    ({ item }) => (
      <ActivityFeedCard
        activity={item}
        onOpenActivity={() => openActivityDetail(item)}
        onAuthorMuted={hideAuthorActivities}
        onFriendRemoved={handleFriendRemoved}
      />
    ),
    [handleFriendRemoved, hideAuthorActivities, openActivityDetail]
  );
  const unreadNotifications = useMemo(
    () => notifications.filter((item) => !item.read).length,
    [notifications]
  );

  const listHeader = useMemo(
    () => (
      <>
        <ActiveFriendsRow friends={friends} onAddPress={goToFriends} onSeeAllPress={goToFriends} />
        <FeedSectionHeader usedFallback={!loading && usedFallback} />
      </>
    ),
    [friends, goToFriends, loading, usedFallback]
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor="#03080B" />
      <BackgroundMapTexture />
      <HomeHeader
        navigation={navigation}
        unreadMessages={unreadGroupMessages}
        notificationsCount={unreadNotifications}
        onNotificationsPress={() => setNotificationsVisible(true)}
        onMessagesPress={goToGroups}
      />

      <FlatList
        data={loading ? [] : activities}
        keyExtractor={(item) => item.id}
        renderItem={renderActivity}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          loading ? (
            <View style={styles.skeletonWrap}>
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : (
            <EmptyFeed onFriendsPress={goToFriends} onMapPress={goToMap} />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={WayperTheme.colors.primary}
            colors={[WayperTheme.colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />

      <NotificationsModal
        visible={notificationsVisible}
        notifications={notifications}
        onClose={() => setNotificationsVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#03080B",
  },
  listContent: {
    paddingBottom: 34,
  },
  feedHeader: {
    paddingHorizontal: WayperTheme.spacing.page,
    marginTop: 26,
    marginBottom: 14,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  feedTitle: {
    color: WayperTheme.colors.text,
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 0,
  },
  feedSubtitle: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  cachePill: {
    minHeight: 30,
    borderRadius: WayperTheme.radius.pill,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0, 230, 118, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.18)",
  },
  cachePillText: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  skeletonWrap: {
    paddingBottom: 8,
  },
  skeletonCard: {
    marginHorizontal: WayperTheme.spacing.page,
    marginBottom: 16,
    padding: 15,
    borderRadius: 28,
    backgroundColor: "#081217",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.13)",
  },
  skeletonHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  skeletonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  skeletonLines: {
    flex: 1,
    marginLeft: 12,
    gap: 8,
  },
  skeletonLine: {
    height: 13,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  skeletonLineSmall: {
    width: "44%",
    height: 10,
  },
  skeletonPreview: {
    height: 156,
    borderRadius: 22,
    marginTop: 14,
    backgroundColor: "rgba(255,255,255,0.055)",
  },
  skeletonMetricRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 13,
  },
  skeletonMetric: {
    flex: 1,
    height: 62,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  emptyCard: {
    marginHorizontal: WayperTheme.spacing.page,
    padding: 22,
    borderRadius: 28,
    alignItems: "center",
    backgroundColor: "#071014",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.18)",
  },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 230, 118, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.24)",
    marginBottom: 13,
  },
  emptyTitle: {
    color: WayperTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 7,
  },
  emptyActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 17,
  },
  emptyPrimary: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: WayperTheme.radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: WayperTheme.colors.primary,
  },
  emptyPrimaryText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 14,
    fontWeight: "900",
  },
  emptySecondary: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: WayperTheme.radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0B151A",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.18)",
  },
  emptySecondaryText: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  notificationSheet: {
    maxHeight: "76%",
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: "rgba(7, 16, 20, 0.98)",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.20)",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.borderStrong,
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 14,
  },
  sheetTitle: {
    color: WayperTheme.colors.text,
    fontSize: 22,
    fontWeight: "900",
  },
  sheetSubtitle: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  sheetClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  notificationItem: {
    minHeight: 76,
    borderRadius: 22,
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0B151A",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.14)",
  },
  notificationsList: {
    paddingBottom: 8,
  },
  notificationIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 230, 118, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.18)",
    marginRight: 12,
  },
  notificationTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  notificationTitle: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  notificationBody: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 3,
  },
  notificationTime: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: "900",
    marginLeft: 10,
  },
  notificationEmpty: {
    minHeight: 190,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.xl,
  },
  notificationEmptyTitle: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 12,
  },
  notificationEmptyText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 6,
  },
});
