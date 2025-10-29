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
import NetInfo from "@react-native-community/netinfo";

import { 
  collection, addDoc, getDocs, setDoc, doc, getDoc, query, where 
} from "firebase/firestore";
import { db, auth } from "../firebaseConfig";
import { signOut } from "firebase/auth";

// ==============================
// Funções utilitárias
const getDistance = (lat1, lon1, lat2, lon2) => {
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
};

const calculateArea = (polygon) => {
  if (polygon.length < 3) return 0;
  const R = 6378137;
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
};

// ==============================
// Componente principal
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

  const ZONES_KEY = "zones";

  // ==============================
  // Inicialização: permissão, localização e zones
  useEffect(() => {
    const initializeApp = async () => {
      // Permissão de localização
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permissão negada", "Ative o GPS para usar o Wayper.");
        return;
      }

      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);

      // Carregar zonas offline
      try {
        const savedZones = await AsyncStorage.getItem(ZONES_KEY);
        if (savedZones) {
          const parsed = JSON.parse(savedZones);
          setPolygons(parsed);
          setTotalArea(parsed.reduce((acc, z) => acc + (z.area || 0), 0));
          console.log(`🗺️ ${parsed.length} zonas carregadas do armazenamento local.`);
        }
      } catch (err) {
        console.error("Erro ao carregar zonas salvas:", err);
      }

      // Monitorar internet e sincronizar
      const unsubscribe = NetInfo.addEventListener((state) => {
        if (state.isConnected) {
          console.log("🌐 Conectado — sincronizando zonas...");
          syncAllZonesWithFirebase();
        } else {
          console.log("📴 Sem conexão, mantendo dados offline.");
        }
      });

      return () => unsubscribe();
    };

    initializeApp();
  }, []);

  // ==============================
  // Funções de formatação
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const formatArea = (area) =>
    area > 10000 ? `${(area / 1_000_000).toFixed(2)} km²` : `${area.toFixed(0)} m²`;

  // ==============================
  // Corrida: iniciar
  const startRun = async () => {
    setIsRunning(true);
    setRoute([]);
    setDistance(0);
    setTime(0);
    setLastArea(null);

    const interval = setInterval(() => setTime((prev) => prev + 1), 1000);
    setTimerInterval(interval);

    const subscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 2 },
      (newLocation) => {
        const { latitude, longitude } = newLocation.coords;
        setLocation(newLocation.coords);
        setRoute((prevRoute) => {
          if (prevRoute.length > 0) {
            const last = prevRoute[prevRoute.length - 1];
            setDistance((prev) => prev + getDistance(last.latitude, last.longitude, latitude, longitude));
          }
          return [...prevRoute, { latitude, longitude }];
        });
      }
    );
    setWatcher(subscription);
  };

  // ==============================
  // Corrida: finalizar
  const stopRun = async () => {
    setIsRunning(false);
    if (watcher) watcher.remove();
    if (timerInterval) clearInterval(timerInterval);

    if (route.length <= 2) return;

    const closedPolygon = [...route, route[0]];
    const area = calculateArea(closedPolygon);
    setLastArea(area);

    const newZone = { coords: closedPolygon, area, date: new Date().toISOString(), synced: false };
    const updatedPolygons = [...polygons, newZone];
    setPolygons(updatedPolygons);
    setTotalArea(updatedPolygons.reduce((acc, z) => acc + z.area, 0));

    await saveZoneOffline(updatedPolygons);

    const net = await NetInfo.fetch();
    if (net.isConnected) await syncZoneWithFirebase(newZone, updatedPolygons);
    else console.log("📴 Sem internet — zona guardada para sincronizar depois.");
  };

  // ==============================
  // Salvar localmente
  const saveZoneOffline = async (zones) => {
    try {
      await AsyncStorage.setItem(ZONES_KEY, JSON.stringify(zones));
      console.log("💾 Zona salva localmente!");
    } catch (error) {
      console.error("❌ Erro ao salvar localmente:", error);
    }
  };

  // ==============================
  // Sincronizar zona com Firebase
  const syncZoneWithFirebase = async (zone, allZones) => {
    try {
      await addDoc(collection(db, "zonas"), {
        userId: auth?.currentUser?.uid || "offline",
        coords: zone.coords,
        area: zone.area,
        totalArea: allZones.reduce((acc, z) => acc + z.area, 0),
        date: zone.date,
      });
      console.log("✅ Zona salva no Firebase!");
      await updateUserTotalArea(zone.area);

      const updatedSynced = allZones.map((z) => (z.date === zone.date ? { ...z, synced: true } : z));
      await AsyncStorage.setItem(ZONES_KEY, JSON.stringify(updatedSynced));
    } catch (error) {
      console.error("❌ Erro ao salvar zona no Firebase:", error);
    }
  };

  // ==============================
  // Atualizar total do usuário no Firebase
  const updateUserTotalArea = async (addedArea) => {
    try {
      const userRef = doc(db, "usuarios", auth.currentUser.uid);
      const snapshot = await getDoc(userRef);

      if (snapshot.exists()) {
        const prevArea = snapshot.data().totalArea || 0;
        await setDoc(userRef, { totalArea: prevArea + addedArea }, { merge: true });
      } else {
        await setDoc(userRef, { nome: auth.currentUser?.displayName || "Usuário", totalArea: addedArea, criadoEm: new Date().toISOString() }, { merge: true });
      }

      console.log("✅ Total de área do usuário atualizado!");
    } catch (err) {
      console.error("❌ Erro ao atualizar total do usuário:", err);
    }
  };

  // ==============================
  // Sincronizar todas as zonas offline
  const syncAllZonesWithFirebase = async () => {
    for (const zone of polygons.filter(z => !z.synced)) {
      await syncZoneWithFirebase(zone, polygons);
    }
  };

  // ==============================
  // Logout
  const handleLogout = async () => {
    try {
      await signOut(auth);
      Alert.alert("Logout", "Você saiu da sua conta.");
      navigation.replace("Login");
    } catch (error) {
      console.error("Erro ao sair:", error);
      Alert.alert("Erro", "Não foi possível sair.");
    }
  };

  if (!location) return <Text style={{ marginTop: 50, textAlign: "center" }}>Carregando mapa...</Text>;

  // ==============================
  return (
    <>
      <View style={styles.header}>
        {auth.currentUser && (
          <>
            {auth.currentUser.photoURL && <Image source={{ uri: auth.currentUser.photoURL }} style={styles.avatar} />}
            <Text style={styles.username}>{auth.currentUser.displayName || "Usuário"}</Text>
          </>
        )}
        <Button title="Sair" onPress={handleLogout} />
      </View>

      <MapView
        style={styles.map}
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
      >
        {route.length > 1 && <Polyline coordinates={route} strokeWidth={5} strokeColor="blue" />}
        {polygons.map((zone, index) => (
          <Polygon key={index} coordinates={zone.coords} fillColor="rgba(0,255,0,0.3)" strokeColor="green" strokeWidth={2} />
        ))}
      </MapView>

      <View style={styles.infoBox}>
        <Text>Tempo: {formatTime(time)}</Text>
        <Text>Distância: {(distance / 1000).toFixed(2)} km</Text>
        <Text>Última área: {lastArea ? formatArea(lastArea) : "-"}</Text>
        <Text>Área total: {formatArea(totalArea)}</Text>
      </View>

      <View style={styles.buttons}>
        {!isRunning ? (
          <TouchableOpacity style={styles.startButton} onPress={startRun}>
            <Text style={styles.buttonText}>Iniciar</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopButton} onPress={stopRun}>
            <Text style={styles.buttonText}>Parar</Text>
          </TouchableOpacity>
        )}
      </View>
    </>
  );
}

// ==============================
const styles = StyleSheet.create({
  map: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10 },
  username: { fontSize: 18, fontWeight: "bold" },
  infoBox: { padding: 10, backgroundColor: "#eee" },
  buttons: { flexDirection: "row", justifyContent: "center", padding: 10 },
  startButton: { backgroundColor: "green", padding: 15, borderRadius: 10, marginHorizontal: 10 },
  stopButton: { backgroundColor: "red", padding: 15, borderRadius: 10, marginHorizontal: 10 },
  buttonText: { color: "#fff", fontWeight: "bold" },
});
