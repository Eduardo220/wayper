// scripts/seedFirestoreClans.js
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  addDoc,
  Timestamp,
} from "firebase/firestore";

// ------------------------------------------------------
// 🔧 CONFIG FIREBASE (usa a mesma do teu projeto)
// ------------------------------------------------------
const firebaseConfig = {
  apiKey: "IzaSyDMEuHH1fq9qlGL6cfIK6jA9UvqD4YFS6Y",
  authDomain: "wayper-3ee61.firebaseapp.com",
  projectId: "wayper-3ee61",
  storageBucket: "wayper-3ee61.appspot.com",
  messagingSenderId: "284903184569",
  appId: "1:284903184569:web:956fb1d235443d002f2368",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const now = () => Timestamp.fromDate(new Date());

// ------------------------------------------------------
//  CLANS DE EXEMPLO (realistas)
// ------------------------------------------------------
const clans = [
  {
    id: "clan_wayper_elite",
    name: "Wayper Elite",
    tag: "WPE",
    description: "Os lunáticos mais viciados em dominar áreas.",
    avatar: null,
    ownerId: "user_eduardo",
    coLeaders: ["user_lucas"],
    membersCount: 3,
    public: true,
    createdAt: now(),
    announcement: "Bem-vindo ao clã! Rumo ao topo.",
    stats: {
      totalZones: 120,
      totalArea: 43.8,
      totalXP: 22400,
    },
  },
  {
    id: "clan_corredores_br",
    name: "Corredores BR",
    tag: "CBR",
    description: "Pessoal que corre porque paga de saudável.",
    avatar: null,
    ownerId: "user_lucas",
    coLeaders: [],
    membersCount: 2,
    public: false,
    createdAt: now(),
    announcement: "",
    stats: {
      totalZones: 55,
      totalArea: 22.4,
      totalXP: 9800,
    },
  },
];

// ------------------------------------------------------
//  CHAT INICIAL PARA CADA CLÃ
// ------------------------------------------------------
const sampleChat = [
  {
    fromUid: "user_eduardo",
    text: "Bora dominar mais umas quadras hoje?",
    type: "text",
    createdAt: now(),
  },
  {
    fromUid: "user_lucas",
    text: "Se não chover, tô dentro.",
    type: "text",
    createdAt: now(),
  },
];

// ------------------------------------------------------
//  MEMBERSHIP INICIAL
// ------------------------------------------------------
const clanMembers = {
  clan_wayper_elite: [
    { uid: "user_eduardo", role: "owner" },
    { uid: "user_lucas", role: "co-leader" },
    { uid: "user_ana", role: "member" },
  ],
  clan_corredores_br: [
    { uid: "user_lucas", role: "owner" },
    { uid: "user_ana", role: "member" },
  ],
};

// ------------------------------------------------------
//  INVITES DE EXEMPLO
// ------------------------------------------------------
const invites = [
  {
    code: "WPE123",
    clanId: "clan_wayper_elite",
    createdBy: "user_eduardo",
    maxUses: 10,
    uses: 0,
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 86400000)),
  },
  {
    code: "CBR999",
    clanId: "clan_corredores_br",
    createdBy: "user_lucas",
    maxUses: 5,
    uses: 0,
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 3 * 86400000)),
  },
];

// ------------------------------------------------------
//  SCRIPT PRINCIPAL
// ------------------------------------------------------
async function seedClans() {
  console.log("🌱 Criando CLANS no Firestore...");

  // -----------------------------
  //   CLANS ROOT
  // -----------------------------
  for (const clan of clans) {
    await setDoc(doc(db, "clans", clan.id), clan);
  }

  // -----------------------------
  //   MEMBERS
  // -----------------------------
  for (const clan of clans) {
    const members = clanMembers[clan.id] || [];

    for (const m of members) {
      await setDoc(doc(db, "clans", clan.id, "members", m.uid), {
        uid: m.uid,
        role: m.role,
        joinedAt: now(),
      });

      // index no usuário
      await addDoc(collection(db, "users", m.uid, "clans"), {
        clanId: clan.id,
        role: m.role,
        joinedAt: now(),
      });
    }
  }

  // -----------------------------
  //   CHAT
  // -----------------------------
  for (const clan of clans) {
    for (const msg of sampleChat) {
      await addDoc(collection(db, "clans", clan.id, "chat"), msg);
    }
  }

  // -----------------------------
  //   INVITES
  // -----------------------------
  for (const inv of invites) {
    await setDoc(doc(db, "invites", inv.code), inv);
  }

  console.log("✅ CLANS adicionados com sucesso!");
}

seedClans().catch((err) =>
  console.error("❌ Erro ao criar dados de Clãs:", err)
);
