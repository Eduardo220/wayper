import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../../firebaseConfig";
import { WayperTheme } from "../../theme/wayperTheme";
import {
  formatActivityDate,
  formatAreaM2,
  formatDistanceKm,
  formatDuration,
  formatPace,
} from "../../services/feed/feedService";
import HomeAvatar from "./HomeAvatar";
import RoutePreview from "./RoutePreview";
import ZonePreview from "./ZonePreview";
import {
  addActivityComment,
  formatCommentDate,
  subscribeActivityComments,
  subscribeActivityInteractions,
  toggleActivityLike,
} from "../../services/feed/feedInteractionService";
import {
  getFeedAuthorPreference,
  muteActivityAuthor,
  removeFriendshipWithActivityAuthor,
  reportActivity,
  setAuthorPostNotifications,
} from "../../services/feed/feedPostActionsService";

function Metric({ label, value, accent = false, flex = 1 }) {
  return (
    <View style={[styles.metric, accent && styles.metricAccent, { flex }]}>
      <Text style={styles.metricLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.metricValue, accent && styles.metricValueAccent]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function SocialButton({ icon, label, onPress, active = false }) {
  const handlePress = useCallback((event) => {
    event?.stopPropagation?.();
    onPress?.();
  }, [onPress]);

  return (
    <Pressable accessibilityRole="button" style={[styles.socialButton, active && styles.socialButtonActive]} onPress={handlePress}>
      <Ionicons name={icon} size={19} color={active ? WayperTheme.colors.primary : WayperTheme.colors.textMuted} />
      <Text style={[styles.socialText, active && styles.socialTextActive]}>{label}</Text>
    </Pressable>
  );
}

function CommentsModal({ visible, activity, comments, text, sending, onChangeText, onSend, onClose }) {
  const renderComment = useCallback(({ item }) => (
    <View style={styles.commentItem}>
      <HomeAvatar uri={item.userAvatar} name={item.userName} size={38} />
      <View style={styles.commentBody}>
        <View style={styles.commentMetaRow}>
          <Text style={styles.commentName} numberOfLines={1}>{item.userName || "Atleta Wayper"}</Text>
          <Text style={styles.commentDate}>{formatCommentDate(item.createdAt)}</Text>
        </View>
        <Text style={styles.commentText}>{item.text}</Text>
      </View>
    </View>
  ), []);

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.commentsOverlay}>
        <Pressable style={styles.commentsBackdrop} onPress={onClose} />
        <View style={styles.commentsSheet}>
          <View style={styles.commentsHandle} />
          <View style={styles.commentsHeader}>
            <View>
              <Text style={styles.commentsTitle}>Comentários</Text>
              <Text style={styles.commentsSubtitle} numberOfLines={1}>
                {activity?.userName || "Atleta"} {activity?.type === "zone" ? "conquistou uma área" : "concluiu uma corrida"}
              </Text>
            </View>
            <Pressable style={styles.commentsClose} onPress={onClose}>
              <Ionicons name="close" size={20} color={WayperTheme.colors.text} />
            </Pressable>
          </View>

          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            renderItem={renderComment}
            style={styles.commentsList}
            contentContainerStyle={comments.length ? styles.commentsListContent : styles.commentsEmptyContent}
            ListEmptyComponent={
              <View style={styles.commentsEmpty}>
                <Ionicons name="chatbubble-outline" size={28} color={WayperTheme.colors.textSubtle} />
                <Text style={styles.commentsEmptyTitle}>Sem comentários ainda</Text>
                <Text style={styles.commentsEmptyText}>Seja o primeiro a comentar essa atividade.</Text>
              </View>
            }
          />

          <View style={styles.commentComposer}>
            <TextInput
              value={text}
              onChangeText={onChangeText}
              placeholder="Escreva um comentário..."
              placeholderTextColor={WayperTheme.colors.textSubtle}
              style={styles.commentInput}
              multiline
            />
            <Pressable
              style={[styles.commentSendButton, (!text.trim() || sending) && styles.commentSendButtonDisabled]}
              onPress={onSend}
              disabled={!text.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color={WayperTheme.colors.textInverse} />
              ) : (
                <Ionicons name="send" size={20} color={WayperTheme.colors.textInverse} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function OptionsModal({
  visible,
  activity,
  notifyEnabled,
  busyAction,
  isOwnActivity,
  onEnableNotifications,
  onMute,
  onRemoveFriend,
  onReport,
  onClose,
}) {
  const name = activity?.userName || "Atleta Wayper";
  const disabledFriendActions = isOwnActivity || !activity?.userId;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.optionsOverlay} onPress={onClose}>
        <Pressable style={styles.optionsSheet} onPress={(event) => event.stopPropagation?.()}>
          <View style={styles.optionsHandle} />
          <View style={styles.optionsHeader}>
            <View>
              <Text style={styles.optionsTitle}>Opcoes da atividade</Text>
              <Text style={styles.optionsSubtitle} numberOfLines={1}>{name}</Text>
            </View>
            <Pressable style={styles.optionsClose} onPress={onClose}>
              <Ionicons name="close" size={20} color={WayperTheme.colors.text} />
            </Pressable>
          </View>

          <OptionItem
            icon={notifyEnabled ? "notifications" : "notifications-outline"}
            title={notifyEnabled ? "Notificacoes ativadas" : "Ativar notificacoes"}
            description={`Receber avisos quando ${name} publicar uma atividade.`}
            disabled={disabledFriendActions || notifyEnabled || busyAction === "notify"}
            loading={busyAction === "notify"}
            onPress={onEnableNotifications}
          />
          <OptionItem
            icon="volume-mute-outline"
            title="Silenciar"
            description="Ocultar atividades dessa pessoa no seu feed."
            disabled={disabledFriendActions || busyAction === "mute"}
            loading={busyAction === "mute"}
            onPress={onMute}
          />
          <OptionItem
            icon="person-remove-outline"
            title="Remover amizade"
            description="Desfazer a conexao com essa pessoa."
            disabled={disabledFriendActions || busyAction === "remove"}
            loading={busyAction === "remove"}
            danger
            onPress={onRemoveFriend}
          />
          <OptionItem
            icon="flag-outline"
            title="Denunciar atividade"
            description="Enviar esta atividade para analise."
            disabled={busyAction === "report"}
            loading={busyAction === "report"}
            danger
            onPress={onReport}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function OptionItem({ icon, title, description, onPress, disabled = false, loading = false, danger = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.optionItem, danger && styles.optionItemDanger, disabled && styles.optionItemDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      <View style={[styles.optionIcon, danger && styles.optionIconDanger]}>
        {loading ? (
          <ActivityIndicator size="small" color={danger ? WayperTheme.colors.danger : WayperTheme.colors.primary} />
        ) : (
          <Ionicons name={icon} size={21} color={danger ? WayperTheme.colors.danger : WayperTheme.colors.primary} />
        )}
      </View>
      <View style={styles.optionCopy}>
        <Text style={[styles.optionTitle, danger && styles.optionTitleDanger]}>{title}</Text>
        <Text style={styles.optionDescription} numberOfLines={2}>{description}</Text>
      </View>
    </Pressable>
  );
}

function ActivityFeedCard({ activity, onOpenActivity, onAuthorMuted, onFriendRemoved }) {
  const isZone = activity?.type === "zone";
  const name = activity?.userName || "Atleta Wayper";
  const isOwnActivity = !!activity?.userId && activity.userId === auth.currentUser?.uid;
  const [likedByMe, setLikedByMe] = useState(false);
  const [likesCount, setLikesCount] = useState(Number(activity?.likesCount || 0));
  const [commentsCount, setCommentsCount] = useState(Number(activity?.commentsCount || 0));
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const activityText = isZone ? `${name} conquistou uma nova área` : `${name} concluiu uma corrida`;
  const shareText = isZone
    ? `${name} conquistou ${formatAreaM2(activity?.areaM2 || 0)} no Wayper.`
    : `${name} concluiu ${formatDistanceKm(activity?.distanceKm || 0)} no Wayper.`;

  useEffect(() => {
    return subscribeActivityInteractions(activity, (state) => {
      setLikesCount(Math.max(0, Number(state.likesCount || 0)));
      setCommentsCount(Math.max(0, Number(state.commentsCount || 0)));
      setLikedByMe(!!state.likedByMe);
    });
  }, [activity]);

  useEffect(() => {
    if (!commentsVisible) return undefined;
    return subscribeActivityComments(activity, setComments);
  }, [activity, commentsVisible]);

  useEffect(() => {
    let mounted = true;
    async function loadPreference() {
      const pref = await getFeedAuthorPreference(activity?.userId);
      if (mounted) setNotifyEnabled(!!pref.notifyPosts);
    }
    loadPreference();
    return () => {
      mounted = false;
    };
  }, [activity?.userId]);

  const likeIcon = useMemo(() => (likedByMe ? "heart" : "heart-outline"), [likedByMe]);

  const handleLike = useCallback(async () => {
    const previousLiked = likedByMe;
    const previousCount = likesCount;
    setLikedByMe(!previousLiked);
    setLikesCount(Math.max(0, previousCount + (previousLiked ? -1 : 1)));

    const result = await toggleActivityLike(activity);
    if (result === null) {
      setLikedByMe(previousLiked);
      setLikesCount(previousCount);
    }
  }, [activity, likedByMe, likesCount]);

  const handleComments = useCallback(() => {
    setCommentsVisible(true);
  }, []);

  const handleSendComment = useCallback(async () => {
    const clean = commentText.trim();
    if (!clean || sendingComment) return;
    setSendingComment(true);
    try {
      const id = await addActivityComment(activity, clean);
      if (id) setCommentText("");
    } finally {
      setSendingComment(false);
    }
  }, [activity, commentText, sendingComment]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({ title: "Wayper", message: shareText });
    } catch {}
  }, [shareText]);

  const guardFriendAction = useCallback(() => {
    if (isOwnActivity || !activity?.userId) {
      Alert.alert("Atividade propria", "Essas opcoes estao disponiveis para atividades de outros atletas.");
      return false;
    }
    return true;
  }, [activity?.userId, isOwnActivity]);

  const handleEnableNotifications = useCallback(async () => {
    if (!guardFriendAction() || busyAction) return;
    setBusyAction("notify");
    try {
      const result = await setAuthorPostNotifications(activity, true);
      if (!result?.ok) {
        Alert.alert("Notificacoes", "Nao foi possivel ativar notificacoes para essa pessoa.");
        return;
      }
      setNotifyEnabled(true);
      setOptionsVisible(false);
      Alert.alert("Notificacoes ativadas", `Voce recebera avisos quando ${name} publicar uma nova atividade.`);
    } finally {
      setBusyAction(null);
    }
  }, [activity, busyAction, guardFriendAction, name]);

  const handleMute = useCallback(async () => {
    if (!guardFriendAction() || busyAction) return;
    setBusyAction("mute");
    try {
      const result = await muteActivityAuthor(activity);
      if (!result?.ok) {
        Alert.alert("Silenciar", "Nao foi possivel silenciar essa pessoa.");
        return;
      }
      setOptionsVisible(false);
      onAuthorMuted?.(activity?.userId);
      Alert.alert("Atividades silenciadas", `${name} nao aparecera mais no seu feed.`);
    } finally {
      setBusyAction(null);
    }
  }, [activity, busyAction, guardFriendAction, name, onAuthorMuted]);

  const handleRemoveFriend = useCallback(() => {
    if (!guardFriendAction() || busyAction) return;
    setOptionsVisible(false);
    Alert.alert(
      "Remover amizade",
      `Tem certeza que deseja remover ${name} da sua lista de amigos?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Remover",
          style: "destructive",
          onPress: async () => {
            setBusyAction("remove");
            try {
              const result = await removeFriendshipWithActivityAuthor(activity);
              if (!result?.ok) {
                Alert.alert("Remover amizade", "Nao foi possivel desfazer essa amizade.");
                return;
              }
              onFriendRemoved?.(activity?.userId);
              Alert.alert("Amizade removida", `${name} foi removido dos seus amigos.`);
            } finally {
              setBusyAction(null);
            }
          },
        },
      ]
    );
  }, [activity, busyAction, guardFriendAction, name, onFriendRemoved]);

  const handleReport = useCallback(async () => {
    if (busyAction) return;
    setBusyAction("report");
    try {
      const result = await reportActivity(activity, "inappropriate");
      if (!result?.ok) {
        Alert.alert("Denunciar atividade", "Nao foi possivel enviar a denuncia agora.");
        return;
      }
      setOptionsVisible(false);
      Alert.alert("Denuncia enviada", "Obrigado. Vamos analisar essa atividade.");
    } finally {
      setBusyAction(null);
    }
  }, [activity, busyAction]);

  return (
    <Pressable accessibilityRole="button" style={styles.card} onPress={onOpenActivity}>
      <View style={styles.header}>
        <HomeAvatar uri={activity?.userAvatar} name={name} size={48} />
        <View style={styles.headerText}>
          <Text style={styles.activityTitle} numberOfLines={2}>{activityText}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {formatActivityDate(activity?.createdAt)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          style={styles.moreButton}
          onPress={(event) => {
            event?.stopPropagation?.();
            setOptionsVisible(true);
          }}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={WayperTheme.colors.textMuted} />
        </Pressable>
      </View>

      {activity?.isRecord ? (
        <View style={styles.recordBadge}>
          <Ionicons name="flash" size={13} color={WayperTheme.colors.textInverse} />
          <Text style={styles.recordText}>NOVO RECORDE</Text>
        </View>
      ) : null}

      <View style={styles.preview}>
        {isZone ? <ZonePreview polygon={activity?.polygon} /> : <RoutePreview path={activity?.path} />}
      </View>

      {isZone ? (
        <>
          <View style={styles.areaHighlight}>
            <Text style={styles.areaLabel}>Área conquistada</Text>
            <Text style={styles.areaValue}>{formatAreaM2(activity?.areaM2 || 0)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Metric label="Distância" value={formatDistanceKm(activity?.distanceKm || 0)} />
            <Metric label="Tempo" value={formatDuration(activity?.durationSeconds || 0)} />
            <Metric label="Ritmo médio" value={formatPace(activity?.avgPaceSecondsPerKm)} />
          </View>
        </>
      ) : (
        <View style={styles.metricGrid}>
          <Metric label="Distância" value={formatDistanceKm(activity?.distanceKm || 0)} />
          <Metric label="Ritmo médio" value={formatPace(activity?.avgPaceSecondsPerKm)} />
          <Metric label="Tempo" value={formatDuration(activity?.durationSeconds || 0)} />
          {activity?.elevationMeters != null ? (
            <Metric label="Elevação" value={`${Math.round(Number(activity.elevationMeters || 0))} m`} />
          ) : null}
        </View>
      )}

      <View style={styles.socialRow}>
        <SocialButton icon={likeIcon} label={String(likesCount)} onPress={handleLike} active={likedByMe} />
        <SocialButton icon="chatbubble-outline" label={String(commentsCount)} onPress={handleComments} />
        <SocialButton icon="share-social-outline" label="Compartilhar" onPress={handleShare} />
      </View>

      <CommentsModal
        visible={commentsVisible}
        activity={activity}
        comments={comments}
        text={commentText}
        sending={sendingComment}
        onChangeText={setCommentText}
        onSend={handleSendComment}
        onClose={() => setCommentsVisible(false)}
      />
      <OptionsModal
        visible={optionsVisible}
        activity={activity}
        notifyEnabled={notifyEnabled}
        busyAction={busyAction}
        isOwnActivity={isOwnActivity}
        onEnableNotifications={handleEnableNotifications}
        onMute={handleMute}
        onRemoveFriend={handleRemoveFriend}
        onReport={handleReport}
        onClose={() => setOptionsVisible(false)}
      />
    </Pressable>
  );
}

export default memo(ActivityFeedCard);

const styles = StyleSheet.create({
  card: {
    marginHorizontal: WayperTheme.spacing.page,
    marginBottom: 16,
    padding: 15,
    borderRadius: 28,
    backgroundColor: "#081217",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.18)",
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  activityTitle: {
    color: WayperTheme.colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    letterSpacing: 0,
  },
  meta: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  moreButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  optionsOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.58)",
    padding: WayperTheme.spacing.page,
  },
  optionsSheet: {
    borderRadius: 28,
    padding: 18,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  optionsHandle: {
    alignSelf: "center",
    width: 54,
    height: 5,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.borderStrong,
    marginBottom: 16,
  },
  optionsHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  optionsTitle: {
    color: WayperTheme.colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  optionsSubtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 3,
  },
  optionsClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  optionItem: {
    minHeight: 72,
    borderRadius: 20,
    padding: 12,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  optionItemDanger: {
    borderColor: WayperTheme.colors.dangerBorder,
    backgroundColor: "rgba(255, 51, 71, 0.08)",
  },
  optionItemDisabled: {
    opacity: 0.52,
  },
  optionIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  optionIconDanger: {
    backgroundColor: WayperTheme.colors.dangerSoft,
    borderColor: WayperTheme.colors.dangerBorder,
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  optionTitleDanger: {
    color: WayperTheme.colors.danger,
  },
  optionDescription: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 2,
  },
  recordBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 13,
    paddingHorizontal: 10,
    minHeight: 27,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
  },
  recordText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 11,
    fontWeight: "900",
  },
  preview: {
    height: 156,
    borderRadius: 22,
    overflow: "hidden",
    marginTop: 14,
    backgroundColor: "#050B0E",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.16)",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 13,
  },
  metricRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 10,
  },
  metric: {
    minWidth: "30%",
    minHeight: 65,
    borderRadius: 18,
    paddingHorizontal: 10,
    justifyContent: "center",
    backgroundColor: "#0B151A",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  metricAccent: {
    borderColor: "rgba(0, 230, 118, 0.28)",
    backgroundColor: "rgba(0, 230, 118, 0.10)",
  },
  metricLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricValue: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 5,
  },
  metricValueAccent: {
    color: WayperTheme.colors.primary,
  },
  areaHighlight: {
    minHeight: 76,
    borderRadius: 22,
    paddingHorizontal: 15,
    justifyContent: "center",
    marginTop: 13,
    backgroundColor: "rgba(0, 230, 118, 0.11)",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.30)",
  },
  areaLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  areaValue: {
    color: WayperTheme.colors.primary,
    fontSize: 29,
    lineHeight: 34,
    fontWeight: "900",
    marginTop: 4,
  },
  socialRow: {
    minHeight: 44,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  socialButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: WayperTheme.radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 8,
  },
  socialButtonActive: {
    backgroundColor: "rgba(0, 230, 118, 0.10)",
    borderColor: "rgba(0, 230, 118, 0.24)",
  },
  socialText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  socialTextActive: {
    color: WayperTheme.colors.primary,
  },
  commentsOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  commentsBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.64)",
  },
  commentsSheet: {
    maxHeight: "82%",
    minHeight: "56%",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 26 : 16,
    backgroundColor: "rgba(7, 16, 20, 0.98)",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.20)",
  },
  commentsHandle: {
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.borderStrong,
    marginBottom: 16,
  },
  commentsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 12,
  },
  commentsTitle: {
    color: WayperTheme.colors.text,
    fontSize: 22,
    fontWeight: "900",
  },
  commentsSubtitle: {
    maxWidth: 250,
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  commentsClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  commentsList: {
    flexGrow: 0,
  },
  commentsListContent: {
    paddingBottom: 12,
  },
  commentsEmptyContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  commentItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  commentBody: {
    flex: 1,
    marginLeft: 11,
  },
  commentMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  commentName: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  commentDate: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 10,
    fontWeight: "800",
  },
  commentText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    marginTop: 4,
  },
  commentsEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
  },
  commentsEmptyTitle: {
    color: WayperTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 11,
  },
  commentsEmptyText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 5,
  },
  commentComposer: {
    minHeight: 58,
    borderRadius: 28,
    paddingLeft: 15,
    paddingRight: 6,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.20)",
  },
  commentInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 108,
    paddingVertical: 10,
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  commentSendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
  },
  commentSendButtonDisabled: {
    opacity: 0.45,
  },
});
