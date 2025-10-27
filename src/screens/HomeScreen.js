import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';

// Função pra calcular distância entre dois pontos (em metros)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // raio da Terra em metros
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // distância em metros
}

export default function HomeScreen() {
  const [location, setLocation] = useState(null);
  const [route, setRoute] = useState([]);
  const [watcher, setWatcher] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [distance, setDistance] = useState(0);
  const [time, setTime] = useState(0);
  const [timerInterval, setTimerInterval] = useState(null);

  // Pede permissão e pega localização inicial
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permissão negada', 'Ative o GPS para usar o app.');
        return;
      }

      let loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);
    })();
  }, []);

  // Inicia a corrida
  const startRun = async () => {
    setIsRunning(true);
    setRoute([]);
    setDistance(0);
    setTime(0);

    // inicia o cronômetro
    const interval = setInterval(() => {
      setTime((prev) => prev + 1);
    }, 1000);
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

  // Para a corrida
  const stopRun = () => {
    setIsRunning(false);
    if (watcher) watcher.remove();
    if (timerInterval) clearInterval(timerInterval);
    setWatcher(null);
    setTimerInterval(null);
  };

  // Formata tempo em mm:ss
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  if (!location) {
    return <Text style={{ marginTop: 50, textAlign: 'center' }}>Carregando mapa...</Text>;
  }

  return (
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
        {route.length > 0 && (
          <Polyline coordinates={route} strokeWidth={5} strokeColor="#00BFFF" />
        )}
        <Marker coordinate={location} title="Você" />
      </MapView>

      {/* Painel de info */}
      {isRunning && (
        <View style={styles.infoPanel}>
          <Text style={styles.infoText}>
            🕒 Tempo: {formatTime(time)}
          </Text>
          <Text style={styles.infoText}>
            📏 Distância: {(distance / 1000).toFixed(2)} km
          </Text>
        </View>
      )}

      {/* Botão principal */}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: isRunning ? '#FF6347' : '#4CAF50' }]}
        onPress={isRunning ? stopRun : startRun}
      >
        <Text style={styles.buttonText}>
          {isRunning ? 'Parar corrida' : 'Iniciar corrida'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  infoPanel: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  infoText: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: '#fff',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginVertical: 4,
  },
  button: {
    position: 'absolute',
    bottom: 40,
    left: '25%',
    right: '25%',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
