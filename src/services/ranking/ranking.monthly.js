// src/services/ranking/ranking.monthly.js
import { fetchUsers } from "./fetchFirestore";
import { computeLeaderboard } from "./compute";
import { DEFAULT_WEIGHTS } from "./compute";

const MONTHLY_WEIGHTS = {
  ...DEFAULT_WEIGHTS,
  zones: 0.5,
  area: 0.7,
  distance: 0.7,
  xp: 0.7,
  monthlyPoints: 1.6, // destaque
  monthlyArea: 1.8,
  monthlyDistance: 1.8,
};

export async function fetchMonthlyRanking({
  scope = "global",
  city = null,
  neighborhood = null,
  friendsList = [],
  criterion = "area",
  limitTo = 200,
} = {}) {
  const raw = await fetchUsers({ scope, city, neighborhood, friendsList, limitTo });
  const primary = criterion === "distance" || criterion === "km" ? "monthlyDistance" : "monthlyArea";

  return computeLeaderboard(raw, {
    weights: MONTHLY_WEIGHTS,
    primary,
  });
}
