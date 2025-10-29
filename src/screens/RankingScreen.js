import React, { useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from "react-native";

const mockRanking = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `Usuário ${i + 1}`,
  zones: Math.floor(Math.random() * 50 + 1),
  area: (Math.random() * 12).toFixed(2),
}));

export default function RankingScreen() {
  const [filter, setFilter] = useState("zones");

  const sorted = [...mockRanking].sort((a, b) =>
    filter === "zones" ? b.zones - a.zones : b.area - a.area
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🏆 Ranking Global</Text>

      <View style={styles.filters}>
        <TouchableOpacity
          style={[styles.filterBtn, filter === "zones" && styles.active]}
          onPress={() => setFilter("zones")}
        >
          <Text style={styles.filterText}>Zonas Conquistadas</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, filter === "area" && styles.active]}
          onPress={() => setFilter("area")}
        >
          <Text style={styles.filterText}>Área Total (km²)</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item, index }) => (
          <View style={styles.item}>
            <Text style={styles.position}>{index + 1}º</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.info}>
                🗺️ {item.zones} zonas | 🌍 {item.area} km²
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 10 },
  filters: { flexDirection: "row", justifyContent: "space-around", marginBottom: 15 },
  filterBtn: { padding: 8, borderRadius: 8, backgroundColor: "#eee" },
  active: { backgroundColor: "#00b894" },
  filterText: { color: "#333", fontWeight: "600" },
  item: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 0.5, borderColor: "#ccc" },
  position: { width: 35, fontWeight: "bold", textAlign: "center" },
  name: { fontSize: 16, fontWeight: "600" },
  info: { color: "#555" },
});
