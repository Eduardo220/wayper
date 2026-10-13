import { describe, expect, test } from "@jest/globals";
import { formatRankingMetric, hasCurrentPosition, INITIAL_RANKING_SELECTION, rankingRequest, rankingRows } from "../rankingHomeModel.js";

describe("ranking home model", () => {
  test("traduz a seleção inicial para o contrato existente", () => {
    expect(rankingRequest(INITIAL_RANKING_SELECTION, "Santa Maria")).toEqual({
      scope: "global", city: null, mode: "distance", period: "monthly", limitTo: 300,
    });
    expect(rankingRequest({ mode: "zones", scope: "regional", period: "allTime" }, " Porto Alegre ")).toEqual({
      scope: "regional", city: "Porto Alegre", mode: "area", period: "all", limitTo: 300,
    });
  });

  test("ordena a posição pela métrica selecionada e não usa total como mensal", () => {
    const rows = [
      { id: "me", city: "Porto Alegre", distance: 12000, area: 500, monthlyDistance: 3000, monthlyArea: 200, raw: { rankingMonth: "2026-06", monthlyDistance: 3000, monthlyArea: 200 } },
      { id: "other", city: "Porto Alegre", distance: 6000, area: 900, monthlyDistance: 6000, monthlyArea: 900, raw: { rankingMonth: "2026-06", monthlyArea: 900 } },
      { id: "away", city: "Curitiba", distance: 20000, area: 1000, monthlyDistance: 20000, monthlyArea: 1000, raw: { rankingMonth: "2026-05", monthlyDistance: 20000, monthlyArea: 1000 } },
      { id: "local-overlay", city: "Porto Alegre", distance: 2000, area: 100, monthlyDistance: 1000, monthlyArea: 100, localOnly: true, raw: { rankingMonth: "2026-05", monthlyDistance: 9000 } },
    ];
    expect(rankingRows(rows, INITIAL_RANKING_SELECTION, null, "2026-06").map((row) => row.id)).toEqual(["me", "local-overlay"]);
    expect(rankingRows(rows, { mode: "zones", scope: "regional", period: "monthly" }, "porto alegre", "2026-06").map((row) => [row.id, row.rank])).toEqual([["other", 1], ["me", 2], ["local-overlay", 3]]);
    expect(rankingRows(rows, { mode: "km", scope: "regional", period: "allTime" }, "Porto Alegre", "2026-06").map((row) => [row.id, row.rank])).toEqual([["me", 1], ["other", 2], ["local-overlay", 3]]);
    expect(rankingRows([{ id: "unverified-month", monthlyDistance: 20000 }], INITIAL_RANKING_SELECTION, null, "2026-06")).toEqual([]);
    expect(formatRankingMetric(46200, "km")).toBe("46,2 km");
  });

  test("não apresenta posição competitiva para cache ou dado local", () => {
    expect(hasCurrentPosition("remote", { id: "me", rank: 2 })).toBe(true);
    expect(hasCurrentPosition("cache", { id: "me", rank: 2 })).toBe(false);
    expect(hasCurrentPosition("local", { id: "me", rank: 1, localOnly: true })).toBe(false);
    expect(hasCurrentPosition("remote", null)).toBe(false);
  });
});
