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
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";

import { auth, db } from "../../firebaseConfig";
import { colors } from "../../theme/colors";

export default function GroupChat({ groupId }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const flatRef = useRef(null);

  useEffect(() => {
    if (!groupId) return undefined;

    const messagesQuery = query(collection(db, "groups", groupId, "chat"), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const nextMessages = [];
      snapshot.forEach((docSnap) => nextMessages.push({ id: docSnap.id, ...docSnap.data() }));
      setMessages(nextMessages);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 200);
    });

    return () => unsubscribe();
  }, [groupId]);

  const send = async () => {
    const uid = auth.currentUser?.uid;
    if (!text.trim() || !uid) return;

    await addDoc(collection(db, "groups", groupId, "chat"), {
      fromUid: uid,
      text: text.trim(),
      createdAt: serverTimestamp(),
      type: "text",
    });
    setText("");
  };

  const renderItem = ({ item }) => {
    const me = item.fromUid === auth.currentUser?.uid;
    return (
      <View style={[styles.balloon, me ? styles.me : styles.other]}>
        <Text style={{ color: me ? colors.backgroundCard : colors.textMain }}>{item.text}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
      />
      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Escreve algo pro grupo..."
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <TouchableOpacity onPress={send} style={styles.sendBtn}>
          <Text style={styles.sendText}>Enviar</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingVertical: 8 },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    backgroundColor: colors.backgroundCard,
    padding: 10,
    borderRadius: 8,
    color: colors.textMain,
  },
  sendBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.primary,
    borderRadius: 8,
    marginLeft: 8,
  },
  sendText: { color: colors.white },
  balloon: { maxWidth: "78%", padding: 10, borderRadius: 10, marginHorizontal: 12, marginVertical: 6 },
  me: { alignSelf: "flex-end", backgroundColor: colors.primary },
  other: { alignSelf: "flex-start", backgroundColor: colors.backgroundCard },
});
