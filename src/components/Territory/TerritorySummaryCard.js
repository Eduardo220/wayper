import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { WPCard } from "../ui/WPCard";
import { WayperTheme } from "../../theme/wayperTheme";

function formatArea(areaM2) {
  const area = Number(areaM2 || 0);
  if (!Number.isFinite(area) || area <= 0) return "0 m²";
  if (area >= 1000000) return `${(area / 1000000).toFixed(2)} km²`;
  return `${Math.round(area).toLocaleString("pt-BR")} m²`;
}

export function TerritorySummaryCard({ territory, currentUserId, compact = false, style }) {
  if (!territory) return null;

  const ownerId = territory.ownerId || territory.userId;
  const isMine = Boolean(ownerId && currentUserId && String(ownerId) === String(currentUserId));
  const ownerName = territory.ownerName || territory.userName || "Atleta Wayper";
  const areaM2 = territory.areaM2 ?? territory.area;
  const leaderName = territory.leaderName || territory.leaderUserName || null;

  return (
    <WPCard style={[styles.card, compact && styles.compact, style]} glow={isMine}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>{isMine ? "Minha área" : "Território"}</Text>
          <Text style={styles.title} numberOfLines={1}>{ownerName}</Text>
        </View>
        <View style={[styles.badge, isMine && styles.mineBadge]}>
          <Text style={[styles.badgeText, isMine && styles.mineBadgeText]}>{isMine ? "Seu" : "Ativo"}</Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <View>
          <Text style={styles.metricLabel}>Área</Text>
          <Text style={styles.metricValue}>{formatArea(areaM2)}</Text>
        </View>
        {leaderName ? (
          <View style={styles.metricRight}>
            <Text style={styles.metricLabel}>Líder local</Text>
            <Text style={styles.metricValue} numberOfLines={1}>{leaderName}</Text>
          </View>
        ) : null}
      </View>
    </WPCard>
  );
}

export default TerritorySummaryCard;

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
  },
  compact: {
    padding: WayperTheme.spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: WayperTheme.spacing.md,
  },
  eyebrow: {
    ...WayperTheme.typography.caption,
    color: WayperTheme.colors.primary,
  },
  title: {
    ...WayperTheme.typography.subtitle,
    maxWidth: 190,
  },
  badge: {
    borderRadius: WayperTheme.radius.pill,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    paddingHorizontal: WayperTheme.spacing.md,
    paddingVertical: WayperTheme.spacing.xs,
  },
  mineBadge: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primaryLight,
  },
  badgeText: {
    ...WayperTheme.typography.caption,
    color: WayperTheme.colors.textMuted,
  },
  mineBadgeText: {
    color: WayperTheme.colors.textInverse,
  },
  metrics: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: WayperTheme.spacing.lg,
    marginTop: WayperTheme.spacing.lg,
  },
  metricRight: {
    flex: 1,
    alignItems: "flex-end",
  },
  metricLabel: {
    ...WayperTheme.typography.caption,
  },
  metricValue: {
    ...WayperTheme.typography.body,
    fontWeight: "800",
  },
});

