// ============================================================================
//  RANKING SERVICE – Wayper
//  Sistema profissional, escalável, multilíder e multi-dimensões de ranking
//  - ranking global
//  - ranking regional (por cidade / bairro)
//  - ranking de amigos
//  - ranking por zona / área / XP / elo / corrida livre
//  - ranking diário, semanal e mensal (com cache local)
//  - pronto para Firebase v9
// ============================================================================

import { db } from "./firebase";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";

// ============================================================================
// MAPA DE CAMPOS RANQUEÁVEIS
// Aqui tu adiciona qualquer métrica nova no futuro
// ============================================================================

export const RANK_FIELDS = {
  zones: "zones",            // zonas capturadas
  area: "area",              // área total dominada
  xp: "xp",                  // experiência total
  elo: "eloScore",           // elo estilo Clash Royale
  runs: "totalRuns",         // corridas livres
  speed: "topSpeed",         // maior velocidade atingida
};

// ============================================================================
// FUNÇÃO PRINCIPAL DE RANKING
// scope = "global" | "regional" | "neighborhood" | "friends"
// criterion = "zones" | "area" | "xp" | "elo" | ...
// ============================================================================

export async function fetchRanking({
  city = null,
  neighborhood = null,
  scope = "global",
  criterion = "zones",
  friendsList = [],
  limitTo = 100,
}) {
  try {
    const ref = collection(db, "users");
    const orderField = RANK_FIELDS[criterion] || "zones";

    let q = ref;

    // ----------------------------
    // FILTRAGEM POR ESCOPOS
    // ----------------------------

    if (scope === "regional" && city) {
      q = query(ref, where("city", "==", city));
    }

    if (scope === "neighborhood" && city && neighborhood) {
      q = query(
        ref,
        where("city", "==", city),
        where("neighborhood", "==", neighborhood)
      );
    }

    if (scope === "friends" && friendsList.length > 0) {
      q = query(ref, where("__name__", "in", friendsList));
    }

    // ----------------------------
    // ORDENAÇÃO + LIMITE
    // ----------------------------
    q = query(q, orderBy(orderField, "desc"), limit(limitTo));

    const snap = await getDocs(q);

    const list = [];
    snap.forEach((d) => {
      list.push({
        id: d.id,
        ...cleanUserForRanking(d.data()),
      });
    });

    return list;
  } catch (err) {
    console.error("ERROR FETCH RANKING:", err);
    return [];
  }
}

// ============================================================================
// SANITIZAÇÃO DE DADOS DO USUÁRIO PARA RANKING
// Evita undefined, falta de campos, etc
// ============================================================================

function cleanUserForRanking(user) {
  return {
    name: user.name || "Jogador",
    avatar: user.avatar || null,
    city: user.city || "",
    neighborhood: user.neighborhood || "",
    xp: user.xp || 0,
    level: user.level || inferLevel(user.xp || 0),
    zones: user.zones || 0,
    area: user.area || 0,
    eloScore: user.eloScore || 1000,
    totalRuns: user.totalRuns || 0,
    topSpeed: user.topSpeed || 0,
  };
}

// ============================================================================
// SISTEMA DE NÍVEL baseando em XP
// ============================================================================

function inferLevel(xp) {
  return Math.floor(1 + xp / 500);
}

// ============================================================================
// RANKINGS TEMPORIZADOS (para rankings diário / semanal / mensal)
// ============================================================================

export function groupDaily(users) {
  return [...users].sort((a, b) => (b.dailyPoints || 0) - (a.dailyPoints || 0));
}

export function groupWeekly(users) {
  return [...users].sort((a, b) => (b.weeklyPoints || 0) - (a.weeklyPoints || 0));
}

export function groupMonthly(users) {
  return [...users].sort((a, b) => (b.monthlyPoints || 0) - (a.monthlyPoints || 0));
}

// ============================================================================
// RANKING AVANÇADO POR REGIÃO (subdivisão automática)
// ============================================================================

export function sortByNeighborhood(users) {
  const map = {};

  users.forEach((u) => {
    const nb = u.neighborhood || "Desconhecido";
    if (!map[nb]) map[nb] = [];
    map[nb].push(u);
  });

  Object.keys(map).forEach((nb) => {
    map[nb].sort((a, b) => b.zones - a.zones);
  });

  return map;
}

// ============================================================================
// SISTEMA AVANÇADO DE ELO (tipo Clash Royale)
// ============================================================================

export function calculateEloChanges(user, action) {
  // Ações possíveis: capture_zone, lose_zone, run, streak, season_bonus
  const table = {
    capture_zone: +25,
    lose_zone: -20,
    run: +5,
    streak: +50,
    season_bonus: +200,
  };

  return table[action] || 0;
}
