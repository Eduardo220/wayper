import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { WayperTheme } from "../../theme/wayperTheme";

const ITEMS = [
  { label: "Minha área", color: WayperTheme.colors.primary, borderColor: WayperTheme.colors.primaryLight },
  { label: "Outro atleta", color: "#38d9ff", borderColor: "#38d9ff" },
  { label: "Líder local", color: "#ffd166", borderColor: "#ffd166", ring: true },
  { label: "Área recomendada", color: WayperTheme.colors.cyan, borderColor: WayperTheme.colors.cyanBorder, dash: true },
];

export function TerritoryLegend({ style }) {
  return (
    <View style={[styles.container, style]}>
      {ITEMS.map((item) => (
        <View key={item.label} style={styles.item}>
          <View
            style={[
              styles.swatch,
              {
                backgroundColor: item.color,
                borderColor: item.borderColor,
              },
              item.ring && styles.ring,
              item.dash && styles.dash,
            ]}
          />
          <Text style={styles.label}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

export default TerritoryLegend;

const styles = StyleSheet.create({
  container: {
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderColor: WayperTheme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: WayperTheme.spacing.md,
    gap: WayperTheme.spacing.sm,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    opacity: 0.85,
  },
  ring: {
    backgroundColor: "transparent",
    borderWidth: 3,
  },
  dash: {
    opacity: 0.45,
  },
  label: {
    ...WayperTheme.typography.caption,
    color: WayperTheme.colors.textMuted,
  },
});

