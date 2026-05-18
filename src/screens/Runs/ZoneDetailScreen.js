/**
 * ZoneDetailScreen.js — ULTIMATE PRO (refatorado) */

import React, { useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import WayperMapLibre from "../../components/Map/WayperMapLibre";
import { WPButton, WPCard, WPMetricCard } from "../../components/ui";
import { WayperTheme } from "../../theme/wayperTheme";
import { saveTempImageAsync } from "../../utils/fileSystemLegacy";
import { copyTextToClipboard } from "../../utils/runShareImage";
import { sharePngFile } from "../../utils/shareImage";

let captureRef = null;
try {
  // optional dependency - guard if not installed
  // eslint-disable-next-line global-require
  captureRef = require("react-native-view-shot").captureRef;
} catch {
  captureRef = null;
}

const WAYPER_GREEN = WayperTheme.colors.primary;

/* ------------------------- helpers ------------------------- */
const debug = (...args) => {
  const ENABLE = false;
  if (ENABLE) console.log("[ZoneDetail]", ...args);
};

const isValidCoord = (p) =>
  p &&
  (Number.isFinite(Number(p.latitude)) || Number.isFinite(Number(p.lat))) &&
  (Number.isFinite(Number(p.longitude)) || Number.isFinite(Number(p.lon) || Number(p.lng)));

const normalizeCoord = (p) => ({
  latitude: Number(p.latitude ?? p.lat ?? p[1] ?? 0),
  longitude: Number(p.longitude ?? p.lon ?? p.lng ?? p[0] ?? 0),
});

/* sanitize filename to avoid injections */
const sanitizeFilename = (s) =>
  String(s || "")
    .replace(/[^\w\d-_\. ]+/g, "")
    .slice(0, 120);

/* pretty format area (m² -> human) */
function formatArea(area) {
  if (!Number.isFinite(area) || area <= 0) return "—";
  if (area >= 1e6) return `${(area / 1e6).toFixed(2)} km²`;
  return `${Math.round(area)} m²`;
}

/* ------------------------- component ------------------------- */
function ZoneDetailScreen({ route }) {
  const zone = route?.params?.zone ?? null;
  const viewRef = useRef(null);

  // guard: early return UI for invalid zone
  if (!zone) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ color: "#fff" }}>Zona inválida</Text>
      </View>
    );
  }

  /* normalize coords safely */
  const coords = useMemo(() => {
    try {
      if (!Array.isArray(zone.coords)) return [];
      return zone.coords
        .filter(isValidCoord)
        .map(normalizeCoord);
    } catch (e) {
      debug("coords normalization failed", e);
      return [];
    }
  }, [zone]);

  const center = useMemo(() => {
    if (!coords || coords.length === 0) return { latitude: 0, longitude: 0 };
    const mid = Math.floor(coords.length / 2);
    return coords[mid] || coords[0];
  }, [coords]);

  /* geojson memoized */
  const geojson = useMemo(() => {
    try {
      const polygon = (coords || []).map((p) => [Number(p.longitude), Number(p.latitude)]);
      return {
        type: "Feature",
        properties: { id: zone.id ?? null, date: zone.date ?? null, area: zone.area ?? null },
        geometry: {
          type: "Polygon",
          coordinates: [polygon],
        },
      };
    } catch (e) {
      debug("geojson build failed", e);
      return null;
    }
  }, [coords, zone]);

  /* -------------------- Export GeoJSON -------------------- */
  const exportGeoJSON = useCallback(async () => {
    try {
      if (!geojson) {
        Alert.alert("Erro", "GeoJSON inválido");
        return;
      }
      const name = sanitizeFilename(zone.id || `zona_${Date.now()}`);
      const filename = `wayper_zone_${name}.geojson`;
      const path = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(geojson), { encoding: FileSystem.EncodingType.UTF8 });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: "application/geo+json", dialogTitle: "Exportar Zona (GeoJSON)" });
      } else {
        Alert.alert("Exportado", `Arquivo salvo: ${path}`);
      }
    } catch (e) {
      debug("exportGeoJSON failed", e);
      Alert.alert("Erro", "Não foi possível exportar GeoJSON.");
    }
  }, [geojson, zone]);

  /* -------------------- Copy coordinates -------------------- */
  const copyCoordsToClipboard = useCallback(async () => {
    try {
      if (!coords || coords.length === 0) {
        Alert.alert("Nenhuma coordenada disponível");
        return;
      }
      const coordsText = coords.map((p) => `${p.latitude},${p.longitude}`).join("\n");

      try {
        await copyTextToClipboard(coordsText);
        Alert.alert("Copiado", "Coordenadas copiadas para a área de transferência.");
        return;
      } catch (copyError) {
        debug("clipboard unavailable, using share fallback", copyError);
      }

      // fallback: try to use Sharing as last resort (save file then share)
      const path = `${FileSystem.cacheDirectory}wayper_zone_coords_${sanitizeFilename(zone.id || String(Date.now()))}.txt`;
      await FileSystem.writeAsStringAsync(path, coordsText, { encoding: FileSystem.EncodingType.UTF8 });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { dialogTitle: "Coordenadas da zona" });
      } else {
        Alert.alert("Coordenadas salvas", `Arquivo salvo em: ${path}`);
      }
    } catch (e) {
      debug("copyCoordsToClipboard failed", e);
      Alert.alert("Erro", "Não foi possível copiar coordenadas.");
    }
  }, [coords, zone]);

  /* -------------------- Share zone image (view-shot) -------------------- */
  const shareZoneImage = useCallback(async () => {
    try {
      if (!viewRef.current) {
        Alert.alert("Erro", "Preview não disponível");
        return;
      }
      if (!captureRef) {
        Alert.alert("Funcionalidade indisponível", "Instale react-native-view-shot para habilitar captura de imagem.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
      const uri = await captureRef(viewRef.current, { format: "png", quality: 1, result: "tmpfile" });
      const fileUri = await saveTempImageAsync(uri, `wayper-zone-${zone.id || Date.now()}.png`);
      const result = await sharePngFile(fileUri, {
        dialogTitle: "Compartilhar imagem da zona",
        visual: "zone",
        method: "captureRef/tmpfile",
      });

      if (!result.ok) {
        Alert.alert("Erro", result.message || "Nao foi possivel compartilhar a imagem. Tente novamente.");
      }
    } catch (e) {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.error("[Wayper Share] zone image failed:", e);
      }
      Alert.alert("Erro", "Nao foi possivel compartilhar a imagem. Tente novamente.");
    }
  }, [zone]);

  /* -------------------- UI -------------------- */
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View ref={viewRef} collapsable={false} style={styles.preview}>
        <WayperMapLibre
          style={styles.map}
          zones={[{ coords }]}
          centerCoordinate={center}
          showUserLocation={false}
          interactive={false}
          fitToContent={true}
        />
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>Zona</Text>
        <Text style={styles.date}>{zone.date ? new Date(zone.date).toLocaleString() : "—"}</Text>

        <View style={styles.infoRow}>
          <WPMetricCard label="Área" value={formatArea(zone.area)} accent="cyan" />
          <WPMetricCard label="Pontos" value={coords.length} accent="cyan" />
        </View>

        <View style={{ marginTop: 12 }}>
          <Text style={styles.sectionTitle}>Ações</Text>

          <WPButton title="Exportar GeoJSON" onPress={exportGeoJSON} />
          <WPButton title="Copiar coordenadas" variant="secondary" onPress={copyCoordsToClipboard} style={styles.actionGap} />
          <WPButton title="Compartilhar imagem" variant="secondary" onPress={shareZoneImage} style={styles.actionGap} />
        </View>

        <WPCard accent="cyan" style={{ marginTop: 16 }}>
          <Text style={styles.sectionTitle}>Resumo</Text>
          <Text style={styles.meta}>ID: {zone.id ?? "—"}</Text>
          <Text style={styles.meta}>Criada: {zone.date ? new Date(zone.date).toLocaleString() : "—"}</Text>
        </WPCard>

        <View style={{ height: 40 }} />
      </View>
    </ScrollView>
  );
}

export default React.memo(ZoneDetailScreen);

/* ------------------------- styles ------------------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WayperTheme.colors.background },
  scrollContent: { paddingBottom: 40 },
  center: { justifyContent: "center", alignItems: "center" },
  preview: { backgroundColor: WayperTheme.colors.background },
  map: { width: "100%", height: 280 },
  body: { padding: WayperTheme.spacing.page },
  title: { color: WAYPER_GREEN, fontSize: 28, fontWeight: "900" },
  date: { color: WayperTheme.colors.textMuted, marginTop: 6 },
  infoRow: { flexDirection: "row", marginTop: 16, gap: WayperTheme.spacing.md },
  sectionTitle: { color: WAYPER_GREEN, fontWeight: "900", marginBottom: 10, fontSize: 18 },
  meta: { color: WayperTheme.colors.textMuted, marginTop: 6 },
  actionGap: { marginTop: WayperTheme.spacing.sm },
});
