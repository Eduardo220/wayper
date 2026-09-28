import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../../theme/wayperTheme";

const ICON_BY_VARIANT = {
  empty: "sparkles-outline",
  error: "warning-outline",
  offline: "cloud-offline-outline",
  permission: "shield-checkmark-outline",
  loading: "radio-outline",
  retry: "refresh-outline",
};

const COLOR_BY_VARIANT = {
  empty: WayperTheme.colors.primary,
  error: WayperTheme.colors.danger,
  offline: WayperTheme.colors.cyan,
  permission: WayperTheme.colors.warning,
  loading: WayperTheme.colors.primary,
  retry: WayperTheme.colors.primary,
};

export function ScreenState({
  variant = "empty",
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  compact = false,
  style,
}) {
  const stateIcon = icon || ICON_BY_VARIANT[variant] || ICON_BY_VARIANT.empty;
  const color = COLOR_BY_VARIANT[variant] || WayperTheme.colors.primary;

  return (
    <View style={[styles.card, compact && styles.compactCard, style]}>
      <View style={[styles.iconWrap, { borderColor: color, backgroundColor: `${color}22` }]}>
        {variant === "loading" ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <Ionicons name={stateIcon} size={compact ? 20 : 28} color={color} />
        )}
      </View>
      {title ? <Text style={[styles.title, compact && styles.compactTitle]}>{title}</Text> : null}
      {description ? <Text style={[styles.description, compact && styles.compactDescription]}>{description}</Text> : null}
      {(actionLabel && onAction) || (secondaryLabel && onSecondary) ? (
        <View style={styles.actions}>
          {secondaryLabel && onSecondary ? (
            <Pressable style={[styles.button, styles.secondaryButton]} onPress={onSecondary}>
              <Text style={[styles.buttonText, styles.secondaryButtonText]}>{secondaryLabel}</Text>
            </Pressable>
          ) : null}
          {actionLabel && onAction ? (
            <Pressable style={[styles.button, styles.primaryButton]} onPress={onAction}>
              <Text style={styles.buttonText}>{actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export const EmptyState = (props) => <ScreenState variant="empty" {...props} />;
export const ErrorState = (props) => <ScreenState variant="error" {...props} />;
export const OfflineState = (props) => <ScreenState variant="offline" {...props} />;
export const PermissionState = (props) => <ScreenState variant="permission" {...props} />;
export const LoadingState = (props) => <ScreenState variant="loading" {...props} />;
export const RetryState = (props) => <ScreenState variant="retry" {...props} />;

const styles = StyleSheet.create({
  card: {
    marginHorizontal: WayperTheme.spacing.page,
    padding: WayperTheme.spacing.xl,
    borderRadius: WayperTheme.radius.xl,
    alignItems: "center",
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  compactCard: {
    marginHorizontal: 0,
    padding: WayperTheme.spacing.lg,
  },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginBottom: WayperTheme.spacing.md,
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
    textAlign: "center",
  },
  compactTitle: {
    fontSize: 16,
    lineHeight: 21,
  },
  description: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
    marginTop: WayperTheme.spacing.xs,
  },
  compactDescription: {
    fontSize: 12,
    lineHeight: 17,
  },
  actions: {
    marginTop: WayperTheme.spacing.lg,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: WayperTheme.spacing.sm,
  },
  button: {
    minHeight: 44,
    minWidth: 124,
    borderRadius: WayperTheme.radius.pill,
    paddingHorizontal: WayperTheme.spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
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

export default ScreenState;
