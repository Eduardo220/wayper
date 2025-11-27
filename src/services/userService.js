import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig"; // ajusta o caminho

export async function getUser(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return snap.data();
}
