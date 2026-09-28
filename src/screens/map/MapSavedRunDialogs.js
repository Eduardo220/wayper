import React from "react";
import { Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import RunShareModal from "../../components/Runs/RunShareModal";
import { TerritoryBottomSheet } from "../../components/Territory/TerritoryBottomSheet";
import { WayperTheme } from "../../theme/wayperTheme";
import styles from "./MapScreen.styles.js";

export default function MapSavedRunDialogs({ model }) {
  const {
    visible, closeSaved, savedRunTitle, savedRunName, savedRunDistance, savedRunDuration,
    savedRunIsZone, savedZoneArea, savedRunDate, goToDetail, replaySavedRun, openShare,
    shareTitle, shareVisible, closeShare, lastSavedRun, sharePath, runSegments, zoneCoords,
    fullCardTitle, shareSubtitle, savedRunPace, selectedTerritory, selectedLeaderboard,
    currentUserId, closeTerritory, runFromTerritory, openTerritoryRanking, summaryVisible,
  } = model;
  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={closeSaved}>
        <View style={styles.savedOverlay}>
          <View style={styles.savedModalContent}>
            <View style={styles.savedHandle} />
            <ScrollView style={styles.savedModalScroller}
              contentContainerStyle={styles.savedModalScrollContent}
              showsVerticalScrollIndicator={false} nestedScrollEnabled>
              <View style={styles.savedHeroRow}>
                <View style={styles.savedBadgeOuter}>
                  <View style={styles.savedBadgeInner}>
                    <Ionicons name="checkmark" size={32} color={WayperTheme.colors.textInverse} />
                  </View>
                </View>
                <View style={styles.savedHeroText}>
                  <Text style={styles.savedEyebrow}>Wayper finalizado</Text>
                  <Text style={styles.savedTitle}>{savedRunTitle}</Text>
                  <Text style={styles.savedSubtitle} numberOfLines={1}>{savedRunName}</Text>
                </View>
              </View>
              <View style={styles.savedMetricRow}>
                <View style={styles.savedMetric}>
                  <Ionicons name="navigate-outline" size={19} color={WayperTheme.colors.primary} />
                  <Text style={styles.savedMetricValue}>{savedRunDistance}</Text>
                  <Text style={styles.savedMetricLabel}>Distância</Text>
                </View>
                <View style={styles.savedMetric}>
                  <Ionicons name="timer-outline" size={19} color={WayperTheme.colors.primary} />
                  <Text style={styles.savedMetricValue}>{savedRunDuration}</Text>
                  <Text style={styles.savedMetricLabel}>Tempo</Text>
                </View>
                <View style={styles.savedMetric}>
                  <Ionicons name={savedRunIsZone ? "map-outline" : "calendar-outline"}
                    size={19} color={WayperTheme.colors.primary} />
                  <Text style={styles.savedMetricValue} numberOfLines={1}>
                    {savedRunIsZone ? savedZoneArea : savedRunDate}
                  </Text>
                  <Text style={styles.savedMetricLabel}>{savedRunIsZone ? "Area" : "Data"}</Text>
                </View>
              </View>
              <TouchableOpacity activeOpacity={0.9} style={styles.savedPrimaryAction} onPress={goToDetail}>
                <Ionicons name="reader-outline" size={21} color={WayperTheme.colors.textInverse} />
                <Text style={styles.savedPrimaryText}>Ver corrida</Text>
                <Ionicons name="chevron-forward" size={22} color={WayperTheme.colors.textInverse} />
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.88} style={styles.savedSecondaryAction} onPress={replaySavedRun}>
                <Ionicons name="play-circle-outline" size={22} color={WayperTheme.colors.primary} />
                <Text style={styles.savedSecondaryText}>Reproduzir corrida</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.88} style={styles.savedSecondaryAction} onPress={openShare}>
                <Ionicons name="share-social-outline" size={22} color={WayperTheme.colors.primary} />
                <Text style={styles.savedSecondaryText}>{shareTitle}</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.82} style={styles.savedCloseAction} onPress={closeSaved}>
                <Text style={styles.savedCloseText}>Fechar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <RunShareModal
        visible={shareVisible}
        onClose={closeShare}
        run={lastSavedRun}
        path={sharePath}
        segments={savedRunIsZone ? [] : runSegments}
        zoneCoords={zoneCoords}
        isZone={savedRunIsZone}
        title={fullCardTitle}
        subtitle={shareSubtitle}
        distance={savedRunDistance}
        duration={savedRunDuration}
        pace={savedRunPace}
        date={savedRunDate}
        area={savedZoneArea}
        publicLink={lastSavedRun?.publicLink || lastSavedRun?.publicUrl ||
          lastSavedRun?.shareUrl || lastSavedRun?.url}
      />

      <TerritoryBottomSheet
        territory={summaryVisible ? null : selectedTerritory}
        leaderboard={selectedLeaderboard}
        currentUserId={currentUserId}
        onClose={closeTerritory}
        onRunHere={runFromTerritory}
        onOpenRanking={openTerritoryRanking}
      />
    </>
  );
}
