import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../../firebaseConfig";
import { WayperTheme } from "../../theme/wayperTheme";

const DEFAULT_GROUP_AVATAR = "https://i.pravatar.cc/160?u=wayper_group_chat";

const normalizeGroup = (id, data = {}) => ({
  id,
  avatar: data.avatar || null,
  name: data.name || "Grupo Wayper",
  tag: String(data.tag || "WPR").replace(/^#/, "").toUpperCase(),
  description: data.description || "",
  nextRun: data.nextRun || "",
  membersCount: Number(data.membersCount) || 0,
});

const formatTime = (value) => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

function GroupAvatar({ group }) {
  const initials = String(group?.tag || group?.name || "WP").slice(0, 2).toUpperCase();

  if (group?.avatar) {
    return (
      <View style={styles.avatarFrame}>
        <Image source={{ uri: group.avatar || DEFAULT_GROUP_AVATAR }} style={styles.avatarImage} />
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[WayperTheme.colors.primary, WayperTheme.colors.cyan]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.avatarFrame}
    >
      <Text style={styles.avatarInitials}>{initials}</Text>
    </LinearGradient>
  );
}

export default function GroupChatScreen({ route, navigation }) {
  const groupId = route?.params?.groupId;
  const [group, setGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [isMember, setIsMember] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const flatRef = useRef(null);
  const user = auth.currentUser;

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
        console.warn("[GroupChat] group snapshot error", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [groupId, navigation]);

  useEffect(() => {
    const uid = user?.uid;
    if (!groupId || !uid) {
      setMembershipLoading(false);
      setIsMember(false);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, "groups", groupId, "members", uid),
      (snapshot) => {
        setIsMember(snapshot.exists());
        setMembershipLoading(false);
      },
      (error) => {
        console.warn("[GroupChat] membership snapshot error", error);
        setIsMember(false);
        setMembershipLoading(false);
      }
    );

    return () => unsubscribe();
  }, [groupId, user?.uid]);

  useEffect(() => {
    if (!groupId || !isMember) {
      setMessages([]);
      return undefined;
    }

    const msgRef = collection(db, "groups", groupId, "messages");
    const messagesQuery = query(msgRef, orderBy("createdAt", "asc"));

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const nextMessages = [];
        snapshot.forEach((docSnap) => nextMessages.push({ id: docSnap.id, ...docSnap.data() }));
        setMessages(nextMessages);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 120);
      },
      (error) => console.warn("[GroupChat] messages snapshot error", error)
    );

    return () => unsubscribe();
  }, [groupId, isMember]);

  const openDetails = useCallback(() => {
    if (groupId) navigation.navigate("GroupDetail", { groupId });
  }, [groupId, navigation]);

  const sendMsg = useCallback(async () => {
    const clean = text.trim();
    if (!clean || !user?.uid || !groupId || sending) return;

    setSending(true);
    try {
      await addDoc(collection(db, "groups", groupId, "messages"), {
        text: clean,
        userId: user.uid,
        fromUid: user.uid,
        username: user.displayName || user.email?.split("@")?.[0] || "Atleta Wayper",
        createdAt: serverTimestamp(),
        type: "text",
      });
      setText("");
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (error) {
      console.warn("[GroupChat] send message failed", error);
    } finally {
      setSending(false);
    }
  }, [groupId, sending, text, user?.displayName, user?.email, user?.uid]);

  const renderMessage = useCallback(
    ({ item }) => {
      const mine = item.userId === user?.uid || item.fromUid === user?.uid;
      const username = item.username || (mine ? "Voce" : "Membro");

      return (
        <View style={[styles.messageWrap, mine ? styles.messageWrapMine : styles.messageWrapOther]}>
          <LinearGradient
            colors={
              mine
                ? [WayperTheme.colors.primary, WayperTheme.colors.primaryDark]
                : [WayperTheme.colors.surfaceSoft, WayperTheme.colors.surfaceElevated]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.messageBubble, mine ? styles.messageBubbleMine : styles.messageBubbleOther]}
          >
            {!mine ? <Text style={styles.messageAuthor}>{username}</Text> : null}
            <Text style={[styles.messageText, mine && styles.messageTextMine]}>{item.text}</Text>
            <Text style={[styles.messageTime, mine && styles.messageTimeMine]}>{formatTime(item.createdAt)}</Text>
          </LinearGradient>
        </View>
      );
    },
    [user?.uid]
  );

  if (loading || membershipLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={WayperTheme.colors.primary} />
        <Text style={styles.loadingText}>Abrindo chat...</Text>
      </View>
    );
  }

  if (!isMember) {
    return (
      <View style={styles.lockedScreen}>
        <View style={styles.lockedIcon}>
          <Ionicons name="lock-closed-outline" size={34} color={WayperTheme.colors.primary} />
        </View>
        <Text style={styles.lockedTitle}>Chat fechado</Text>
        <Text style={styles.lockedText}>Entre no grupo para conversar com os membros.</Text>
        <TouchableOpacity activeOpacity={0.84} onPress={openDetails} style={styles.lockedButton}>
          <Text style={styles.lockedButtonText}>Ver grupo</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 92 : 0}
    >
      <LinearGradient
        colors={[WayperTheme.colors.background, WayperTheme.colors.backgroundAlt]}
        style={styles.chatHeader}
      >
        <TouchableOpacity activeOpacity={0.84} onPress={() => navigation.goBack()} style={styles.headerBack}>
          <Ionicons name="chevron-back" size={24} color={WayperTheme.colors.text} />
        </TouchableOpacity>

        <TouchableOpacity activeOpacity={0.88} onPress={openDetails} style={styles.headerGroup}>
          <GroupAvatar group={group} />
          <View style={styles.headerText}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerTitle} numberOfLines={1}>{group?.name || "Grupo"}</Text>
              <Ionicons name="information-circle-outline" size={17} color={WayperTheme.colors.primary} />
            </View>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              #{group?.tag || "WPR"}  •  {group?.membersCount || 0} membros
            </Text>
          </View>
        </TouchableOpacity>
      </LinearGradient>

      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyChat}>
            <Ionicons name="chatbubbles-outline" size={28} color={WayperTheme.colors.textSubtle} />
            <Text style={styles.emptyTitle}>Primeira mensagem?</Text>
            <Text style={styles.emptyText}>Combine a proxima corrida, chame a galera e mantenha o grupo vivo.</Text>
          </View>
        }
      />

      <View style={styles.composerWrap}>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Mensagem para o grupo..."
            placeholderTextColor={WayperTheme.colors.textSubtle}
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity
            activeOpacity={0.84}
            style={[styles.sendButton, !text.trim() && styles.sendButtonDisabled]}
            onPress={sendMsg}
            disabled={!text.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={WayperTheme.colors.textInverse} />
            ) : (
              <Ionicons name="send" color={WayperTheme.colors.textInverse} size={21} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
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
    color: WayperTheme.colors.textMuted,
    marginTop: WayperTheme.spacing.md,
    fontWeight: "800",
  },
  lockedScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.background,
    padding: WayperTheme.spacing.page,
  },
  lockedIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginBottom: WayperTheme.spacing.lg,
  },
  lockedTitle: {
    color: WayperTheme.colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  lockedText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    marginTop: WayperTheme.spacing.sm,
    lineHeight: 20,
  },
  lockedButton: {
    minHeight: 54,
    borderRadius: WayperTheme.radius.pill,
    paddingHorizontal: WayperTheme.spacing.xxl,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginTop: WayperTheme.spacing.xl,
    ...WayperTheme.shadows.greenGlow,
  },
  lockedButtonText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 15,
    fontWeight: "900",
  },
  chatHeader: {
    minHeight: 86,
    paddingHorizontal: WayperTheme.spacing.page,
    paddingVertical: WayperTheme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: WayperTheme.colors.border,
    flexDirection: "row",
    alignItems: "center",
  },
  headerBack: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginRight: WayperTheme.spacing.sm,
  },
  headerGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  avatarFrame: {
    width: 52,
    height: 52,
    borderRadius: 26,
    padding: 3,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    backgroundColor: WayperTheme.colors.primarySoft,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 23,
  },
  avatarInitials: {
    color: WayperTheme.colors.textInverse,
    fontSize: 17,
    fontWeight: "900",
  },
  headerText: {
    flex: 1,
    marginLeft: WayperTheme.spacing.md,
  },
  headerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.xs,
  },
  headerTitle: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  headerSubtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: WayperTheme.spacing.lg,
    paddingBottom: 116,
  },
  messageWrap: {
    width: "100%",
    marginBottom: WayperTheme.spacing.sm,
  },
  messageWrapMine: {
    alignItems: "flex-end",
  },
  messageWrapOther: {
    alignItems: "flex-start",
  },
  messageBubble: {
    maxWidth: "82%",
    borderRadius: 22,
    paddingHorizontal: WayperTheme.spacing.lg,
    paddingVertical: WayperTheme.spacing.md,
    borderWidth: 1,
  },
  messageBubbleMine: {
    borderBottomRightRadius: 8,
    borderColor: WayperTheme.colors.primaryLight,
  },
  messageBubbleOther: {
    borderBottomLeftRadius: 8,
    borderColor: WayperTheme.colors.borderStrong,
  },
  messageAuthor: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 4,
  },
  messageText: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
  messageTextMine: {
    color: WayperTheme.colors.textInverse,
  },
  messageTime: {
    alignSelf: "flex-end",
    color: WayperTheme.colors.textSubtle,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
  },
  messageTimeMine: {
    color: "rgba(3,16,9,0.64)",
  },
  emptyChat: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.xl,
  },
  emptyTitle: {
    color: WayperTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
    marginTop: WayperTheme.spacing.md,
  },
  emptyText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 20,
    marginTop: WayperTheme.spacing.xs,
  },
  composerWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: WayperTheme.spacing.sm,
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
    backgroundColor: "rgba(3,7,11,0.94)",
    borderTopWidth: 1,
    borderTopColor: WayperTheme.colors.border,
  },
  composer: {
    minHeight: 58,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    flexDirection: "row",
    alignItems: "flex-end",
    paddingLeft: WayperTheme.spacing.lg,
    paddingRight: WayperTheme.spacing.xs,
    paddingVertical: WayperTheme.spacing.xs,
  },
  input: {
    flex: 1,
    maxHeight: 112,
    minHeight: 44,
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "700",
    paddingVertical: 10,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    ...WayperTheme.shadows.greenGlow,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
});
