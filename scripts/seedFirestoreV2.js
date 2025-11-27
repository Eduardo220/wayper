// scripts/seedFirestoreV2.js
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, collection, addDoc, Timestamp } from "firebase/firestore";

// 🔧 CONFIG FIREBASE (cole o seu aqui)
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

// 🧍‍♂️ Usuários de exemplo
const users = [
  {
    id: "user_eduardo",
    name: "Eduardo Weissheimer",
    email: "eduardo@wayper.com",
    avatar: "https://i.pravatar.cc/150?img=12",
    xp: 3450,
    level: 7,
    totalArea: 4.3,
    totalZones: 12,
    badges: ["explorer", "first-run"],
    username: "eduardow",
    friends: ["uid_amigo1", "uid_amigo2"], 
    friendRequests: ["uid_pendente"],
  },
  {
    id: "user_ana",
    name: "Ana Souza",
    email: "ana@wayper.com",
    avatar: "https://i.pravatar.cc/150?img=32",
    xp: 2200,
    level: 5,
    totalArea: 3.1,
    totalZones: 8,
    badges: ["streak-3days"],
  },
  {
    id: "user_lucas",
    name: "Lucas Almeida",
    email: "lucas@wayper.com",
    avatar: "https://i.pravatar.cc/150?img=45",
    xp: 5800,
    level: 9,
    totalArea: 6.8,
    totalZones: 19,
    badges: ["marathon", "city-conqueror"],
  },
];

// 🏪 Parceiros e stops
const partners = [
  {
    id: "padaria-ze",
    name: "Padaria do Zé",
    ownerEmail: "contato@padariaze.com",
    businessType: "food",
    plan: "premium",
    stops: [],
    createdAt: now(),
  },
  {
    id: "academia-viva",
    name: "Academia Viva Fit",
    ownerEmail: "viva@fit.com",
    businessType: "fitness",
    plan: "basic",
    stops: [],
    createdAt: now(),
  },
  {
    id: "cafe-moka",
    name: "Café Moka",
    ownerEmail: "moka@coffee.com",
    businessType: "coffee",
    plan: "premium",
    stops: [],
    createdAt: now(),
  },
];

// 🗺️ Stops vinculados
const stops = [
  {
    name: "Padaria do Zé",
    latitude: -29.687852,
    longitude: -53.814271,
    bonusXP: 50,
    partnerId: "padaria-ze",
    qrCodeValue: "stop_padaria_ze",
    active: true,
    image: "https://images.unsplash.com/photo-1565958011705-44b7aa0b3b1b",
    category: "alimentação",
    description: "Ganhe XP extra ao visitar a padaria do Zé.",
  },
  {
    name: "Academia Viva Fit",
    latitude: -29.682,
    longitude: -53.807,
    bonusXP: 75,
    partnerId: "academia-viva",
    qrCodeValue: "stop_academia_viva",
    active: true,
    image: "https://images.unsplash.com/photo-1554284126-aa88f22d8b74",
    category: "fitness",
    description: "XP bônus ao treinar na Academia Viva Fit.",
  },
  {
    name: "Café Moka",
    latitude: -29.685,
    longitude: -53.805,
    bonusXP: 40,
    partnerId: "cafe-moka",
    qrCodeValue: "stop_cafe_moka",
    active: true,
    image: "https://images.unsplash.com/photo-1509042239860-f550ce710b93",
    category: "cafeteria",
    description: "Pare para um café e ganhe XP extra!",
  },
];

// 🚀 Script principal
async function seedFirestore() {
  console.log("🌱 Iniciando preenchimento do Firestore...");

  // --- USERS ---
  for (const user of users) {
    await setDoc(doc(db, "users", user.id), {
      ...user,
      createdAt: now(),
      lastActive: now(),
    });
  }

  // --- PARTNERS ---
  for (const partner of partners) {
    await setDoc(doc(db, "partners", partner.id), partner);
  }

  // --- STOPS ---
  for (const stop of stops) {
    const stopRef = await addDoc(collection(db, "stops"), {
      ...stop,
      createdAt: now(),
    });

    // Atualiza o parceiro com o ID do stop
    await setDoc(
      doc(db, "partners", stop.partnerId),
      { stops: [stopRef.id] },
      { merge: true }
    );
  }

  // --- ZONES + ACTIVITIES (por usuário) ---
  for (const user of users) {
    for (let i = 0; i < 3; i++) {
      const zoneRef = await addDoc(collection(db, "zones"), {
        userId: user.id,
        coords: [
          { latitude: -29.68 + Math.random() * 0.01, longitude: -53.80 + Math.random() * 0.01 },
          { latitude: -29.681 + Math.random() * 0.01, longitude: -53.802 + Math.random() * 0.01 },
          { latitude: -29.682 + Math.random() * 0.01, longitude: -53.803 + Math.random() * 0.01 },
        ],
        area: Math.random() * 8000 + 1000,
        createdAt: now(),
        synced: true,
        type: "user_zone",
      });

      // Adiciona uma atividade correspondente
      await addDoc(collection(db, "activities"), {
        userId: user.id,
        type: "run",
        xpEarned: Math.floor(Math.random() * 150 + 50),
        date: now(),
        zoneId: zoneRef.id,
        location: { latitude: -29.68, longitude: -53.80 },
      });
    }
  }

  console.log("✅ Firestore populado com dados realistas!");
}

seedFirestore().catch((err) => console.error("❌ Erro ao popular Firestore:", err));
