// src/services/ranking/ranking.all.js
import { fetchUsers } from "./fetchFirestore";
import { computeLeaderboard } from "./compute";
import { DEFAULT_WEIGHTS } from "./compute";

export async function fetchAllRanking({
  scope = "global",
  city = null,
  neighborhood = null,
  friendsList = [],
  criterion = "zones",
  limitTo = 200,
  weights = DEFAULT_WEIGHTS,
} = {}) {
  const raw = await fetchUsers({ scope, city, neighborhood, friendsList, limitTo });
  const primary = criterion;
  return computeLeaderboard(raw, { weights, primary });
}
