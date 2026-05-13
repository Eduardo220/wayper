import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  setDoc,
  Timestamp,
} from "firebase/firestore";

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

const groups = [
  {
    id: "group_wayper_elite",
    name: "Wayper Elite",
    tag: "WPE",
    description: "Grupo focado em dominar áreas e evoluir no ranking.",
    avatar: null,
    ownerId: "user_eduardo",
    coLeaders: ["user_lucas"],
    membersCount: 3,
    public: true,
    createdAt: now(),
    announcement: "Bem-vindo ao grupo! Rumo ao topo.",
    stats: {
      totalZones: 120,
      totalArea: 43.8,
      totalXP: 22400,
    },
  },
  {
    id: "group_corredores_br",
    name: "Corredores BR",
    tag: "CBR",
    description: "Pessoal que corre junto e disputa território.",
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

const sampleChat = [
  {
    fromUid: "user_eduardo",
    text: "Bora dominar mais umas quadras hoje?",
    type: "text",
    createdAt: now(),
  },
  {
    fromUid: "user_lucas",
    text: "Se não chover, estou dentro.",
    type: "text",
    createdAt: now(),
  },
];

const groupMembers = {
  group_wayper_elite: [
    { uid: "user_eduardo", role: "owner" },
    { uid: "user_lucas", role: "co-leader" },
    { uid: "user_ana", role: "member" },
  ],
  group_corredores_br: [
    { uid: "user_lucas", role: "owner" },
    { uid: "user_ana", role: "member" },
  ],
};

const invites = [
  {
    code: "WPE123",
    groupId: "group_wayper_elite",
    createdBy: "user_eduardo",
    maxUses: 10,
    uses: 0,
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 86400000)),
  },
  {
    code: "CBR999",
    groupId: "group_corredores_br",
    createdBy: "user_lucas",
    maxUses: 5,
    uses: 0,
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 3 * 86400000)),
  },
];

async function seedGroups() {
  console.log("Criando grupos no Firestore...");

  for (const group of groups) {
    await setDoc(doc(db, "groups", group.id), group);
  }

  for (const group of groups) {
    const members = groupMembers[group.id] || [];

    for (const member of members) {
      await setDoc(doc(db, "groups", group.id, "members", member.uid), {
        uid: member.uid,
        role: member.role,
        joinedAt: now(),
      });

      await addDoc(collection(db, "users", member.uid, "groups"), {
        groupId: group.id,
        role: member.role,
        joinedAt: now(),
      });
    }
  }

  for (const group of groups) {
    for (const message of sampleChat) {
      await addDoc(collection(db, "groups", group.id, "chat"), message);
    }
  }

  for (const invite of invites) {
    await setDoc(doc(db, "invites", invite.code), invite);
  }

  console.log("Grupos adicionados com sucesso!");
}

seedGroups().catch((error) => {
  console.error("Erro ao criar dados de grupos:", error);
});
