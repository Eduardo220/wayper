import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebaseConfig";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ZONES_KEY = "zones";

export const syncZonesWithFirebase = async () => {
  try {
    const localData = await AsyncStorage.getItem(ZONES_KEY);
    const localZones = localData ? JSON.parse(localData) : [];

    if (!localZones.length) {
      console.log("📭 Nenhuma zona local para sincronizar.");
      return;
    }

    console.log("🔄 Verificando zonas não sincronizadas...");

    // opcional: checar se zona já foi enviada antes
    const q = query(collection(db, "zones"));
    const snapshot = await getDocs(q);
    const firebaseZones = snapshot.docs.map((doc) => doc.data());

    const unsynced = localZones.filter(
      (z) =>
        !firebaseZones.some(
          (f) => JSON.stringify(f.coords) === JSON.stringify(z.coords)
        )
    );

    if (unsynced.length === 0) {
      console.log("✅ Tudo sincronizado com o Firebase!");
      return;
    }

    for (const zone of unsynced) {
      await addDoc(collection(db, "zones"), {
        coords: zone.coords,
        area: zone.area,
        createdAt: new Date().toISOString(),
      });
    }

    console.log(`☁️ ${unsynced.length} zonas sincronizadas com o Firebase!`);
  } catch (error) {
    console.error("❌ Erro ao sincronizar zonas:", error);
  }
};
