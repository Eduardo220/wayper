import React from "react";
import { ActivityIndicator, FlatList, Modal, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../../theme/wayperTheme";
import styles from "./MapScreen.styles.js";

const TABS = [
  ["mine", "Minhas zonas", "person-outline"],
  ["all", "Zonas completas", "map-outline"],
  ["ranking", "Ranking", "podium-outline"],
];

export default function MapTerritoryPanels({ model }) {
  const {
    showRunsModal, closeRunsModal, runsList, openRunDetails, zonesPanelVisible,
    closeZonesPanel, zonesPanelTab, selectZonesPanelTab, zonesPanelLoading,
    zonesRanking, selectedRankingUser, formatArea, loadRankingUserZones,
    myTerritories, otherTerritories, focusTerritoryOnMap, formatDate,
  } = model;
  return (
    <>
      <Modal visible={showRunsModal} animationType="slide" transparent onRequestClose={closeRunsModal}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Suas Corridas</Text>
            <FlatList
              data={runsList}
              keyExtractor={(item, index) => String(
                item.localRunId || item.remoteRunId || item.id || `legacy-run-${index}`
              )}
              style={{ flex: 1 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.runItem} onPress={() => openRunDetails(item)}>
                  <Text style={styles.runDate}>{item.date}</Text>
                  <Text style={styles.runStats}>
                    {(item.distance / 1000).toFixed(2)} km • {Math.round(item.duration)} s
                  </Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.closeBtn} onPress={closeRunsModal}>
              <Text style={styles.closeBtnText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={zonesPanelVisible} animationType="slide" transparent onRequestClose={closeZonesPanel}>
        <View style={styles.zonesPanelOverlay}>
          <View style={styles.zonesPanel}>
            <View style={styles.zonesPanelHandle} />
            <View style={styles.zonesPanelHeader}>
              <View>
                <Text style={styles.zonesPanelEyebrow}>Territorios</Text>
                <Text style={styles.zonesPanelTitle}>Ver zonas</Text>
              </View>
              <TouchableOpacity activeOpacity={0.82} style={styles.zonesPanelClose} onPress={closeZonesPanel}>
                <Ionicons name="close" size={22} color={WayperTheme.colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.zonesTabs}>
              {TABS.map(([key, label, icon]) => {
                const active = zonesPanelTab === key;
                return (
                  <TouchableOpacity key={key} activeOpacity={0.86}
                    style={[styles.zonesTab, active && styles.zonesTabActive]}
                    onPress={() => selectZonesPanelTab(key)}>
                    <Ionicons name={icon} size={16}
                      color={active ? WayperTheme.colors.textInverse : WayperTheme.colors.textMuted} />
                    <Text style={[styles.zonesTabText, active && styles.zonesTabTextActive]} numberOfLines={1}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {zonesPanelLoading ? (
              <View style={styles.zonesLoading}>
                <ActivityIndicator color={WayperTheme.colors.primary} />
              </View>
            ) : zonesPanelTab === "ranking" ? (
              <FlatList
                data={zonesRanking}
                keyExtractor={(item) => String(item.id || item.userId)}
                style={styles.zonesList}
                ListHeaderComponent={selectedRankingUser ? (
                  <Text style={styles.zonesSummary}>
                    Selecionado: {selectedRankingUser.name || "Atleta"} - {formatArea(
                      selectedRankingUser.area || selectedRankingUser.totalArea
                    )}
                  </Text>
                ) : null}
                ListEmptyComponent={<Text style={styles.zonesEmpty}>Ranking vazio por enquanto.</Text>}
                renderItem={({ item, index }) => (
                  <TouchableOpacity activeOpacity={0.86} style={styles.zoneRow}
                    onPress={() => loadRankingUserZones(item)}>
                    <View style={styles.zoneRankBadge}><Text style={styles.zoneRankText}>{index + 1}</Text></View>
                    <View style={styles.zoneRowBody}>
                      <Text style={styles.zoneRowTitle} numberOfLines={1}>{item.name || "Atleta Wayper"}</Text>
                      <Text style={styles.zoneRowMeta}>
                        {formatArea(item.area || item.totalArea)} - {item.zones || item.totalZones || 0} zonas
                      </Text>
                    </View>
                    <Ionicons name="locate-outline" size={20} color={WayperTheme.colors.primary} />
                  </TouchableOpacity>
                )}
              />
            ) : (
              <FlatList
                data={zonesPanelTab === "mine" ? myTerritories : otherTerritories}
                keyExtractor={(item) => String(item.id)}
                style={styles.zonesList}
                ListEmptyComponent={<Text style={styles.zonesEmpty}>
                  {zonesPanelTab === "mine"
                    ? "Voce ainda nao tem zonas capturadas."
                    : "Nenhuma zona completa carregada nesta area."}
                </Text>}
                renderItem={({ item }) => (
                  <TouchableOpacity activeOpacity={0.86} style={styles.zoneRow}
                    onPress={() => focusTerritoryOnMap(item)}>
                    <View style={[styles.zoneColorDot, { backgroundColor: item.color || WayperTheme.colors.primary }]} />
                    <View style={styles.zoneRowBody}>
                      <Text style={styles.zoneRowTitle} numberOfLines={1}>
                        {item.ownerName || item.name || "Zona capturada"}
                      </Text>
                      <Text style={styles.zoneRowMeta}>
                        {formatArea(item.areaM2 || item.area)} - {formatDate(item.capturedAt || item.createdAt)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={WayperTheme.colors.textMuted} />
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}
