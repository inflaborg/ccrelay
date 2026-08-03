import { describe, expect, it } from "vitest";
import {
  cacheHitRatePercent,
  emptyProviderDetailStats,
  mapProviderDailyStatRow,
  mapProviderModelStatRow,
} from "@/database/shared-utils";
import { UNKNOWN_MODEL_LABEL } from "@/database/types";

describe("provider detail mapping helpers", () => {
  it("computes cache hit rate from input and cache tokens", () => {
    expect(cacheHitRatePercent(100, 40)).toBe(40);
    expect(cacheHitRatePercent(0, 10)).toBe(0);
  });

  it("maps empty model to unknown sentinel", () => {
    const row = mapProviderModelStatRow({
      model: "  ",
      count: 3,
      totalInputTokens: 100,
      totalOutputTokens: 20,
      totalCacheTokens: 25,
    });
    expect(row.model).toBe(UNKNOWN_MODEL_LABEL);
    expect(row.cacheHitRate).toBe(25);
  });

  it("preserves model name and daily day string", () => {
    expect(
      mapProviderModelStatRow({
        model: "gpt-4o",
        count: 1,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalCacheTokens: 0,
      }).model
    ).toBe("gpt-4o");
    expect(
      mapProviderDailyStatRow({
        day: "2026-08-02",
        count: 2,
        totalInputTokens: 1,
        totalOutputTokens: 2,
        totalCacheTokens: 3,
      }).day
    ).toBe("2026-08-02");
  });

  it("builds empty provider detail stats", () => {
    const empty = emptyProviderDetailStats("p1", "Provider One");
    expect(empty.providerId).toBe("p1");
    expect(empty.providerName).toBe("Provider One");
    expect(empty.count).toBe(0);
    expect(empty.modelBreakdown).toEqual([]);
    expect(empty.dailyBreakdown).toEqual([]);
  });
});
