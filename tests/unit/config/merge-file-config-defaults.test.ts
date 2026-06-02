import { describe, it, expect } from "vitest";
import { getDefaultConfig } from "@/config/defaults";
import { mergeFileConfigWithDefaults, getDefaultRoutingSettings } from "@/config/index";
import { FileConfigSchema, type FileConfigInput } from "@/types";

describe("mergeFileConfigWithDefaults", () => {
  const mkDefaults = (): FileConfigInput => {
    const routing = getDefaultRoutingSettings();
    return FileConfigSchema.parse({
      configVersion: "0.2.5",
      server: { port: 7575, host: "127.0.0.1", autoStart: true },
      defaultProvider: "official",
      providers: {
        official: {
          name: "Official",
          baseUrl: "https://api.default.com",
          mode: "passthrough" as const,
        },
      },
      routing: {
        forward: routing.forward,
        block: routing.block,
      },
      concurrency: {
        enabled: true,
        maxWorkers: 3,
        routes: [
          {
            pattern: "/v1/messages/count_tokens",
            name: "count_tokens",
            maxWorkers: 30,
            maxQueueSize: 1000,
          },
          { pattern: "/default-only-route", name: "def", maxWorkers: 1 },
        ],
      },
    });
  };

  it("appends missing default forward paths after user forwards", () => {
    const defaults = mkDefaults();
    const merged = mergeFileConfigWithDefaults(defaults, {
      routing: {
        forward: [{ path: "/v1/messages", provider: "myid" }],
      },
    });

    expect(merged.routing?.forward?.[0]).toEqual({ path: "/v1/messages", provider: "myid" });
    const paths = (merged.routing?.forward ?? []).map(r => r.path);
    expect(paths).toContain("/v1/models");
    expect(paths.lastIndexOf("/v1/messages")).toBe(0);
  });

  it("keeps an explicit empty forward list without adding defaults", () => {
    const defaults = mkDefaults();
    const merged = mergeFileConfigWithDefaults(defaults, {
      routing: { forward: [], block: getDefaultRoutingSettings().block },
    });
    expect(merged.routing?.forward).toEqual([]);
  });

  it("fills block rules from defaults when user omits block", () => {
    const defaults = mkDefaults();
    const merged = mergeFileConfigWithDefaults(defaults, {
      routing: { forward: [{ path: "/custom", provider: "auto" }] },
    });

    expect(merged.routing?.block?.length).toBeGreaterThanOrEqual(
      defaults.routing?.block?.length ?? 0
    );
    expect((merged.routing?.block ?? []).map(b => b.path)).toContain("/api/event_logging/*");
  });

  it("merges concurrency routes by pattern; undefined routes inherits defaults", () => {
    const defaults = mkDefaults();
    const userOnly = mergeFileConfigWithDefaults(defaults, {
      concurrency: {
        enabled: true,
        maxWorkers: 5,
        routes: [{ pattern: "/only-user", maxWorkers: 2 }],
      },
    });
    expect(userOnly.concurrency?.routes?.some(r => r.pattern === "/only-user")).toBe(true);
    expect(userOnly.concurrency?.routes?.some(r => r.pattern === "/default-only-route")).toBe(true);
    expect(userOnly.concurrency?.maxWorkers).toBe(5);

    const inheritQueues = mergeFileConfigWithDefaults(defaults, {
      concurrency: {
        enabled: true,
        maxWorkers: 2,
      },
    });
    expect(inheritQueues.concurrency?.routes?.some(r => r.pattern === "/default-only-route")).toBe(
      true
    );
    expect(inheritQueues.concurrency?.maxWorkers).toBe(2);

    const explicitEmptyQueues = mergeFileConfigWithDefaults(defaults, {
      concurrency: {
        enabled: true,
        maxWorkers: 2,
        routes: [],
      },
    });
    expect(explicitEmptyQueues.concurrency?.routes).toEqual([]);
  });

  it("deep-merges an existing provider and keeps ids only present in defaults or user map", () => {
    const defaults = mkDefaults();
    const merged = mergeFileConfigWithDefaults(defaults, {
      providers: {
        official: {
          name: "Official",
          mode: "passthrough" as const,
          baseUrl: "https://api.default.com",
          modelMap: [{ pattern: "x", model: "y" }],
        },
        extra: {
          name: "Extra",
          baseUrl: "https://extra.example.com",
          mode: "inject" as const,
        },
      },
    });

    expect(merged.providers?.official?.baseUrl).toBe("https://api.default.com");
    expect(merged.providers?.official?.modelMap?.[0]).toEqual({ pattern: "x", model: "y" });
    expect(merged.providers?.extra?.name).toBe("Extra");
  });

  it("uses default requestTimeout 0 when user omits it", () => {
    const defaults = getDefaultConfig();
    const merged = mergeFileConfigWithDefaults(defaults, {
      concurrency: { enabled: true, maxWorkers: 3 },
    });
    expect(merged.concurrency?.requestTimeout).toBe(0);
  });

  it("deep-merges smartRouting from user config", () => {
    const defaults = mkDefaults();
    const merged = mergeFileConfigWithDefaults(defaults, {
      smartRouting: {
        enabled: true,
        exclude: ["official:*"],
      },
    });

    expect(merged.smartRouting?.enabled).toBe(true);
    expect(merged.smartRouting?.exclude).toEqual(["official:*"]);
  });
});
