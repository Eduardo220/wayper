/**
 * ZoneDetailScreen.js — ULTIMATE PRO (refatorado) */

import React, { useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from "react-native";
import MapView, { Polygon } from "react-native-maps";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

let captureRef = null;
try {
  // optional dependency - guard if not installed
  // eslint-disable-next-line global-require
  captureRef = require("react-native-view-shot").captureRef;
} catch {
  captureRef = null;
}

/* try to use expo-clipboard if available, else fallback to navigator.clipboard or react-native Clipboard */
let ExpoClipboard = null;
try {
  // eslint-disable-next-line global-require
  ExpoClipboard = require("expo-clipboard");
} catch {
  ExpoClipboard = null;
}

const WAYPER_GREEN = "#00e676";

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
      await FileSystem.writeAsStringAsync(path, JSON.stringify(geojson), { encoding: FileSystem.EncodingUTF8 });

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

      // prefer expo-clipboard when available
      if (ExpoClipboard && typeof ExpoClipboard.setStringAsync === "function") {
        await ExpoClipboard.setStringAsync(coordsText);
        Alert.alert("Copiado", "Coordenadas copiadas para a área de transferência.");
        return;
      }

      // browser
      if (Platform.OS === "web" && typeof navigator?.clipboard?.writeText === "function") {
        await navigator.clipboard.writeText(coordsText);
        Alert.alert("Copiado", "Coordenadas copiadas para a área de transferência.");
        return;
      }

      // fallback: try to use Sharing as last resort (save file then share)
      const path = `${FileSystem.cacheDirectory}wayper_zone_coords_${sanitizeFilename(zone.id || String(Date.now()))}.txt`;
      await FileSystem.writeAsStringAsync(path, coordsText, { encoding: FileSystem.EncodingUTF8 });

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
      const uri = await captureRef(viewRef, { format: "png", quality: 0.9, result: "tmpfile" });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { dialogTitle: "Compartilhar imagem da zona" });
      } else {
        Alert.alert("Imagem pronta", uri);
      }
    } catch (e) {
      debug("shareZoneImage failed", e);
      Alert.alert("Erro", "Falha ao capturar imagem. Instale react-native-view-shot para habilitar.");
    }
  }, [viewRef]);

  /* -------------------- UI -------------------- */
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View ref={viewRef} collapsable={false} style={styles.preview}>
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: Number(center.latitude ?? 0),
            longitude: Number(center.longitude ?? 0),
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          scrollEnabled={false}
          pitchEnabled={false}
        >
          {coords && coords.length > 2 && (
            <Polygon
              coordinates={coords}
              strokeColor={WAYPER_GREEN}
              fillColor={"rgba(0,230,118,0.18)"}
              strokeWidth={3}
            />
          )}
        </MapView>
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>Zona</Text>
        <Text style={styles.date}>{zone.date ? new Date(zone.date).toLocaleString() : "—"}</Text>

        <View style={styles.infoRow}>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Área</Text>
            <Text style={styles.infoVal}>{formatArea(zone.area)}</Text>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Pontos</Text>
            <Text style={styles.infoVal}>{coords.length}</Text>
          </View>
        </View>

        <View style={{ marginTop: 12 }}>
          <Text style={styles.sectionTitle}>Ações</Text>

          <TouchableOpacity style={[styles.btn, { backgroundColor: WAYPER_GREEN }]} onPress={exportGeoJSON}>
            <Text style={styles.btnText}>Exportar GeoJSON</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, { backgroundColor: "#333", marginTop: 8 }]} onPress={copyCoordsToClipboard}>
            <Text style={styles.btnText}>Copiar coordenadas</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, { backgroundColor: "#111", marginTop: 8 }]} onPress={shareZoneImage}>
            <Text style={styles.btnText}>Compartilhar imagem</Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: 16 }}>
          <Text style={styles.sectionTitle}>Resumo</Text>
          <Text style={styles.meta}>ID: {zone.id ?? "—"}</Text>
          <Text style={styles.meta}>Criada: {zone.date ? new Date(zone.date).toLocaleString() : "—"}</Text>
        </View>

        <View style={{ height: 40 }} />
      </View>
    </ScrollView>
  );
}

export default React.memo(ZoneDetailScreen);

/* ------------------------- styles ------------------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { justifyContent: "center", alignItems: "center" },
  preview: { backgroundColor: "#000" },
  map: { width: "100%", height: 260 },
  body: { padding: 12 },
  title: { color: WAYPER_GREEN, fontSize: 22, fontWeight: "800" },
  date: { color: "#888", marginTop: 6 },
  infoRow: { flexDirection: "row", marginTop: 12 },
  infoBox: { flex: 1, backgroundColor: "#111", padding: 12, borderRadius: 10, marginRight: 8, alignItems: "center" },
  infoLabel: { color: "#999", fontSize: 12 },
  infoVal: { color: "#fff", fontWeight: "800", marginTop: 6 },
  sectionTitle: { color: WAYPER_GREEN, fontWeight: "800", marginBottom: 8 },
  btn: { padding: 12, borderRadius: 12, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "800" },
  meta: { color: "#ccc", marginTop: 6 },
});
