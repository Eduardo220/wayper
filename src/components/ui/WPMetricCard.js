import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { WayperTheme } from "../../theme/wayperTheme";

export function WPMetricCard({ label, value, icon, accent = "green", style }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;

  return (
    <View style={[styles.card, style]}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={[styles.label, { color }]}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 86,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.lg,
    justifyContent: "center",
  },
  icon: {
    marginBottom: WayperTheme.spacing.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: "800",
    marginBottom: WayperTheme.spacing.xs,
  },
  value: {
    color: WayperTheme.colors.text,
    fontSize: 23,
    fontWeight: "800",
  },
});
