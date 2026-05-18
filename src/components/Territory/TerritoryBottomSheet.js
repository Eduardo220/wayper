import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { WPBottomSheet } from "../ui/WPBottomSheet";
import { WPButton } from "../ui/WPButton";
import { WayperTheme } from "../../theme/wayperTheme";
import TerritorySummaryCard from "./TerritorySummaryCard";
import LeaderAreaCard from "./LeaderAreaCard";

function formatArea(areaM2) {
  const area = Number(areaM2 || 0);
  if (!Number.isFinite(area) || area <= 0) return "0 m²";
  if (area >= 1000000) return `${(area / 1000000).toFixed(2)} km²`;
  return `${Math.round(area).toLocaleString("pt-BR")} m²`;
}

function getUserStanding(leaderboard, currentUserId) {
  if (!leaderboard || !currentUserId) return null;
  const users = Object.values(leaderboard.users || {});
  const sorted = users.sort((a, b) => Number(b.areaM2 || 0) - Number(a.areaM2 || 0));
  const index = sorted.findIndex((user) => String(user.userId) === String(currentUserId));
  if (index < 0) return null;
  return { ...sorted[index], rank: index + 1 };
}

function getAreaNeeded(leaderboard, currentUserId) {
  if (!leaderboard || !currentUserId) return 0;
  if (!leaderboard.leaderUserId || String(leaderboard.leaderUserId) === String(currentUserId)) return 0;
  const standing = getUserStanding(leaderboard, currentUserId);
  const mine = Number(standing?.areaM2 || 0);
  return Math.max(0, Number(leaderboard.leaderAreaM2 || 0) - mine + 1);
}

export function TerritoryBottomSheet({
  territory,
  leaderboard,
  currentUserId,
  onClose,
  onRunHere,
  onOpenRanking,
}) {
  const visible = Boolean(territory);
  const ownerId = territory?.ownerId || territory?.userId;
  const isMine = Boolean(ownerId && currentUserId && String(ownerId) === String(currentUserId));
  const userStanding = useMemo(
    () => getUserStanding(leaderboard, currentUserId),
    [leaderboard, currentUserId]
  );
  const areaNeeded = useMemo(
    () => getAreaNeeded(leaderboard, currentUserId),
    [leaderboard, currentUserId]
  );

  return (
    <WPBottomSheet visible={visible} onClose={onClose} maxHeight="86%">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <TerritorySummaryCard territory={territory} currentUserId={currentUserId} />

        <View style={styles.section}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>
            {isMine ? "Você domina esta área." : "Área de outro atleta."}
          </Text>
        </View>

        {leaderboard ? (
          <LeaderAreaCard leaderboard={leaderboard} userStanding={userStanding} />
        ) : null}

        {!isMine && areaNeeded > 0 ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Faltam {formatArea(areaNeeded)} para assumir a liderança local.
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <WPButton title="Correr nessa área" onPress={onRunHere} compact />
          <WPButton title="Ver ranking local" onPress={onOpenRanking} variant="secondary" compact />
        </View>
      </ScrollView>
    </WPBottomSheet>
  );
}

export default TerritoryBottomSheet;

const styles = StyleSheet.create({
  content: {
    gap: WayperTheme.spacing.lg,
    paddingBottom: WayperTheme.spacing.lg,
  },
  section: {
    gap: WayperTheme.spacing.xs,
  },
  label: {
    ...WayperTheme.typography.caption,
    color: WayperTheme.colors.primary,
  },
  value: {
    ...WayperTheme.typography.body,
  },
  notice: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: WayperTheme.colors.cyanBorder,
    backgroundColor: WayperTheme.colors.cyanSoft,
    padding: WayperTheme.spacing.md,
  },
  noticeText: {
    ...WayperTheme.typography.body,
    color: WayperTheme.colors.text,
  },
  actions: {
    gap: WayperTheme.spacing.md,
  },
});

