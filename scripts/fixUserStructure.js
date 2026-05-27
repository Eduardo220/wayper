// scripts/fixUserStructure.js
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  updateDoc,
  doc,
} from "firebase/firestore";
import { firebaseClientConfig } from "../src/config/env.js";

// Inicializa o Firebase e Firestore
const app = initializeApp(firebaseClientConfig);
const db = getFirestore(app);

function generateUsername(name) {
  const base = (name?.split(" ")[0] || "user").toLowerCase();
  const suffix = Math.floor(Math.random() * 10000);
  return `${base}${suffix}`;
}

async function fixUserStructure() {
  console.log("🌱 Iniciando verificação da coleção 'users'...");

  const usersRef = collection(db, "users");
  const snapshot = await getDocs(usersRef);

  if (snapshot.empty) {
    console.log("⚠️ Nenhum usuário encontrado.");
    return;
  }

  let updatedCount = 0;

  for (const userDoc of snapshot.docs) {
    const data = userDoc.data();
    const updates = {};

    if (!data.username) {
      updates.username = generateUsername(data.name);
    }
    if (data.level === undefined) {
      updates.level = 1;
    }
    if (data.areaTotal === undefined) {
      updates.areaTotal = 0;
    }
    if (!Array.isArray(data.friends)) {
      updates.friends = [];
    }

    if (Object.keys(updates).length > 0) {
      await updateDoc(doc(db, "users", userDoc.id), updates);
      updatedCount++;
      console.log(`✅ Usuário atualizado: ${data.name} (${userDoc.id})`);
    }
  }

  console.log(`🎯 Atualização concluída. ${updatedCount} usuários corrigidos.`);
}

fixUserStructure()
  .then(() => {
    console.log("🚀 Finalizado com sucesso!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Erro ao atualizar:", err);
    process.exit(1);
  });
