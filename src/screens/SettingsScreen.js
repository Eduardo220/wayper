import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../theme/wayperTheme.js";

export default function SettingsScreen({ navigation }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Configuracoes</Text>
      <TouchableOpacity
        activeOpacity={0.84}
        style={styles.row}
        onPress={() => navigation.navigate("Diagnostico")}
      >
        <View style={styles.icon}>
          <Ionicons name="pulse-outline" size={22} color={WayperTheme.colors.primary} />
        </View>
        <View style={styles.body}>
          <Text style={styles.rowTitle}>Diagnostico</Text>
          <Text style={styles.rowText}>Logs de corrida, GPS, background, storage e notificacao</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={WayperTheme.colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
    padding: WayperTheme.spacing.lg,
    gap: WayperTheme.spacing.lg,
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  row: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.md,
    padding: WayperTheme.spacing.md,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    borderRadius: WayperTheme.radius.sm,
    backgroundColor: WayperTheme.colors.surface,
  },
  icon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: WayperTheme.radius.sm,
    backgroundColor: WayperTheme.colors.primarySoft,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    color: WayperTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  rowText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
});
