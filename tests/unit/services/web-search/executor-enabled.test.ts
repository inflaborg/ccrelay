import { describe, expect, it } from "vitest";
import { isWebSearchFeatureEnabled } from "@/services/web-search/executor";

describe("isWebSearchFeatureEnabled", () => {
  it("returns false when config is undefined", () => {
    expect(isWebSearchFeatureEnabled(undefined)).toBe(false);
  });

  it("returns false when enabled is explicitly false", () => {
    expect(
      isWebSearchFeatureEnabled({
        enabled: false,
        providers: ["a"],
      })
    ).toBe(false);
  });

  it("returns true when enabled is explicitly true", () => {
    expect(
      isWebSearchFeatureEnabled({
        enabled: true,
        providers: [],
      })
    ).toBe(true);
  });

  it("legacy: enabled when providers list is non-empty and enabled omitted", () => {
    expect(isWebSearchFeatureEnabled({ providers: ["p1"] })).toBe(true);
    expect(isWebSearchFeatureEnabled({ providers: [] })).toBe(false);
  });
});
