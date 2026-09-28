import React from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import WayperMapLibre from "../../components/Map/WayperMapLibre";
import RunRecoveryModal from "../../components/Runs/RunRecoveryModal";
import { WayperTheme } from "../../theme/wayperTheme";
import { MAP_CAMERA_CONFIG } from "./mapCameraProjection.js";
import styles from "./MapScreen.styles.js";

export default function MapCanvasLayer({ model }) {
  const { camera, map, recovery, territory, onRecenter } = model;
  return (
    <>
      <View style={{ flex: 1 }}>
        <WayperMapLibre
          style={styles.map}
          location={camera.location}
          centerCoordinate={camera.centerCoordinate}
          autoCenterOnCoordinate={camera.autoCenterOnCoordinate}
          routePath={map.routePath}
          routeSegments={map.routeSegments}
          replayPath={map.replayPath}
          replaySegments={map.replaySegments}
          zones={map.zones}
          territories={territory.items}
          leaderCells={territory.leaderCells}
          selectedTerritory={territory.selected}
          currentUserId={map.currentUserId}
          showZones={map.zones.length > 0}
          showTerritories
          showLeaderAreas
          showUserLocation={!map.replaying}
          followUserLocation={camera.followUserLocation}
          initialZoom={camera.initialZoom}
          followZoomLevel={camera.followZoomLevel}
          followAnimationDuration={camera.followAnimationDuration}
          recenterAnimationDuration={MAP_CAMERA_CONFIG.recenterAnimationMs}
          minCameraMoveIntervalMs={camera.minCameraMoveIntervalMs}
          recenterSignal={map.recenterSignal}
          onUserInteraction={map.onUserInteraction}
          onTerritoryPress={territory.onPress}
          onLeaderCellPress={territory.onLeaderCellPress}
          onViewportChange={territory.onViewportChange}
          fitToContent={false}
        />
      </View>

      <LinearGradient
        pointerEvents="none"
        colors={["rgba(3,7,11,0)", "rgba(3,7,11,0.38)", "rgba(3,7,11,0.82)"]}
        locations={[0, 0.48, 1]}
        style={styles.mapBottomFade}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(3,7,11,0.42)", "rgba(3,7,11,0)"]}
        style={styles.mapTopVignette}
      />

      {recovery.noticeVisible && map.running ? (
        <View pointerEvents="none" style={styles.recoveryBanner}>
          <Ionicons name="checkmark-circle" size={17} color={WayperTheme.colors.primary} />
          <Text style={styles.recoveryBannerText}>Corrida recuperada. Continuamos salvando seu trajeto.</Text>
        </View>
      ) : null}

      <RunRecoveryModal
        visible={recovery.modalVisible}
        recovery={recovery.pending}
        loading={recovery.loading}
        onContinue={recovery.onContinue}
        onFinish={recovery.onFinish}
        onDiscard={recovery.onDiscard}
      />

      {territory.loading && !map.running && !map.replaying ? (
        <View pointerEvents="none" style={styles.territoryLoadingBadge}>
          <ActivityIndicator size="small" color={WayperTheme.colors.primary} />
        </View>
      ) : null}

      {camera.showRecenter ? (
        <TouchableOpacity activeOpacity={0.9} style={styles.recenterMapButton} onPress={onRecenter}>
          <View pointerEvents="none" style={styles.recenterMapGlow} />
          <Ionicons name="locate" size={24} color={WayperTheme.colors.primary} />
        </TouchableOpacity>
      ) : null}
    </>
  );
}
