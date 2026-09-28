import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../../theme/wayperTheme";

export default function PermissionNotice({
  permissionType,
  required = false,
  title,
  description,
  primaryAction,
  secondaryAction,
  status,
  canAskAgain = true,
  compact = false,
  style,
}) {
  const iconName = permissionType === "notification"
    ? "notifications-outline"
    : permissionType === "background"
      ? "phone-portrait-outline"
      : permissionType === "location"
        ? "location-outline"
        : "image-outline";

  return (
    <View style={[styles.card, required && styles.requiredCard, compact && styles.compactCard, style]}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, required && styles.requiredIconWrap]}>
          <Ionicons name={iconName} size={compact ? 18 : 22} color={required ? WayperTheme.colors.warning : WayperTheme.colors.primary} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, compact && styles.compactTitle]}>{title}</Text>
          {status ? (
            <Text style={styles.meta}>
              {canAskAgain ? "Permissão pendente" : "Permissão bloqueada"}
            </Text>
          ) : null}
        </View>
      </View>

      <Text style={[styles.description, compact && styles.compactDescription]}>{description}</Text>

      <View style={styles.actions}>
        {secondaryAction ? (
          <TouchableOpacity
            activeOpacity={0.86}
            style={[styles.button, styles.secondaryButton]}
            onPress={secondaryAction.onPress}
          >
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>{secondaryAction.label}</Text>
          </TouchableOpacity>
        ) : null}

        {primaryAction ? (
          <TouchableOpacity
            activeOpacity={0.9}
            style={[styles.button, styles.primaryButton, !canAskAgain && styles.settingsButton]}
            onPress={primaryAction.onPress}
          >
            <Text style={styles.buttonText}>{primaryAction.label}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: WayperTheme.radius.xl,
    padding: WayperTheme.spacing.lg,
    backgroundColor: "rgba(11, 20, 29, 0.92)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    ...WayperTheme.shadows.card,
  },
  requiredCard: {
    borderColor: "rgba(255, 204, 51, 0.42)",
  },
  compactCard: {
    padding: WayperTheme.spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  requiredIconWrap: {
    backgroundColor: "rgba(255, 204, 51, 0.12)",
    borderColor: "rgba(255, 204, 51, 0.34)",
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  compactTitle: {
    fontSize: 15,
  },
  meta: {
    marginTop: 2,
    color: WayperTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  description: {
    marginTop: WayperTheme.spacing.md,
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  compactDescription: {
    fontSize: 12,
    lineHeight: 17,
  },
  actions: {
    marginTop: WayperTheme.spacing.lg,
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
  },
  button: {
    flex: 1,
    minHeight: 46,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.md,
  },
  primaryButton: {
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
  },
  settingsButton: {
    backgroundColor: WayperTheme.colors.warning,
    borderColor: WayperTheme.colors.warning,
  },
  secondaryButton: {
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
  },
  buttonText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  secondaryButtonText: {
    color: WayperTheme.colors.text,
  },
});
