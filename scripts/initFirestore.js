/**
 * Firestore Bootstrap — FIXED FOR REGIONAL DATABASES
 */

import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import { fileURLToPath } from "url";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ===========================================
// PATHS
// ===========================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVICE_PATH = path.join(__dirname, "serviceAccountKey.json");

if (!fs.existsSync(SERVICE_PATH)) {
  console.error("❌ serviceAccountKey.json não encontrado!");
  process.exit(1);
}

const creds = JSON.parse(fs.readFileSync(SERVICE_PATH, "utf8"));
const PROJECT_ID = creds.project_id;
const DATABASE_ID = PROJECT_ID; // <<--- SEU databaseId real

// ===========================================
// INIT ADMIN
// ===========================================
admin.initializeApp({
  credential: admin.credential.cert(creds),
});

// 🔥 FIRESTORE FORÇADO NO DATABASE CORRETO
const db = getFirestore(admin.app(), DATABASE_ID);

// ===========================================
// BATCH WRITE
// ===========================================
async function batchCreate(docs = []) {
  const batch = db.batch();
  for (const { path, data } of docs) {
    batch.set(db.doc(path), { ...data, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  await batch.commit();
}

// ===========================================
// STRUCTURE
// ===========================================
const ROOT = [
  "zones",
  "medals",
  "friend_requests",
  "friends",
  "clans",
].map(c => ({
  path: `${c}/_init`,
  data: { system: true }
}));

const USER = {
  path: `users/wayper_demo_user`,
  data: {
    uid: "wayper_demo_user",
    displayName: "Demo User",
    stats: {
      totalDistance: 0,
      totalRuns: 0,
      zonesCaptured: 0,
      medals: 0
    }
  }
};

const SUBS = [
  { path: `users/wayper_demo_user/runs/_init`, data: {} },
  { path: `users/wayper_demo_user/friends/_init`, data: {} },
  { path: `users/wayper_demo_user/clans/_init`, data: {} },
];

// ===========================================
// MAIN
// ===========================================
async function main() {
  try {
    console.log("🔥 Iniciando Wayper Firestore Bootstrap...");

    // teste leve para validar o DB
    await db.collection("_db_check").limit(1).get();

    console.log("🔧 Criando estrutura...");
    await batchCreate([
      ...ROOT,
      USER,
      ...SUBS
    ]);

    console.log("✅ Firestore inicializado com sucesso usando databaseId:", DATABASE_ID);
  } catch (err) {
    console.error("❌ Erro ao inicializar Firestore:", err);
  }
}

main();
