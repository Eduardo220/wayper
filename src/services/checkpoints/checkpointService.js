// src/services/checkpoints/checkpointService.js
import { db } from "../../firebaseConfig";
import { collection, getDocs, query } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDistance } from "../../utils/geo";

const VISITED_KEY = "visited_checkpoints";
const PROXIMITY_RADIUS_M = 50;

export async function loadCheckpoints() {
  try {
    const q = query(collection(db, "checkpoints"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
      };
    });
  } catch (err) {
    console.error("loadCheckpoints:", err);
    return [];
  }
}

export async function loadVisitedPoints() {
  try {
    const raw = await AsyncStorage.getItem(VISITED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("loadVisitedPoints:", err);
    return [];
  }
}

export async function saveVisitedPoints(list = []) {
  try {
    await AsyncStorage.setItem(VISITED_KEY, JSON.stringify(list));
  } catch (err) {
    console.error("saveVisitedPoints:", err);
  }
}

export function findNearbyCheckpoint(position, checkpoints = [], visitedIds = []) {
  for (const cp of checkpoints) {
    if (!cp || visitedIds.includes(cp.id)) continue;
    if (typeof cp.latitude !== "number" || typeof cp.longitude !== "number") continue;
    const d = getDistance(position.latitude, position.longitude, cp.latitude, cp.longitude);
    if (d <= PROXIMITY_RADIUS_M) return cp;
  }
  return null;
}
