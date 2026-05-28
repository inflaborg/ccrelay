import { describe, expect, it } from "vitest";
import type { Provider, RouterConfig } from "@/types";
import { ConfigManager } from "@/config";
import { ModelCatalog } from "@/server/smartRouting/modelCatalog";

function mockConfig(providers: Record<string, Provider>): ConfigManager {
  const cfg: RouterConfig = {
    port: 7575,
    host: "127.0.0.1",
    autoStart: true,
    apiBearerToken: "test",
    defaultProvider: "official",
    providers,
    routing: { forward: [], block: [] },
    logging: { enabled: false },
    smartRouting: {
      enabled: true,
      aliasPrefix: "claude-",
      modelsCache: { ttlSeconds: 600, refreshOnStart: false, onUpstreamFail: "stale" },
      bareModelFallback: { mode: "first-match" },
    },
  };

  const manager = {
    configValue: cfg,
    providers,
    getProvider: (id: string) => providers[id],
    onConfigChanged: () => {},
  } as unknown as ConfigManager;

  return manager;
}

describe("ModelCatalog", () => {
  it("aggregates custom models with public ids", async () => {
    const providers = {
      cn: {
        id: "cn",
        name: "CN",
        baseUrl: "https://cn.example.com",
        mode: "inject" as const,
        providerType: "anthropic" as const,
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["glm-5.1;GLM 5.1"],
      },
      global: {
        id: "global",
        name: "Global",
        baseUrl: "https://global.example.com",
        mode: "inject" as const,
        providerType: "anthropic" as const,
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["glm-5.1"],
      },
    };
    const catalog = new ModelCatalog(mockConfig(providers));
    await catalog.refreshAll();
    const all = catalog.getAll();
    expect(all.map(e => e.publicId).sort()).toEqual(["cn:glm-5.1", "global:glm-5.1"]);
    const cnEntry = all.find(e => e.providerId === "cn");
    expect(cnEntry?.displayName).toBe("GLM 5.1");
    expect(cnEntry?.providerDisplayName).toBe("CN");
  });

  it("resolves prefixed and bare model ids", async () => {
    const providers = {
      official: {
        id: "official",
        name: "Official",
        baseUrl: "https://api.anthropic.com",
        mode: "passthrough" as const,
        providerType: "anthropic" as const,
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["claude-sonnet-4-5"],
      },
      cn: {
        id: "cn",
        name: "CN",
        baseUrl: "https://cn.example.com",
        mode: "inject" as const,
        providerType: "anthropic" as const,
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["glm-5.1"],
      },
    };
    const catalog = new ModelCatalog(mockConfig(providers));
    await catalog.refreshAll();
    expect(catalog.resolveModelWireId("cn:glm-5.1")?.providerId).toBe("cn");
    expect(catalog.resolveModelWireId("glm-5.1")?.providerId).toBe("cn");
  });

  it("reports stats and clears provider errors for custom lists", async () => {
    const providers = {
      cn: {
        id: "cn",
        name: "CN",
        baseUrl: "https://cn.example.com",
        mode: "inject" as const,
        providerType: "anthropic" as const,
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["glm-5.1"],
      },
    };
    const catalog = new ModelCatalog(mockConfig(providers));
    await catalog.refreshAll();
    const stats = catalog.getStats();
    expect(stats.providerCount).toBe(1);
    expect(stats.modelCount).toBe(1);
    expect(catalog.getProviderErrors()).toEqual([]);
  });

  it("excludes official provider in passthrough mode from aggregation", async () => {
    const providers = {
      official: {
        id: "official",
        name: "Official",
        baseUrl: "https://api.anthropic.com",
        mode: "passthrough" as const,
        providerType: "anthropic" as const,
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["claude-sonnet-4-5"],
      },
      cn: {
        id: "cn",
        name: "CN",
        baseUrl: "https://cn.example.com",
        mode: "inject" as const,
        providerType: "anthropic" as const,
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["glm-5.1"],
      },
    };
    const catalog = new ModelCatalog(mockConfig(providers));
    await catalog.refreshAll();
    const all = catalog.getAll();
    expect(all.map(e => e.publicId)).toEqual(["cn:glm-5.1"]);
    expect(catalog.getStats().providerCount).toBe(1);
  });

  it("includes official provider when not in passthrough mode", async () => {
    const providers = {
      official: {
        id: "official",
        name: "Official",
        baseUrl: "https://api.anthropic.com",
        mode: "inject" as const,
        providerType: "anthropic" as const,
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["claude-sonnet-4-5"],
      },
    };
    const catalog = new ModelCatalog(mockConfig(providers));
    await catalog.refreshAll();
    expect(catalog.getAll().map(e => e.publicId)).toEqual(["official:claude-sonnet-4-5"]);
  });
});
