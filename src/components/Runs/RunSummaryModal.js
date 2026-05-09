import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Image,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

const WAYPER_GREEN = "#00e676";

/**
 * RunSummaryModal — versão final corrigida
 */
export default function RunSummaryModal({
  visible,
  onClose,
  onSave,
  baseRunData = {},
}) {
  const [name, setName] = useState("Minha Corrida");
  const [effort, setEffort] = useState(5);
  const [mood, setMood] = useState("🙂");
  const [weather, setWeather] = useState("sunny");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState([]);
  const [photoUri, setPhotoUri] = useState(null);

  useEffect(() => {
    if (!visible) return;

    setName(
      baseRunData.name ||
        `Corrida ${new Date(baseRunData.date || Date.now()).toLocaleString()}`
    );
    setEffort(baseRunData.effort ?? 5);
    setMood(baseRunData.mood || "🙂");
    setWeather(baseRunData.weather || "sunny");
    setNotes(baseRunData.notes || "");
    setTags(Array.isArray(baseRunData.tags) ? baseRunData.tags : []);
    setPhotoUri(baseRunData.photoUri || null);
  }, [visible, baseRunData]);

  if (!visible) return null;
  if (!baseRunData) return null;

  const moodOptions = ["🤩", "🙂", "😐", "😫", "😤"];

  const weatherOptions = [
    { id: "sunny", label: "☀️ Sol" },
    { id: "cloudy", label: "☁️ Nublado" },
    { id: "rain", label: "🌧 Chuva" },
    { id: "night", label: "🌙 Noite" },
  ];

  const tagOptions = [
    "Treino Forte",
    "Ritmo Médio",
    "Recuperação",
    "Longão",
    "Tiro",
    "Leve",
  ];

  async function pickPhoto() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        alert("Permissão negada para acessar fotos.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        quality: 0.7,
        allowsEditing: true,
        aspect: [4, 3],
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        setPhotoUri(res.assets[0].uri);
      }
    } catch (e) {
      console.warn("pickPhoto", e);
    }
  }

  function toggleTag(tag) {
    if (tags.includes(tag)) {
      setTags(tags.filter((t) => t !== tag));
    } else {
      setTags([...tags, tag]);
    }
  }

  async function handleSave() {
    const payload = {
      ...baseRunData,
      name,
      effort,
      mood,
      weather,
      notes,
      tags,
      photoUri,
    };

    try {
      await onSave(payload);
    } catch (e) {
      console.warn("RunSummaryModal.onSave failed", e);
    }

    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Finalizar Corrida</Text>
            <Text style={styles.subtitle}>
              {(baseRunData.distance / 1000)?.toFixed?.(2)} km •{" "}
              {formatDuration(baseRunData.duration)}
            </Text>

            <Text style={styles.label}>Nome</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Ex: Corrida matinal no centro"
            />

            <Text style={styles.label}>Grau de esforço (1-10)</Text>
            <View style={styles.effortRow}>
              {[1,2,3,4,5,6,7,8,9,10].map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[
                    styles.effortDot,
                    effort === n && styles.effortDotActive,
                  ]}
                  onPress={() => setEffort(n)}
                >
                  <Text
                    style={[
                      styles.effortText,
                      effort === n && styles.effortTextActive,
                    ]}
                  >
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Humor</Text>
            <View style={styles.row}>
              {moodOptions.map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => setMood(m)}
                  style={[styles.moodItem, mood === m && styles.moodActive]}
                >
                  <Text style={styles.moodText}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Clima</Text>
            <View style={styles.row}>
              {weatherOptions.map((w) => (
                <TouchableOpacity
                  key={w.id}
                  onPress={() => setWeather(w.id)}
                  style={[
                    styles.weatherItem,
                    weather === w.id && styles.weatherActive,
                  ]}
                >
                  <Text style={styles.weatherText}>{w.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Tags</Text>
            <View style={styles.tagContainer}>
              {tagOptions.map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => toggleTag(t)}
                  style={[
                    styles.tagItem,
                    tags.includes(t) && styles.tagActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.tagText,
                      tags.includes(t) && styles.tagTextActive,
                    ]}
                  >
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Notas</Text>
            <TextInput
              style={styles.notes}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Como foi a corrida? comentários..."
            />

            <Text style={styles.label}>Foto (opcional)</Text>
            {photoUri ? (
              <TouchableOpacity onPress={pickPhoto}>
                <Image source={{ uri: photoUri }} style={styles.photo} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>
                  Selecionar foto
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveText}>Salvar corrida</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function formatDuration(sec = 0) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: "85%",
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: WAYPER_GREEN,
  },
  subtitle: { color: "#666", marginBottom: 10 },
  label: { marginTop: 12, fontWeight: "700", color: "#444" },
  input: {
    backgroundColor: "#f5f5f5",
    padding: 10,
    borderRadius: 10,
    marginTop: 6,
  },
  effortRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  effortDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#ddd",
    justifyContent: "center",
    alignItems: "center",
    margin: 4,
  },
  effortDotActive: {
    backgroundColor: WAYPER_GREEN,
    borderColor: WAYPER_GREEN,
  },
  effortText: { fontWeight: "700" },
  effortTextActive: { color: "#fff" },
  row: { flexDirection: "row", marginTop: 8, flexWrap: "wrap" },
  moodItem: {
    padding: 8,
    marginRight: 10,
    borderRadius: 10,
    backgroundColor: "#f1f1f1",
  },
  moodActive: { backgroundColor: WAYPER_GREEN },
  moodText: { fontSize: 20 },
  weatherItem: {
    backgroundColor: "#f1f1f1",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginRight: 8,
  },
  weatherActive: { backgroundColor: WAYPER_GREEN },
  weatherText: { fontWeight: "700" },
  tagContainer: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  tagItem: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#eee",
    borderRadius: 20,
    marginRight: 8,
    marginTop: 6,
  },
  tagActive: { backgroundColor: WAYPER_GREEN },
  tagText: { color: "#333" },
  tagTextActive: { color: "#fff", fontWeight: "700" },
  notes: {
    backgroundColor: "#f5f5f5",
    padding: 10,
    borderRadius: 10,
    height: 90,
    marginTop: 6,
    textAlignVertical: "top",
  },
  photoBtn: {
    backgroundColor: WAYPER_GREEN,
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 6,
  },
  photo: {
    width: "100%",
    height: 160,
    borderRadius: 12,
    marginTop: 8,
  },
  saveBtn: {
    backgroundColor: WAYPER_GREEN,
    padding: 14,
    borderRadius: 12,
    marginTop: 18,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontWeight: "800" },
  cancelBtn: { padding: 12, alignItems: "center", marginTop: 8 },
  cancelText: { color: "#888" },
});
