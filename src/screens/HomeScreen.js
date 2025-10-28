import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Image,
  Button,
} from "react-native";
import * as Location from "expo-location";
import MapView, { Polyline, Polygon } from "react-native-maps";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import { db, auth } from "../firebaseConfig";
import { signOut } from "firebase/auth";
import { saveZones, loadZones } from '../storage/zonesStorage';
import NetInfo from "@react-native-community/netinfo";



// ==============================
// Função para calcular distância (em metros)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ==============================
// Função para calcular área de um polígono (em m²)
function calculateArea(polygon) {
  if (polygon.length < 3) return 0;
  const R = 6378137; // raio da Terra em metros
  const rad = Math.PI / 180;
  let area = 0;

  for (let i = 0; i < polygon.length - 1; i++) {
    const p1 = polygon[i];
    const p2 = polygon[i + 1];
    area +=
      (p2.longitude - p1.longitude) *
      rad *
      (2 + Math.sin(p1.latitude * rad) + Math.sin(p2.latitude * rad));
  }

  area = (area * R * R) / 2.0;
  return Math.abs(area);
}

// ==============================
// COMPONENTE PRINCIPAL
export default function HomeScreen({ navigation }) {
  const [location, setLocation] = useState(null);
  const [route, setRoute] = useState([]);
  const [polygons, setPolygons] = useState([]);
  const [watcher, setWatcher] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [distance, setDistance] = useState(0);
  const [time, setTime] = useState(0);
  const [timerInterval, setTimerInterval] = useState(null);
  const [totalArea, setTotalArea] = useState(0);
  const [lastArea, setLastArea] = useState(null);

  // ==============================
  // Buscar zonas salvas no Firestore
  const fetchZonas = async () => {
    try {
      const q = query(
        collection(db, "zonas"),
        where("userId", "==", auth.currentUser.uid)
      );

      const querySnapshot = await getDocs(q);
      const zonasFirebase = [];

      querySnapshot.forEach((doc) => {
        zonasFirebase.push(doc.data());
      });

      setPolygons(zonasFirebase);
      const total = zonasFirebase.reduce((acc, z) => acc + (z.area || 0), 0);
      setTotalArea(total);

      console.log("✅ Zonas do usuário carregadas!");
    } catch (error) {
      console.error("❌ Erro ao buscar zonas:", error);
    }
  };

  // ==============================
  // Permissão e localização inicial
  useEffect(() => {
  const initializeApp = async () => {
    // 1️⃣ Pede permissão de localização
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permissão negada", "Ative o GPS para usar o Wayper.");
      return;
    }
    // 2️⃣ Pega localização inicial
    const loc = await Location.getCurrentPositionAsync({});
    setLocation(loc.coords);

    // 3️⃣ Carrega zonas salvas (modo offline)
    try {
      const savedZones = await AsyncStorage.getItem("zones");
      if (savedZones) {
        const parsed = JSON.parse(savedZones);
        setPolygons(parsed);
        const total = parsed.reduce((acc, z) => acc + z.area, 0);
        setTotalArea(total);
        console.log(`🗺️ ${parsed.length} zonas carregadas do armazenamento local.`);
      } else {
        console.log("Nenhuma zona salva ainda.");
      }
    } catch (err) {
      console.error("Erro ao carregar zonas salvas:", err);
    }
    const unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      console.log("🌐 Conectado à internet — sincronizando zonas...");
      syncZonesWithFirebase();
    } else {
      console.log("📴 Sem conexão, mantendo dados offline.");
    }
  });

  return () => unsubscribe();
  };

  initializeApp();
  }, []);

  useEffect(() => {
    if (auth.currentUser) fetchZonas();
  }, []);

  // ==============================
  // Salvar áreas localmente
  useEffect(() => {
    AsyncStorage.setItem("zones", JSON.stringify(polygons));
  }, [polygons]);

  // ==============================
  // Iniciar corrida
  const startRun = async () => {
    setIsRunning(true);
    setRoute([]);
    setDistance(0);
    setTime(0);
    setLastArea(null);

    const interval = setInterval(() => setTime((prev) => prev + 1), 1000);
    setTimerInterval(interval);

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 1000,
        distanceInterval: 2,
      },
      (newLocation) => {
        const { latitude, longitude } = newLocation.coords;
        setLocation(newLocation.coords);
        setRoute((prevRoute) => {
          if (prevRoute.length > 0) {
            const last = prevRoute[prevRoute.length - 1];
            const addedDistance = getDistance(
              last.latitude,
              last.longitude,
              latitude,
              longitude
            );
            setDistance((prev) => prev + addedDistance);
          }
          return [...prevRoute, { latitude, longitude }];
        });
      }
    );
    setWatcher(subscription);
  };

  const ZONES_KEY = "zones";
  // ==============================
  // Finalizar corrida e salvar zona
  const stopRun = async () => {
  setIsRunning(false);
  if (watcher) watcher.remove();
  if (timerInterval) clearInterval(timerInterval);

  if (route.length > 2) {
    const closedPolygon = [...route, route[0]];
    const area = calculateArea(closedPolygon);
    setLastArea(area);

    // nova zona
    const newZone = {
      coords: closedPolygon,
      area,
      date: new Date().toISOString(),
      synced: false, // 👈 marca como não sincronizada
    };

    // adiciona ao estado
    const updated = [...polygons, newZone];
    setPolygons(updated);

    // atualiza total
    const total = updated.reduce((acc, z) => acc + z.area, 0);
    setTotalArea(total);

    // salva localmente (modo offline)
    try {
      await AsyncStorage.setItem(ZONES_KEY, JSON.stringify(updated));
      console.log("💾 Zona salva localmente!");
    } catch (error) {
      console.error("Erro ao salvar localmente:", error);
    }

    // tenta sincronizar com Firebase (se estiver online)
    const net = await NetInfo.fetch();
    if (net.isConnected) {
      try {
        await addDoc(collection(db, "zonas"), {
          userId: auth?.currentUser?.uid || "offline",
          coords: closedPolygon,
          area,
          totalArea: total,
          date: newZone.date,
        });
        console.log("✅ Zona salva no Firebase!");

        // marca como sincronizada localmente
        const updatedSynced = updated.map((z) =>
          z.date === newZone.date ? { ...z, synced: true } : z
        );
        await AsyncStorage.setItem(ZONES_KEY, JSON.stringify(updatedSynced));
      } catch (error) {
        console.error("❌ Erro ao salvar zona no Firebase:", error);
      }
    } else {
      console.log("📴 Sem internet — zona guardada para sincronizar depois.");
    }
  }
};

  // ==============================
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const formatArea = (area) => 
    area > 10000
      ? `${(area / 1_000_000).toFixed(2)} km²`
      : `${area.toFixed(0)} m²`;

  // ==============================
  if (!location) {
    return (
      <Text style={{ marginTop: 50, textAlign: "center" }}>
        Carregando mapa...
      </Text>
    );
  }

  // ==============================
  const handleLogout = async () => {
    try {
      await signOut(auth);
      Alert.alert("Logout", "Você saiu da sua conta.");
      navigation.replace("Login"); // Redireciona pro login
    } catch (error) {
      console.error("Erro ao sair:", error);
      Alert.alert("Erro", "Não foi possível sair.");
    }
  };

  // ==============================
  return (
    <>
      {/* Cabeçalho */}
      <View style={styles.header}>
        {auth.currentUser && (
          <>
            {auth.currentUser.photoURL && (
              <Image
                source={{ uri: auth.currentUser.photoURL }}
                style={styles.avatar}
              />
            )}
            <Text style={styles.username}>
              {auth.currentUser.displayName
                ? auth.currentUser.displayName.split(" ")[0]
                : "Usuário"}{" "}
              🏃‍♂️
            </Text>
            <Button title="Sair" onPress={handleLogout} />
          </>
        )}
      </View>

      {/* Mapa e painel */}
      <View style={styles.container}>
        <MapView
          style={styles.map}
          region={{
            latitude: location.latitude,
            longitude: location.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          showsUserLocation={true}
        >
          {polygons.map((poly, index) => (
            <Polygon
              key={index}
              coordinates={poly.coords}
              fillColor="rgba(0, 200, 0, 0.3)"
              strokeColor="rgba(0, 150, 0, 0.7)"
              strokeWidth={2}
            />
          ))}

          {route.length > 0 && (
            <Polyline coordinates={route} strokeWidth={5} strokeColor="#00BFFF" />
          )}
        </MapView>

        {/* Painel de informações */}
        <View style={styles.infoPanel}>
          <Text style={styles.infoText}>🕒 Tempo: {formatTime(time)}</Text>
          <Text style={styles.infoText}>
            📏 Distância: {(distance / 1000).toFixed(2)} km
          </Text>
          <Text style={styles.infoText}>
            🟩 Total conquistado: {formatArea(totalArea)}
          </Text>

          {lastArea && (
            <Text style={[styles.infoText, { color: "#90EE90" }]}>
              +{formatArea(lastArea)} conquistados!
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: isRunning ? "#FF6347" : "#4CAF50" },
          ]}
          onPress={isRunning ? stopRun : startRun}
        >
          <Text style={styles.buttonText}>
            {isRunning ? "Finalizar corrida" : "Iniciar corrida"}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

// ==============================
// ESTILOS
const styles = StyleSheet.create({
  header: {
    position: "absolute",
    top: 50,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 20,
    padding: 10,
    zIndex: 10,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },
  username: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    flex: 1,
  },
  container: { flex: 1 },
  map: { flex: 1 },
  infoPanel: {
    position: "absolute",
    top: 40,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  infoText: {
    backgroundColor: "rgba(0,0,0,0.6)",
    color: "#fff",
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginVertical: 4,
  },
  button: {
    position: "absolute",
    bottom: 40,
    left: "25%",
    right: "25%",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
});
