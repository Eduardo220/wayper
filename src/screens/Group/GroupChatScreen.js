import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";

import { auth, db } from "../../firebaseConfig";
import { colors } from "../../theme/colors";

export default function GroupChatScreen({ route }) {
  const { groupId } = route.params;
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const flatRef = useRef(null);
  const user = auth.currentUser;

  useEffect(() => {
    if (!groupId) return undefined;

    const msgRef = collection(db, "groups", groupId, "messages");
    const messagesQuery = query(msgRef, orderBy("createdAt", "asc"));

    const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const nextMessages = [];
      snapshot.forEach((docSnap) => nextMessages.push({ id: docSnap.id, ...docSnap.data() }));
      setMessages(nextMessages);

      setTimeout(() => {
        flatRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });

    return () => unsubscribe();
  }, [groupId]);

  const sendMsg = async () => {
    if (!text.trim() || !user?.uid) return;

    try {
      await addDoc(collection(db, "groups", groupId, "messages"), {
        text: text.trim(),
        userId: user.uid,
        username: user.displayName || "misterioso",
        createdAt: serverTimestamp(),
      });
      setText("");

      setTimeout(() => {
        flatRef.current?.scrollToEnd({ animated: true });
      }, 80);
    } catch (error) {
      console.log("Erro ao enviar mensagem", error);
    }
  };

  const renderItem = ({ item }) => {
    const mine = item.userId === user?.uid;

    return (
      <View style={[styles.msgBox, mine ? styles.mine : styles.theirs]}>
        <Text style={styles.username}>{item.username}</Text>
        <Text style={styles.msg}>{item.text}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 70 : 0}
    >
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Fala algo pro grupo..."
          placeholderTextColor={colors.textSoft}
          value={text}
          onChangeText={setText}
        />

        <TouchableOpacity style={styles.sendBtn} onPress={sendMsg}>
          <Ionicons name="send" color={colors.white} size={22} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: { padding: 12, paddingBottom: 90 },
  msgBox: {
    maxWidth: "78%",
    padding: 10,
    borderRadius: 12,
    marginVertical: 6,
  },
  mine: {
    backgroundColor: colors.primary,
    alignSelf: "flex-end",
  },
  theirs: {
    backgroundColor: colors.backgroundCard,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "flex-start",
  },
  username: {
    color: colors.textSoft,
    fontSize: 11,
    marginBottom: 3,
  },
  msg: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "600",
  },
  inputRow: {
    position: "absolute",
    bottom: 0,
    flexDirection: "row",
    width: "100%",
    padding: 12,
    backgroundColor: colors.backgroundCard,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.white,
    fontSize: 14,
  },
  sendBtn: {
    marginLeft: 10,
    backgroundColor: colors.primary,
    width: 46,
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
