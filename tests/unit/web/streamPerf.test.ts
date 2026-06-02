import { describe, expect, it } from "vitest";
import {
  hasStreamPerfMetrics,
  hasStreamTtfb,
  outputTps,
} from "../../../web/src/features/logs/streamPerf";

describe("hasStreamTtfb", () => {
  it("returns false when ttfb is missing", () => {
    expect(hasStreamTtfb({ duration: 5000 })).toBe(false);
  });

  it("returns false when duration equals ttfb (no generation phase)", () => {
    expect(hasStreamTtfb({ ttfb: 5000, duration: 5000 })).toBe(false);
  });

  it("returns true for fast streams with short generation phase", () => {
    expect(hasStreamTtfb({ ttfb: 200, duration: 600 })).toBe(true);
  });

  it("returns true when generation phase exceeds stats threshold", () => {
    expect(hasStreamTtfb({ ttfb: 200, duration: 800 })).toBe(true);
  });
});

describe("hasStreamPerfMetrics", () => {
  it("matches hasStreamTtfb", () => {
    expect(hasStreamPerfMetrics({ ttfb: 200, duration: 600 })).toBe(true);
    expect(hasStreamPerfMetrics({ duration: 5000 })).toBe(false);
  });
});

describe("outputTps", () => {
  it("returns null without stream ttfb", () => {
    expect(outputTps({ duration: 3100, outputTokens: 100 })).toBeNull();
  });

  it("computes TPS for fast streams with floor at 1s gen time", () => {
    const tps = outputTps({ ttfb: 200, duration: 600, outputTokens: 50 });
    expect(tps).toBe(50);
  });

  it("uses actual gen time when above 1s", () => {
    const tps = outputTps({ ttfb: 200, duration: 3200, outputTokens: 1000 });
    expect(tps).toBeCloseTo(1000 / 3, 5);
  });
});
