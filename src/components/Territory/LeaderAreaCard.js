import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { WPCard } from "../ui/WPCard";
import { WayperTheme } from "../../theme/wayperTheme";

function formatArea(areaM2) {
  const area = Number(areaM2 || 0);
  if (!Number.isFinite(area) || area <= 0) return "0 m²";
  return `${Math.round(area).toLocaleString("pt-BR")} m²`;
}

export function LeaderAreaCard({ leaderboard, userStanding, style }) {
  if (!leaderboard) return null;

  const leaderName = leaderboard.leaderUserName || leaderboard.leaderName || "Sem líder";
  const leaderAreaM2 = leaderboard.leaderAreaM2 || 0;
  const totalAreaM2 = leaderboard.totalAreaM2 || 0;

  return (
    <WPCard accent="cyan" style={[styles.card, style]}>
      <Text style={styles.eyebrow}>Região</Text>
      <View style={styles.row}>
        <View style={styles.main}>
          <Text style={styles.title} numberOfLines={1}>{leaderName}</Text>
          <Text style={styles.caption}>lidera com {formatArea(leaderAreaM2)}</Text>
        </View>
        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatArea(totalAreaM2)}</Text>
        </View>
      </View>
      {userStanding ? (
        <Text style={styles.standing}>
          Sua posição: #{userStanding.rank} · {formatArea(userStanding.areaM2)}
        </Text>
      ) : null}
    </WPCard>
  );
}

export default LeaderAreaCard;

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
  },
  eyebrow: {
    ...WayperTheme.typography.caption,
    color: WayperTheme.colors.cyan,
    marginBottom: WayperTheme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: WayperTheme.spacing.md,
  },
  main: {
    flex: 1,
  },
  title: {
    ...WayperTheme.typography.subtitle,
  },
  caption: {
    ...WayperTheme.typography.caption,
    marginTop: WayperTheme.spacing.xs,
  },
  totalBox: {
    alignItems: "flex-end",
  },
  totalLabel: {
    ...WayperTheme.typography.caption,
  },
  totalValue: {
    ...WayperTheme.typography.body,
    fontWeight: "800",
  },
  standing: {
    ...WayperTheme.typography.caption,
    color: WayperTheme.colors.textMuted,
    marginTop: WayperTheme.spacing.md,
  },
});

