import React, { useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from "react-native";
import * as Location from "expo-location";
import { collection, getDocs, query } from "firebase/firestore";
import { db } from "../firebaseConfig";

export default function PointsNearbyScreen({ navigation }) {
  const [checkpoints, setCheckpoints] = useState([]);
  const [filter, setFilter] = useState("all");
  const [location, setLocation] = useState(null);

  useEffect(() => {
    (async () => {
      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);

      const q = query(collection(db, "checkpoints"));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setCheckpoints(list);
    })();
  }, []);

  const calcDist = (cp) => {
    if (!location) return "-";
    const R = 6371e3;
    const φ1 = (location.latitude * Math.PI) / 180;
    const φ2 = (cp.latitude * Math.PI) / 180;
    const Δφ = ((cp.latitude - location.latitude) * Math.PI) / 180;
    const Δλ = ((cp.longitude - location.longitude) * Math.PI) / 180;
    const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const d = R*c;
    return d < 1000 ? `${Math.round(d)} m` : `${(d/1000).toFixed(2)} km`;
  };

  const filtered = checkpoints.filter(cp => filter === "all" ? true : (filter === "partner" ? cp.partner : !cp.partner));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pontos Próximos</Text>

      <View style={styles.filters}>
        <TouchableOpacity onPress={() => setFilter("all")} style={[styles.btn, filter==='all' && styles.active]}><Text>Todos</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setFilter("partner")} style={[styles.btn, filter==='partner' && styles.active]}><Text>Parceiros</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setFilter("normal")} style={[styles.btn, filter==='normal' && styles.active]}><Text>Normais</Text></TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.desc}>{item.description}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.dist}>{calcDist(item)}</Text>
              <TouchableOpacity style={styles.jumpBtn} onPress={() => navigation.navigate("Mapa", { goto: item })}>
                <Text style={{ color: "#fff" }}>Ir</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:{ flex:1, padding:16, backgroundColor:"#fff" },
  title:{ fontSize:20, fontWeight:"700", marginBottom:10 },
  filters:{ flexDirection:"row", gap:8, marginBottom:12 },
  btn:{ padding:8, backgroundColor:"#eee", borderRadius:8 },
  active:{ backgroundColor:"#00b894" },
  item:{ flexDirection:"row", padding:12, backgroundColor:"#f7f7f7", borderRadius:10, marginBottom:8 },
  name:{ fontWeight:"700" },
  desc:{ color:"#666", fontSize:12 },
  dist:{ fontWeight:"700" },
  jumpBtn:{ marginTop:8, backgroundColor:"#00b894", paddingHorizontal:10, paddingVertical:6, borderRadius:8 }
});
