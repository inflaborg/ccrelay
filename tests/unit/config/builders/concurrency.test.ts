import { describe, expect, it } from "vitest";
import { buildConcurrencyConfig, buildRouteQueues } from "@/config/builders/concurrency";

describe("buildConcurrencyConfig", () => {
  it("returns undefined when concurrency is missing", () => {
    expect(buildConcurrencyConfig(undefined)).toBeUndefined();
  });

  it("returns undefined when concurrency.enabled is false", () => {
    expect(buildConcurrencyConfig({ enabled: false, maxWorkers: 3 })).toBeUndefined();
  });

  it("builds enabled config with default retry429 when omitted", () => {
    const c = buildConcurrencyConfig({ enabled: true, maxWorkers: 5 });
    expect(c).toEqual({
      enabled: true,
      maxWorkers: 5,
      maxQueueSize: undefined,
      requestTimeout: undefined,
      retry429: { enabled: false, maxRetries: 3, delayMs: 1000 },
    });
  });

  it("honors explicit retry429", () => {
    const c = buildConcurrencyConfig({
      enabled: true,
      maxWorkers: 3,
      retry429: { enabled: true, maxRetries: 2, delayMs: 500 },
    });
    expect(c?.retry429).toEqual({ enabled: true, maxRetries: 2, delayMs: 500 });
  });
});

describe("buildRouteQueues", () => {
  it("returns undefined for empty routes", () => {
    expect(buildRouteQueues(undefined)).toBeUndefined();
    expect(buildRouteQueues([])).toBeUndefined();
  });

  it("compiles regex patterns", () => {
    const q = buildRouteQueues([{ pattern: "^/v1/messages$", maxWorkers: 2, name: "m" }]);
    expect(q).toHaveLength(1);
    expect(q![0].compiledPattern?.test("/v1/messages")).toBe(true);
    expect(q![0].maxWorkers).toBe(2);
    expect(q![0].name).toBe("m");
  });

  it("uses /^$/ for invalid regex", () => {
    const q = buildRouteQueues([{ pattern: "(unclosed", maxWorkers: 1 }]);
    expect(q![0].compiledPattern?.source).toBe("^$");
  });
});
