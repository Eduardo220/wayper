// src/services/zones/zoneService.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { db, auth } from "../../firebaseConfig";
import { addDoc, collection } from "firebase/firestore";

const ZONES_KEY = "zones";

export async function loadLocalZones() {
  try {
    const raw = await AsyncStorage.getItem(ZONES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("loadLocalZones:", err);
    return [];
  }
}

export async function saveLocalZones(zones = []) {
  try {
    await AsyncStorage.setItem(ZONES_KEY, JSON.stringify(zones));
  } catch (err) {
    console.error("saveLocalZones:", err);
  }
}

export async function syncZonesToFirestore(zones = []) {
  try {
    const unsynced = zones.filter((z) => !z.synced);
    for (const zone of unsynced) {
      await addDoc(collection(db, "zonas"), {
        userId: auth?.currentUser?.uid || "offline",
        coords: zone.coords,
        area: zone.area,
        date: zone.date,
      });
    }
    // marca como synced localmente (não salva automaticamente aqui)
    return zones.map((z) => ({ ...z, synced: true }));
  } catch (err) {
    console.error("syncZonesToFirestore:", err);
    return zones;
  }
}
