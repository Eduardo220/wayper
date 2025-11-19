import { db } from "../../firebaseConfig";
import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

/**
 * Verifica se o nome de usuário já está em uso.
 */
export async function isUsernameAvailable(username) {
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("username", "==", username));
  const snapshot = await getDocs(q);

  return snapshot.empty; // true se está livre
}

/**
 * Cria o usuário no Firestore caso não exista.
 */
export async function createUserIfNotExists(user, usernameInput) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    // Base para username
    let baseUsername =
      usernameInput ||
      user.displayName?.toLowerCase().replace(/\s+/g, "") ||
      user.email.split("@")[0].toLowerCase();

    // Sanitize só pra garantir
    baseUsername = baseUsername.replace(/[^a-z0-9._]/gi, "");

    // Testa disponibilidade
    let username = baseUsername;
    let counter = 1;

    while (!(await isUsernameAvailable(username))) {
      username = `${baseUsername}${counter}`;
      counter++;
    }

    await setDoc(userRef, {
      uid: user.uid,
      username: username,
      name: user.displayName || "Novo usuário",
      email: user.email,
      avatar:
        user.photoURL ||
        "https://cdn-icons-png.flaticon.com/512/149/149071.png",
      xp: 0,
      level: 1,
      totalArea: 0,
      totalZones: 0,
      createdAt: serverTimestamp(),
      lastActive: serverTimestamp(),
      badges: ["explorer"],
    });

    console.log(`Usuário criado: ${username}`);
  }
}
