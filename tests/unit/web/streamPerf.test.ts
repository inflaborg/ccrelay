import { describe, expect, it } from "vitest";
import {
  effectiveGenMs,
  effectiveTtfb,
  hasStreamPerfMetrics,
  hasStreamTtfb,
  outputTps,
} from "../../../web/src/features/logs/streamPerf";

describe("effectiveTtfb", () => {
  it("prefers upstreamTtfbMs over legacy ttfb", () => {
    expect(effectiveTtfb({ upstreamTtfbMs: 300, ttfb: 500, duration: 1000 })).toBe(300);
  });
});

describe("effectiveGenMs", () => {
  it("prefers genMs over duration - ttfb", () => {
    expect(effectiveGenMs({ genMs: 1500, ttfb: 200, duration: 600 })).toBe(1500);
  });
});

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

  it("uses phase timing fields when present", () => {
    const tps = outputTps({
      upstreamTtfbMs: 400,
      genMs: 2000,
      duration: 2400,
      outputTokens: 200,
    });
    expect(tps).toBe(100);
  });
});
