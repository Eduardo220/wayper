// src/services/ranking/fetchFirestore.js
import { db } from "../../firebaseConfig.js";
import {
  collection,
  query,
  getDocs,
  where,
  limit,
} from "firebase/firestore";

export async function fetchUsers({ scope, city, neighborhood, friendsList, limitTo }) {
  try {
    const col = collection(db, "users");
    let q = col;

    if (scope === "regional" && city) {
      q = query(col, where("city", "==", city), limit(limitTo));
    } else if (scope === "neighborhood" && city && neighborhood) {
      q = query(
        col,
        where("city", "==", city),
        where("neighborhood", "==", neighborhood),
        limit(limitTo)
      );
    } else if (scope === "friends" && friendsList?.length) {
      const results = [];
      const size = 10;
      for (let i = 0; i < friendsList.length; i += size) {
        const chunk = friendsList.slice(i, i + size);
        const q2 = query(col, where("__name__", "in", chunk), limit(limitTo));
        const snap = await getDocs(q2);
        snap.forEach((d) => {
          const data = d.data();
          if (data?.isPrivate || data?.profileVisibility === "private") return;
          results.push({ id: d.id, ...data });
        });
      }
      return results;
    } else {
      q = query(col, limit(limitTo));
    }

    const snap = await getDocs(q);

    const arr = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data?.isPrivate || data?.profileVisibility === "private") return;
      arr.push({ id: d.id, ...data });
    });
    return arr;
  } catch (err) {
    console.warn("fetchUsers error:", err);
    return [];
  }
}
