import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from "react-native";

const mockMembers = [
  { id: "1", name: "Eduardo Weissheimer", level: 7, area: 4.3 },
  { id: "2", name: "Marina Rocha", level: 6, area: 3.8 },
  { id: "3", name: "Carlos Dias", level: 4, area: 2.1 },
];

export default function ClubsScreen() {
  const [messages, setMessages] = useState([
    { id: 1, user: "Marina Rocha", text: "Bora correr amanhã 7h?" },
    { id: 2, user: "Eduardo Weissheimer", text: "Tô dentro! Rota do parque?" },
  ]);
  const [input, setInput] = useState("");

  const sendMessage = () => {
    if (!input.trim()) return;
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), user: "Você", text: input.trim() },
    ]);
    setInput("");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🏃 Clube Wayper</Text>

      <Text style={styles.subtitle}>Membros ({mockMembers.length})</Text>
      <FlatList
        data={mockMembers}
        horizontal
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.member}>
            <Text style={styles.memberName}>{item.name}</Text>
            <Text style={styles.memberInfo}>
              Nível {item.level} • {item.area} km²
            </Text>
          </View>
        )}
      />

      <View style={styles.chatContainer}>
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.message}>
              <Text style={styles.user}>{item.user}:</Text>
              <Text style={styles.text}>{item.text}</Text>
            </View>
          )}
        />
      </View>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Digite uma mensagem..."
          value={input}
          onChangeText={setInput}
        />
        <TouchableOpacity style={styles.btn} onPress={sendMessage}>
          <Text style={{ color: "#fff", fontWeight: "bold" }}>Enviar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 15, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 5 },
  subtitle: { fontSize: 16, marginBottom: 8, color: "#555" },
  member: {
    backgroundColor: "#f0f0f0",
    borderRadius: 10,
    padding: 10,
    marginRight: 10,
  },
  memberName: { fontWeight: "bold" },
  memberInfo: { fontSize: 12, color: "#555" },
  chatContainer: { flex: 1, marginVertical: 10 },
  message: { marginBottom: 8 },
  user: { fontWeight: "bold", color: "#00b894" },
  text: { fontSize: 15 },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderColor: "#ddd",
    paddingTop: 5,
  },
  input: {
    flex: 1,
    backgroundColor: "#f2f2f2",
    borderRadius: 8,
    padding: 10,
    marginRight: 8,
  },
  btn: {
    backgroundColor: "#00b894",
    padding: 10,
    borderRadius: 8,
  },
});
