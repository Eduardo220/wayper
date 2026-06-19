import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../firebaseConfig";
import HomeHeader from "../components/Home/HomeHeader";
import ActiveFriendsRow from "../components/Home/ActiveFriendsRow";
import ActivityFeedCard from "../components/Home/ActivityFeedCard";
import HomeAvatar from "../components/Home/HomeAvatar";
import RoutePreview from "../components/Home/RoutePreview";
import ZonePreview from "../components/Home/ZonePreview";
import { WayperTheme } from "../theme/wayperTheme";
import {
  createRunStoryFromRun,
  loadSocialHome,
  SOCIAL_HOME_SOURCE,
  STORY_SYNC_STATUS,
} from "../repositories/socialHomeRepository";
import {
  formatNotificationDate,
  subscribeHomeNotifications,
  subscribeUnreadGroupMessages,
} from "../services/notifications/notificationService";
import { formatPaceFromSeconds } from "../utils/pace";

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatKmFromMeters(meters = 0, digits = 2) {
  return `${(safeNumber(meters) / 1000).toFixed(digits)} km`;
}

function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.round(safeNumber(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function formatArea(m2 = 0) {
  const area = Math.max(0, Math.round(safeNumber(m2)));
  if (area >= 1_000_000) return `${(area / 1_000_000).toFixed(2)} km2`;
  return `${area} m2`;
}

function formatPace(secondsPerKm) {
  const formatted = formatPaceFromSeconds(secondsPerKm);
  return formatted === "--:--" ? "--" : `${formatted}/km`;
}

function formatShortDate(value) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function formatRelativeTime(value) {
  const date = new Date(value || 0);
  const diffMs = Date.now() - date.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "agora";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

function formatSource(source) {
  if (source === SOCIAL_HOME_SOURCE.REMOTE) return "remoto";
  if (source === SOCIAL_HOME_SOURCE.CACHE) return "cache";
  if (source === SOCIAL_HOME_SOURCE.LOCAL) return "local";
  return "vazio";
}

function getNotificationIcon(type) {
  if (type === "like") return "heart";
  if (type === "comment") return "chatbubble-ellipses";
  if (type === "friend_request") return "person-add";
  if (type === "activity_post") return "pulse";
  return "notifications";
}

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

function SourcePill({ source, pending = false }) {
  const isCache = source === SOCIAL_HOME_SOURCE.CACHE;
  const isLocal = source === SOCIAL_HOME_SOURCE.LOCAL;
  const color = isCache ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <View style={[styles.sourcePill, isCache && styles.sourcePillCyan]}>
      <Ionicons
        name={pending ? "cloud-upload-outline" : isLocal ? "phone-portrait-outline" : isCache ? "cloud-offline-outline" : "cloud-done-outline"}
        size={14}
        color={color}
      />
      <Text style={[styles.sourcePillText, { color }]}>{pending ? "pendente" : formatSource(source)}</Text>
    </View>
  );
}

function FeedSectionHeader({ source, hasFeed }) {
  return (
    <View style={styles.feedHeader}>
      <View style={styles.feedTitleWrap}>
        <Text style={styles.feedTitle}>Feed social</Text>
        <Text style={styles.feedSubtitle}>
          {hasFeed ? "Corridas e atividades recentes." : "Nenhuma atividade real/cacheada encontrada."}
        </Text>
      </View>
      <SourcePill source={source} />
    </View>
  );
}

function NotificationsModal({ visible, notifications, onClose }) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.notificationSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle}>Notificacoes</Text>
              <Text style={styles.sheetSubtitle}>Curtidas, comentarios, amizades e avisos recentes.</Text>
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
                    <Text style={styles.notificationBody} numberOfLines={2}>{item.body || "Voce tem uma atualizacao nova."}</Text>
                  </View>
                  <Text style={styles.notificationTime}>{formatNotificationDate(item.createdAt)}</Text>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.notificationEmpty}>
              <Ionicons name="notifications-off-outline" size={26} color={WayperTheme.colors.textSubtle} />
              <Text style={styles.notificationEmptyTitle}>Nada novo por aqui</Text>
              <Text style={styles.notificationEmptyText}>Quando chegarem atualizacoes sociais, elas aparecem aqui.</Text>
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

function EmptyFeed({ onFriendsPress, onMapPress, onStoryPress }) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIcon}>
        <Ionicons name="pulse-outline" size={28} color={WayperTheme.colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>Nenhuma atividade recente ainda</Text>
      <Text style={styles.emptyText}>Adicione amigos, compartilhe uma corrida ou comece pelo mapa.</Text>
      <View style={styles.emptyActions}>
        <Pressable style={styles.emptyPrimary} onPress={onStoryPress}>
          <Ionicons name="add-circle-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.emptyPrimaryText}>Story</Text>
        </Pressable>
        <Pressable style={styles.emptySecondary} onPress={onFriendsPress}>
          <Ionicons name="people-outline" size={18} color={WayperTheme.colors.text} />
          <Text style={styles.emptySecondaryText}>Amigos</Text>
        </Pressable>
        <Pressable style={styles.emptySecondary} onPress={onMapPress}>
          <Ionicons name="map-outline" size={18} color={WayperTheme.colors.text} />
          <Text style={styles.emptySecondaryText}>Mapa</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PrimaryActionBar({ activeRun, pendingStories, onMapPress, onStoryPress }) {
  const hasActiveRun = !!activeRun?.activeRunId;
  return (
    <View style={styles.actionBar}>
      <TouchableOpacity activeOpacity={0.86} style={styles.primaryAction} onPress={onMapPress}>
        <Ionicons name={hasActiveRun ? "radio-outline" : "play-outline"} size={20} color={WayperTheme.colors.textInverse} />
        <Text style={styles.primaryActionText}>{hasActiveRun ? "Continuar corrida" : "Iniciar corrida"}</Text>
      </TouchableOpacity>
      <TouchableOpacity activeOpacity={0.86} style={styles.storyAction} onPress={onStoryPress}>
        <Ionicons name="add-circle-outline" size={20} color={WayperTheme.colors.primary} />
        <Text style={styles.storyActionText}>Adicionar ao story</Text>
      </TouchableOpacity>
      {pendingStories > 0 ? <SourcePill source={SOCIAL_HOME_SOURCE.LOCAL} pending /> : null}
    </View>
  );
}

function StoryTile({ story, onPress }) {
  const summary = story.runSummary || {};
  const isPending = story.syncStatus === STORY_SYNC_STATUS.PENDING_SYNC;
  return (
    <Pressable style={styles.storyTile} onPress={onPress}>
      <View style={[styles.storyAvatarRing, isPending && styles.storyAvatarPending]}>
        <HomeAvatar uri={story.actor?.avatar} name={story.actor?.name} size={62} />
      </View>
      <Text style={styles.storyName} numberOfLines={1}>{story.actor?.name || "Voce"}</Text>
      <Text style={styles.storyMeta} numberOfLines={1}>
        {summary.mode === "zones" ? "Zonas" : "Corrida"} - {formatRelativeTime(story.createdAt)}
      </Text>
    </Pressable>
  );
}

function StoriesRow({ stories, profile, onAddPress, onOpenStory }) {
  return (
    <View style={styles.storiesSection}>
      <View style={styles.storiesHeader}>
        <Text style={styles.storiesTitle}>Stories de corrida</Text>
        <Text style={styles.storiesSubtitle}>{stories.length ? "Atualizacoes reais/cacheadas." : "Sem stories ainda."}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesContent}>
        <Pressable style={styles.storyTile} onPress={onAddPress}>
          <View style={styles.addStoryRing}>
            <HomeAvatar uri={profile?.avatar} name={profile?.name || "Voce"} size={62} />
            <View style={styles.addStoryBadge}>
              <Ionicons name="add" size={17} color={WayperTheme.colors.textInverse} />
            </View>
          </View>
          <Text style={styles.storyName} numberOfLines={1}>Seu story</Text>
          <Text style={styles.storyMeta} numberOfLines={1}>Adicionar</Text>
        </Pressable>

        {stories.map((story) => (
          <StoryTile
            key={story.localId || story.remoteId}
            story={story}
            onPress={() => onOpenStory(story)}
          />
        ))}

        {!stories.length ? (
          <View style={styles.emptyStories}>
            <Ionicons name="images-outline" size={21} color={WayperTheme.colors.textSubtle} />
            <Text style={styles.emptyStoriesText}>Compartilhe uma corrida finalizada para preencher o topo.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function AddStoryModal({ visible, runs, creating, onCreate, onClose }) {
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.storySheet} onPress={(event) => event.stopPropagation?.()}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle}>Adicionar ao story</Text>
              <Text style={styles.sheetSubtitle}>Escolha uma corrida finalizada salva localmente.</Text>
            </View>
            <Pressable style={styles.sheetClose} onPress={onClose}>
              <Ionicons name="close" size={20} color={WayperTheme.colors.text} />
            </Pressable>
          </View>

          <View style={styles.storyTypeBox}>
            <View style={styles.storyTypeIcon}>
              <Ionicons name="card-outline" size={20} color={WayperTheme.colors.primary} />
            </View>
            <View style={styles.storyTypeCopy}>
              <Text style={styles.storyTypeTitle}>Card simples da corrida</Text>
              <Text style={styles.storyTypeText}>Salvo localmente com status PENDING_SYNC.</Text>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.runPickerList}>
            {runs.length ? (
              runs.map((run) => (
                <Pressable
                  key={run.id || run.localRunId || run.remoteRunId}
                  style={[styles.runPickerItem, run.alreadyInStory && styles.runPickerItemDisabled]}
                  onPress={() => !run.alreadyInStory && !creating && onCreate(run)}
                  disabled={run.alreadyInStory || creating}
                >
                  <View style={[styles.runPickerIcon, run.mode === "zones" && styles.runPickerIconCyan]}>
                    <Ionicons name={run.mode === "zones" ? "map-outline" : "walk-outline"} size={20} color={WayperTheme.colors.textInverse} />
                  </View>
                  <View style={styles.runPickerBody}>
                    <Text style={styles.runPickerTitle} numberOfLines={1}>{run.title}</Text>
                    <Text style={styles.runPickerMeta} numberOfLines={1}>
                      {formatShortDate(run.finishedAt)} - {formatKmFromMeters(run.distanceMeters)} - {formatDuration(run.durationSeconds)}
                    </Text>
                    {run.mode === "zones" ? (
                      <Text style={styles.runPickerArea}>{formatArea(run.territoryAreaM2)} conquistados</Text>
                    ) : null}
                  </View>
                  {run.alreadyInStory ? (
                    <Text style={styles.runPickerDone}>No story</Text>
                  ) : creating ? (
                    <ActivityIndicator size="small" color={WayperTheme.colors.primary} />
                  ) : (
                    <Ionicons name="add-circle-outline" size={25} color={WayperTheme.colors.primary} />
                  )}
                </Pressable>
              ))
            ) : (
              <View style={styles.storyEmptyRuns}>
                <Ionicons name="flag-outline" size={28} color={WayperTheme.colors.textSubtle} />
                <Text style={styles.storyEmptyTitle}>Sem corridas finalizadas</Text>
                <Text style={styles.storyEmptyText}>Corridas ativas ou em FINISHING nao aparecem aqui.</Text>
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function StoryViewerModal({ story, onClose }) {
  const visible = !!story;
  const summary = story?.runSummary || {};
  const isZone = summary.mode === "zones";
  const mediaUri = story?.media?.uri || null;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.viewerOverlay} onPress={onClose}>
        <Pressable style={styles.viewerCard} onPress={(event) => event.stopPropagation?.()}>
          <View style={styles.viewerHeader}>
            <HomeAvatar uri={story?.actor?.avatar} name={story?.actor?.name} size={46} />
            <View style={styles.viewerIdentity}>
              <Text style={styles.viewerName} numberOfLines={1}>{story?.actor?.name || "Voce"}</Text>
              <Text style={styles.viewerTime}>{formatRelativeTime(story?.createdAt)}</Text>
            </View>
            <Pressable style={styles.viewerClose} onPress={onClose}>
              <Ionicons name="close" size={20} color={WayperTheme.colors.text} />
            </Pressable>
          </View>
          <View style={styles.viewerPreview}>
            {mediaUri ? (
              <Image source={{ uri: mediaUri }} style={styles.viewerMedia} resizeMode={story?.media?.kind === "trace" ? "contain" : "cover"} />
            ) : isZone ? (
              <ZonePreview polygon={[]} />
            ) : (
              <RoutePreview path={[]} />
            )}
          </View>
          <Text style={styles.viewerTitle} numberOfLines={2}>{summary.title || "Corrida Wayper"}</Text>
          <View style={styles.viewerMetrics}>
            <Metric label="Distancia" value={formatKmFromMeters(summary.distanceMeters)} />
            <Metric label="Tempo" value={formatDuration(summary.durationSeconds)} />
            <Metric label="Pace" value={formatPace(summary.paceSecondsPerKm)} />
          </View>
          {isZone ? (
            <View style={styles.viewerArea}>
              <Text style={styles.viewerAreaLabel}>Area conquistada</Text>
              <Text style={styles.viewerAreaValue}>{formatArea(summary.territoryAreaM2)}</Text>
            </View>
          ) : null}
          {story?.syncStatus === STORY_SYNC_STATUS.PENDING_SYNC ? (
            <View style={styles.viewerPending}>
              <Ionicons name="cloud-upload-outline" size={17} color={WayperTheme.colors.primary} />
              <Text style={styles.viewerPendingText}>Story salvo localmente, aguardando sync futuro.</Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
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
  const [home, setHome] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingStory, setCreatingStory] = useState(false);
  const [storyPickerVisible, setStoryPickerVisible] = useState(false);
  const [viewerStory, setViewerStory] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [unreadGroupMessages, setUnreadGroupMessages] = useState(0);
  const didLoadRef = useRef(false);
  const mountedRef = useRef(true);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await loadSocialHome({ limit: 20 });
      if (mountedRef.current) setHome(data);
    } catch (error) {
      console.warn("[Home] load social home failed", error);
      if (mountedRef.current) setHome(null);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        didLoadRef.current = true;
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData({ silent: didLoadRef.current });
    }, [loadData])
  );

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setNotifications([]);
      setUnreadGroupMessages(0);
      return undefined;
    }

    let unsubscribeNotifications = () => {};
    let unsubscribeMessages = () => {};
    try {
      unsubscribeNotifications = subscribeHomeNotifications(uid, setNotifications);
    } catch {
      setNotifications([]);
    }
    try {
      unsubscribeMessages = subscribeUnreadGroupMessages(uid, setUnreadGroupMessages);
    } catch {
      setUnreadGroupMessages(0);
    }

    return () => {
      unsubscribeNotifications?.();
      unsubscribeMessages?.();
    };
  }, []);

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
  const goToMap = useCallback(() => {
    const activeRunId = home?.activeRun?.activeRunId;
    navigateRoot("Mapa", activeRunId ? { activeRunOpenRequestId: `${activeRunId}:${Date.now()}` } : undefined);
  }, [home?.activeRun?.activeRunId, navigateRoot]);

  const openActivityDetail = useCallback(
    (activity) => {
      navigation.navigate("ActivityDetail", {
        activity,
        run: buildRunDetailFromActivity(activity),
        runId: activity.runId || activity.id,
        localRunId: activity.localRunId || null,
        remoteRunId: activity.remoteRunId || null,
        readOnly: true,
      });
    },
    [navigation]
  );

  const hideAuthorActivities = useCallback((authorUid) => {
    if (!authorUid) return;
    setHome((current) => current
      ? { ...current, feedItems: current.feedItems.filter((item) => item.userId !== authorUid) }
      : current);
  }, []);

  const handleFriendRemoved = useCallback((authorUid) => {
    if (!authorUid) return;
    setHome((current) => current
      ? {
          ...current,
          feedItems: current.feedItems.filter((item) => item.userId !== authorUid),
          friends: current.friends.filter((item) => item.friendUid !== authorUid && item.id !== authorUid),
        }
      : current);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData({ silent: true });
  }, [loadData]);

  const handleCreateStory = useCallback(async (run) => {
    setCreatingStory(true);
    try {
      const result = await createRunStoryFromRun(run, {
        userId: home?.userId,
        profile: home?.profile,
        type: "run_card",
      });
      if (!result.duplicate) {
        setStoryPickerVisible(false);
      }
      await loadData({ silent: true });
    } catch (error) {
      console.warn("[Home] create story failed", error);
    } finally {
      if (mountedRef.current) setCreatingStory(false);
    }
  }, [home?.profile, home?.userId, loadData]);

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

  const friendsTitle = useMemo(() => {
    const hasPresence = home?.friends?.some((friend) => friend.hasPresence);
    return hasPresence ? "Ativos recentemente" : "Amigos recentes";
  }, [home?.friends]);

  const listHeader = useMemo(
    () => (
      <>
        <StoriesRow
          stories={home?.stories || []}
          profile={home?.profile || {}}
          onAddPress={() => setStoryPickerVisible(true)}
          onOpenStory={setViewerStory}
        />
        <PrimaryActionBar
          activeRun={home?.activeRun}
          pendingStories={home?.pendingStoryUploads?.length || 0}
          onMapPress={goToMap}
          onStoryPress={() => setStoryPickerVisible(true)}
        />
        <ActiveFriendsRow
          friends={home?.friends || []}
          title={friendsTitle}
          emptyText="Sem amigos ou presenca cacheada ainda."
          onAddPress={goToFriends}
          onSeeAllPress={goToFriends}
        />
        <FeedSectionHeader
          source={home?.source || SOCIAL_HOME_SOURCE.EMPTY}
          hasFeed={!!home?.states?.hasFeed}
        />
      </>
    ),
    [friendsTitle, goToFriends, goToMap, home]
  );

  const activities = home?.feedItems || [];

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={WayperTheme.colors.background} />
      <BackgroundMapTexture />
      <HomeHeader
        navigation={navigation}
        unreadMessages={unreadGroupMessages}
        notificationsCount={unreadNotifications}
        onNotificationsPress={() => setNotificationsVisible(true)}
        onMessagesPress={goToGroups}
      />

      <FlatList
        data={loading && !home ? [] : activities}
        keyExtractor={(item) => item.id}
        renderItem={renderActivity}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          loading && !home ? (
            <View style={styles.skeletonWrap}>
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : (
            <EmptyFeed
              onFriendsPress={goToFriends}
              onMapPress={goToMap}
              onStoryPress={() => setStoryPickerVisible(true)}
            />
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

      <AddStoryModal
        visible={storyPickerVisible}
        runs={home?.myRecentRunsForStory || []}
        creating={creatingStory}
        onCreate={handleCreateStory}
        onClose={() => setStoryPickerVisible(false)}
      />
      <StoryViewerModal story={viewerStory} onClose={() => setViewerStory(null)} />
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
    backgroundColor: WayperTheme.colors.background,
  },
  listContent: {
    paddingBottom: 34,
  },
  storiesSection: {
    marginTop: 18,
  },
  storiesHeader: {
    paddingHorizontal: WayperTheme.spacing.page,
    marginBottom: 13,
  },
  storiesTitle: {
    color: WayperTheme.colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  storiesSubtitle: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  storiesContent: {
    paddingHorizontal: WayperTheme.spacing.page,
    gap: 15,
  },
  storyTile: {
    width: 82,
    alignItems: "center",
  },
  addStoryRing: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: WayperTheme.colors.primary,
  },
  storyAvatarRing: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: WayperTheme.colors.primary,
  },
  storyAvatarPending: {
    borderColor: WayperTheme.colors.cyan,
  },
  addStoryBadge: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 2,
    borderColor: WayperTheme.colors.background,
  },
  storyName: {
    maxWidth: 82,
    color: WayperTheme.colors.text,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 8,
  },
  storyMeta: {
    maxWidth: 82,
    color: WayperTheme.colors.textSubtle,
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 2,
  },
  emptyStories: {
    minWidth: 210,
    minHeight: 80,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    paddingHorizontal: WayperTheme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
  },
  emptyStoriesText: {
    flex: 1,
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  actionBar: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.lg,
    padding: WayperTheme.spacing.md,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
    flexWrap: "wrap",
    ...WayperTheme.shadows.card,
  },
  primaryAction: {
    flexGrow: 1,
    minHeight: 48,
    minWidth: 150,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: WayperTheme.spacing.xs,
    paddingHorizontal: WayperTheme.spacing.md,
    ...WayperTheme.shadows.greenGlow,
  },
  primaryActionText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 14,
    fontWeight: "900",
  },
  storyAction: {
    flexGrow: 1,
    minHeight: 48,
    minWidth: 160,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: WayperTheme.spacing.xs,
    paddingHorizontal: WayperTheme.spacing.md,
  },
  storyActionText: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
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
  feedTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  feedTitle: {
    color: WayperTheme.colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  feedSubtitle: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  sourcePill: {
    minHeight: 30,
    borderRadius: WayperTheme.radius.pill,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  sourcePillCyan: {
    backgroundColor: WayperTheme.colors.cyanSoft,
    borderColor: WayperTheme.colors.cyanBorder,
  },
  sourcePillText: {
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
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
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
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
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
    flexWrap: "wrap",
    justifyContent: "center",
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
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
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
    borderColor: WayperTheme.colors.primaryBorder,
  },
  storySheet: {
    maxHeight: "84%",
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: "rgba(7, 16, 20, 0.98)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
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
    gap: WayperTheme.spacing.md,
    marginBottom: WayperTheme.spacing.md,
  },
  sheetTitleWrap: {
    flex: 1,
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
  notificationsList: {
    paddingBottom: WayperTheme.spacing.sm,
  },
  notificationItem: {
    minHeight: 76,
    borderRadius: 22,
    padding: WayperTheme.spacing.md,
    marginBottom: WayperTheme.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  notificationIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: WayperTheme.spacing.md,
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
    marginLeft: WayperTheme.spacing.sm,
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
    marginTop: WayperTheme.spacing.md,
  },
  notificationEmptyText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
    marginTop: WayperTheme.spacing.xs,
  },
  storyTypeBox: {
    minHeight: 74,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    padding: WayperTheme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.md,
    marginBottom: WayperTheme.spacing.md,
  },
  storyTypeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  storyTypeCopy: {
    flex: 1,
  },
  storyTypeTitle: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  storyTypeText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 2,
  },
  runPickerList: {
    paddingBottom: WayperTheme.spacing.sm,
  },
  runPickerItem: {
    minHeight: 88,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.md,
    marginBottom: WayperTheme.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.md,
  },
  runPickerItemDisabled: {
    opacity: 0.58,
  },
  runPickerIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
  },
  runPickerIconCyan: {
    backgroundColor: WayperTheme.colors.cyan,
  },
  runPickerBody: {
    flex: 1,
    minWidth: 0,
  },
  runPickerTitle: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  runPickerMeta: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  runPickerArea: {
    color: WayperTheme.colors.cyan,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 4,
  },
  runPickerDone: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: "900",
  },
  storyEmptyRuns: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.xl,
  },
  storyEmptyTitle: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: WayperTheme.spacing.md,
  },
  storyEmptyText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
    marginTop: WayperTheme.spacing.xs,
  },
  viewerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    justifyContent: "center",
    padding: WayperTheme.spacing.page,
  },
  viewerCard: {
    borderRadius: 30,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    padding: WayperTheme.spacing.lg,
    ...WayperTheme.shadows.card,
  },
  viewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: WayperTheme.spacing.md,
  },
  viewerIdentity: {
    flex: 1,
    minWidth: 0,
    marginLeft: WayperTheme.spacing.md,
  },
  viewerName: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  viewerTime: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  viewerClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  viewerPreview: {
    height: 190,
    borderRadius: WayperTheme.radius.xl,
    overflow: "hidden",
    backgroundColor: WayperTheme.colors.background,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  viewerMedia: {
    width: "100%",
    height: "100%",
    backgroundColor: WayperTheme.colors.background,
  },
  viewerTitle: {
    color: WayperTheme.colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    marginTop: WayperTheme.spacing.lg,
  },
  viewerMetrics: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.md,
  },
  metric: {
    flex: 1,
    minHeight: 64,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.sm,
  },
  metricLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricValue: {
    color: WayperTheme.colors.primary,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 5,
  },
  viewerArea: {
    minHeight: 70,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.cyanSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.cyanBorder,
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.md,
    marginTop: WayperTheme.spacing.md,
  },
  viewerAreaLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  viewerAreaValue: {
    color: WayperTheme.colors.cyan,
    fontSize: 24,
    fontWeight: "900",
    marginTop: 4,
  },
  viewerPending: {
    minHeight: 46,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
    paddingHorizontal: WayperTheme.spacing.md,
    marginTop: WayperTheme.spacing.md,
  },
  viewerPendingText: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
});
