import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function ProfileScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Meu Perfil</Text>
      <Text>Nome: Eduardo Weissheimer</Text>
      <Text>Nível: 7</Text>
      <Text>Zonas conquistadas: 12</Text>
      <Text>Total de km: 38.4</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 10 },
});
