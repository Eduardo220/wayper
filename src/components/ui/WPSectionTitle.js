import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { WayperTheme } from "../../theme/wayperTheme";

export function WPSectionTitle({ title, subtitle, style }) {
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: WayperTheme.spacing.lg,
  },
  title: {
    ...WayperTheme.typography.screenTitle,
  },
  subtitle: {
    marginTop: WayperTheme.spacing.xs,
    ...WayperTheme.typography.body,
    color: WayperTheme.colors.textMuted,
  },
});
