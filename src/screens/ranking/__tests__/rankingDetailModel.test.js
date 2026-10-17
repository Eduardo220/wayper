import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { rankingPreviewData } from "../__fixtures__/rankingPreviewData.js";
import { badgeVariant, rankingContext, rankingMetric, rankingZoneCount, visibleRanking } from "../rankingDetailModel.js";

const base = { mode: "km", scope: "global", period: "monthly" };

describe("ranking detail presentation", () => {
  test("preview DEV só aparece sem linhas reais e não altera os dados de origem", () => {
    const preview = rankingPreviewData(base);
    const real = [{ id: "real", rank: 1, metric: 1000 }];
    expect(visibleRanking([], preview, true)).toMatchObject({ preview: true, rows: preview.rows });
    expect(visibleRanking(real, preview, true)).toMatchObject({ preview: false, rows: real });
    expect(visibleRanking([], preview, false)).toMatchObject({ preview: false, rows: [] });
    expect(real).toEqual([{ id: "real", rank: 1, metric: 1000 }]);
    expect(readFileSync(new URL("../../../repositories/rankingRepository.js", import.meta.url), "utf8")).not.toContain("rankingPreviewData");
  });

  test("modalidade muda métrica, barra pessoal e top 3", () => {
    const km = rankingPreviewData(base);
    const zones = rankingPreviewData({ ...base, mode: "zones" });
    expect(rankingMetric(km.rows[0], "km")).toBe("4.010 km");
    expect(rankingMetric(km.me, "km")).toBe("46,2 km");
    expect(rankingMetric(zones.rows[0], "zones")).toBe("182,4 km²");
    expect(rankingMetric(zones.me, "zones")).toBe("15,3 km²");
    expect(rankingZoneCount(zones.rows[0], true, "monthly")).toBe("24 zonas");
    expect(rankingZoneCount({ zones: 24 }, false, "monthly")).toBeNull();
    expect([1, 2, 3, 4].map(badgeVariant)).toEqual(["gold", "silver", "bronze", "neutral"]);
  });

  test("Global, Regional, Mensal e Geral atualizam contexto", () => {
    expect(rankingContext(base, "", "2026-10").scope).toBe("RANKING GLOBAL");
    expect(rankingContext(base, "", "2026-10").period).toBe("Mensal • Outubro 2026");
    expect(rankingContext({ ...base, scope: "regional", period: "allTime", mode: "zones" }, "Santa Maria", "2026-10")).toEqual({
      scope: "RANKING REGIONAL", title: "ZONAS DOMINADAS", period: "Geral • Santa Maria • Todo o período",
    });
    expect(rankingContext({ ...base, scope: "regional" }, "", "2026-10", true).period).toContain("Santa Maria, RS");
    expect(rankingPreviewData({ ...base, period: "allTime" }).rows[0].metric).toBeGreaterThan(rankingPreviewData(base).rows[0].metric);
  });
});
