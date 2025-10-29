import React from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";

const mockFriends = [
  { id: "1", name: "Eduardo Weissheimer", level: 7, area: 4.3 },
  { id: "2", name: "Ana Lima", level: 5, area: 2.1 },
  { id: "3", name: "Rafael Costa", level: 6, area: 3.7 },
];

export default function FriendsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>👥 Meus Amigos</Text>

      <FlatList
        data={mockFriends}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.details}>Nível: {item.level}</Text>
            <Text style={styles.details}>Área total: {item.area} km²</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 20 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 10 },
  card: {
    backgroundColor: "#f3f3f3",
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
  },
  name: { fontSize: 16, fontWeight: "600" },
  details: { color: "#555" },
});
