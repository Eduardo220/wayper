import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  TRACKING_RENDER_PATH_CACHE_MAX_ENTRIES,
  __getTrackingRenderPathCacheSizeForTests,
  __getTrackingRenderPathCacheStatsForTests,
  buildLiveRenderPath,
  buildSummaryRenderPath,
  clearTrackingRenderPathCache,
} from "../trackingRenderPath.js";

function makePath(seed = 0, count = 12) {
  return Array.from({ length: count }, (_, index) => ({
    latitude: -23.56 + index * 0.00008,
    longitude: -46.64 + seed * 0.001 + (index % 2 === 0 ? 0.00012 : -0.00012),
    accuracy: 8,
    timestamp: 1_700_000_000_000 + seed * 100_000 + index * 2_000,
  }));
}

describe("trackingRenderPath cache", () => {
  beforeEach(() => {
    clearTrackingRenderPathCache();
  });

  test("mantem no maximo duas entradas LRU", () => {
    const first = makePath(0);
    const second = makePath(1);
    const third = makePath(2);

    buildSummaryRenderPath(first);
    buildSummaryRenderPath(second);
    buildSummaryRenderPath(first);
    buildSummaryRenderPath(third);
    buildSummaryRenderPath(second);

    expect(__getTrackingRenderPathCacheSizeForTests()).toBe(
      TRACKING_RENDER_PATH_CACHE_MAX_ENTRIES
    );
    expect(__getTrackingRenderPathCacheStatsForTests()).toEqual({
      hits: 1,
      misses: 4,
      bypasses: 0,
      evictions: 2,
    });
  });

  test("clear remove todas as entradas e o cache preserva copias internas", () => {
    const path = makePath(1);
    const first = buildSummaryRenderPath(path);
    first[0].latitude = 10;

    const cached = buildSummaryRenderPath(path);
    expect(cached[0].latitude).toBe(path[0].latitude);
    expect(__getTrackingRenderPathCacheSizeForTests()).toBe(1);

    clearTrackingRenderPathCache();
    expect(__getTrackingRenderPathCacheSizeForTests()).toBe(0);
  });

  test("maxPoints participa da chave do cache", () => {
    const path = makePath(2, 24);
    const capped = buildLiveRenderPath(path, { maxPoints: 4 });
    const expanded = buildLiveRenderPath(path, { maxPoints: 40 });

    expect(capped.length).toBeLessThanOrEqual(4);
    expect(expanded.length).toBeGreaterThan(capped.length);
  });

  test("maxPoints tambem limita o fallback do resumo", () => {
    const path = makePath(8, 100);

    const summary = buildSummaryRenderPath(path, { maxPoints: 4 });

    expect(summary.length).toBeLessThanOrEqual(4);
    expect(summary[0]).toMatchObject(path[0]);
    expect(summary[summary.length - 1]).toMatchObject(path[path.length - 1]);
  });

  test("rotas diferentes com mesmo tamanho e ultimo ponto nao colidem", () => {
    const firstPath = makePath(3, 18);
    const secondPath = makePath(4, 18);
    secondPath[secondPath.length - 1] = {
      ...firstPath[firstPath.length - 1],
    };

    const first = buildSummaryRenderPath(firstPath);
    const second = buildSummaryRenderPath(secondPath);

    expect(second[0].longitude).toBe(secondPath[0].longitude);
    expect(second[0].longitude).not.toBe(first[0].longitude);
    expect(__getTrackingRenderPathCacheSizeForTests()).toBe(2);
  });

  test("rotas com mesmas amostras sentinela mas miolo diferente nao colidem", () => {
    const firstPath = makePath(5, 18);
    const secondPath = firstPath.map((point) => ({ ...point }));
    secondPath[3].longitude += 0.002;

    buildSummaryRenderPath(firstPath);
    buildSummaryRenderPath(secondPath);

    expect(__getTrackingRenderPathCacheSizeForTests()).toBe(2);
  });

  test("presets customizados distintos nao compartilham entrada", () => {
    const path = makePath(6, 24);

    buildLiveRenderPath(path, {
      preset: {
        liveSimplifyToleranceMeters: 0.5,
        liveSmoothingStrength: 0.05,
      },
    });
    buildLiveRenderPath(path, {
      preset: {
        liveSimplifyToleranceMeters: 12,
        liveSmoothingStrength: 0.6,
      },
    });

    expect(__getTrackingRenderPathCacheSizeForTests()).toBe(2);
  });

  test("copia profunda impede contaminacao de metadados do cache", () => {
    const path = makePath(9).map((point) => ({
      ...point,
      metadata: { quality: { score: 98 } },
    }));
    const equivalentPath = path.map((point) => ({
      ...point,
      metadata: { quality: { ...point.metadata.quality } },
    }));

    const first = buildSummaryRenderPath(path);
    first[0].metadata.quality.score = 1;
    const cached = buildSummaryRenderPath(equivalentPath);

    expect(cached[0].metadata.quality.score).toBe(98);
    expect(__getTrackingRenderPathCacheStatsForTests().hits).toBe(1);
  });

  test("valores nao canonicos ignoram o cache sem colidir nem lancar", () => {
    const timestamp = "2026-07-29T12:00:00.000Z";
    const withDate = makePath(10).map((point) => ({ ...point }));
    const withString = makePath(10).map((point) => ({ ...point }));
    const withBigInt = makePath(11).map((point) => ({ ...point }));
    withDate[0].timestamp = new Date(timestamp);
    withString[0].timestamp = timestamp;
    withBigInt[1].metadata = { id: 1n };

    const dateResult = buildLiveRenderPath(withDate);
    const stringResult = buildLiveRenderPath(withString);
    const bigIntResult = buildLiveRenderPath(withBigInt);

    expect(dateResult[0].timestamp).toBeInstanceOf(Date);
    expect(stringResult[0].timestamp).toBe(timestamp);
    expect(bigIntResult.length).toBeGreaterThan(1);
    expect(__getTrackingRenderPathCacheStatsForTests()).toMatchObject({
      bypasses: 2,
      misses: 1,
    });
  });
});
