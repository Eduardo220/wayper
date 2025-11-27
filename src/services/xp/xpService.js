// src/services/xp/xpService.js
import { db, auth } from "../../firebaseConfig";
import { doc, getDoc, setDoc } from "firebase/firestore";

export async function awardXPToUser(cp) {
  if (!auth?.currentUser) {
    console.log("awardXPToUser: usuário offline, não persiste no Firestore.");
    return;
  }
  try {
    const userRef = doc(db, "usuarios", auth.currentUser.uid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const data = snap.data();
      const prevXP = data.xp || 0;
      const prevVisited = data.visitedCheckpoints || [];
      const newXP = prevXP + (cp.bonusXP || 0);
      const newVisited = Array.from(new Set([...prevVisited, cp.id]));
      await setDoc(userRef, { xp: newXP, visitedCheckpoints: newVisited }, { merge: true });
    } else {
      await setDoc(userRef, {
        xp: cp.bonusXP || 0,
        visitedCheckpoints: [cp.id],
        nome: auth.currentUser.displayName || "Usuário",
      }, { merge: true });
    }
    console.log("XP creditado:", cp.bonusXP || 0);
  } catch (err) {
    console.error("awardXPToUser:", err);
  }
}
