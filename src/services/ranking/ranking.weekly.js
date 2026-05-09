// src/services/ranking/ranking.weekly.js
import { fetchUsers } from "./fetchFirestore";
import { computeLeaderboard } from "./compute";
import { DEFAULT_WEIGHTS } from "./compute";

const WEEKLY_WEIGHTS = {
  ...DEFAULT_WEIGHTS,
  zones: 0.4,
  area: 0.4,
  xp: 0.6,
  weeklyPoints: 2.0, // DOMINANTE
};

export async function fetchWeeklyRanking({
  scope = "global",
  city = null,
  neighborhood = null,
  friendsList = [],
  limitTo = 200,
} = {}) {
  const raw = await fetchUsers({ scope, city, neighborhood, friendsList, limitTo });

  return computeLeaderboard(raw, {
    weights: WEEKLY_WEIGHTS,
    primary: "weeklyPoints",
  });
}
