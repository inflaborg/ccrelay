import { describe, expect, it, vi } from "vitest";
import type { Provider, RouterConfig } from "@/types";
import { ConfigManager } from "@/config";
import type { Router } from "@/server/router";
import { SmartRoutingStage } from "@/server/request/smartRoutingStage";
import type { RoutingContext } from "@/server/request/context";
import { ModelCatalog } from "@/server/smartRouting/modelCatalog";

function mockConfig(
  providers: Record<string, Provider>,
  smartRoutingExtra?: Partial<NonNullable<RouterConfig["smartRouting"]>>
): ConfigManager {
  const cfg: RouterConfig = {
    port: 7575,
    host: "127.0.0.1",
    autoStart: true,
    apiBearerToken: "test",
    defaultProvider: "auto",
    providers,
    routing: { forward: [], block: [] },
    logging: { storeBodies: false },
    smartRouting: {
      enabled: true,
      aliasPrefix: "claude-",
      modelsCache: { ttlSeconds: 600, refreshOnStart: false, onUpstreamFail: "stale" },
      bareModelFallback: { mode: "first-match" },
      ...smartRoutingExtra,
    },
  };

  return {
    configValue: cfg,
    providers,
    getProvider: (id: string) => providers[id],
    onConfigChanged: () => {},
  } as unknown as ConfigManager;
}

function makeRouting(overrides: Partial<RoutingContext>): RoutingContext {
  const defaultProvider: Provider = {
    id: "anthropic-upstream",
    name: "Anthropic",
    baseUrl: "https://anthropic.example.com",
    mode: "passthrough",
    providerType: "anthropic",
    apiKey: "client-token",
  };
  return {
    blocked: false,
    method: "POST",
    path: "/anthropic/v1/messages",
    provider: defaultProvider,
    clientHeaders: {
      authorization: "Bearer client-token",
      ["x-api-key"]: "client-key",
    },
    headers: {
      authorization: "Bearer client-token",
      ["x-api-key"]: "client-key",
    },
    targetUrl: "https://anthropic.example.com/v1/messages",
    targetPath: "/v1/messages",
    targetQuery: "?beta=true",
    isRouted: false,
    forwardRuleProvider: "auto",
    isOpenAIProvider: false,
    clientSurface: "anthropic",
    ...overrides,
  };
}

describe("SmartRoutingStage", () => {
  it("re-prepares inject headers and target URL when routing to another provider", async () => {
    const anthropicUpstreamId = "anthropic-upstream";
    const glmProviderId = "glm-intl-anthropic";
    const providers: Record<string, Provider> = {
      [anthropicUpstreamId]: {
        id: anthropicUpstreamId,
        name: "Anthropic",
        baseUrl: "https://anthropic.example.com",
        mode: "passthrough",
        providerType: "anthropic",
        enabled: true,
      },
      [glmProviderId]: {
        id: glmProviderId,
        name: "GLM Intl",
        baseUrl: "https://glm.example.com",
        mode: "inject",
        providerType: "anthropic",
        apiKey: "glm-inject-key",
        authHeader: "authorization",
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["glm-4.7"],
      },
    };

    const config = mockConfig(providers);
    const catalog = new ModelCatalog(config);
    await catalog.refreshAll();

    const prepareHeaders = vi.fn((clientHeaders: Record<string, string>, provider: Provider) => {
      const headers = { ...clientHeaders };
      if (provider.mode === "inject" && provider.apiKey) {
        delete headers.authorization;
        delete headers["x-api-key"];
        headers.authorization = `Bearer ${provider.apiKey}`;
      }
      return headers;
    });
    const getTargetUrl = vi.fn((path: string, provider: Provider) => `${provider.baseUrl}${path}`);
    const router = { prepareHeaders, getTargetUrl } as unknown as Router;

    const stage = new SmartRoutingStage(config, router, catalog);
    const routing = makeRouting({});
    const publicId = catalog.getAll()[0]?.publicId;
    expect(publicId).toBeDefined();
    const body = Buffer.from(JSON.stringify({ model: publicId }), "utf-8");

    const result = stage.process(routing, body);

    expect(result.routing.provider.id).toBe(glmProviderId);
    expect(prepareHeaders).toHaveBeenCalledWith(routing.clientHeaders, providers[glmProviderId]);
    expect(result.routing.headers.authorization).toBe("Bearer glm-inject-key");
    expect(result.routing.headers["x-api-key"]).toBeUndefined();
    expect(result.routing.targetUrl).toBe("https://glm.example.com/v1/messages?beta=true");
    expect(result.routing.smartRoutingClientModel).toBe(publicId);
    const parsedBody = JSON.parse(result.body.toString("utf-8")) as { model: string };
    expect(parsedBody.model).toBe("glm-4.7");
  });

  it("applies modelRules before catalog resolution", async () => {
    const anthropicUpstreamId = "anthropic-upstream";
    const glmProviderId = "glm-intl-anthropic";
    const providers: Record<string, Provider> = {
      [anthropicUpstreamId]: {
        id: anthropicUpstreamId,
        name: "Anthropic",
        baseUrl: "https://anthropic.example.com",
        mode: "passthrough",
        providerType: "anthropic",
        enabled: true,
      },
      [glmProviderId]: {
        id: glmProviderId,
        name: "GLM Intl",
        baseUrl: "https://glm.example.com",
        mode: "passthrough",
        providerType: "anthropic",
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["glm-4.7"],
      },
    };

    const config = mockConfig(providers);
    const catalog = new ModelCatalog(config);
    await catalog.refreshAll();
    const publicId = catalog.getAll()[0]?.publicId;
    expect(publicId).toBeDefined();
    if (!publicId) {
      return;
    }

    const configWithRule = mockConfig(providers, {
      modelRules: [
        {
          pattern: publicId,
          provider: anthropicUpstreamId,
          model: "custom-upstream-model",
        },
      ],
    });
    const getTargetUrl = vi.fn((path: string, provider: Provider) => `${provider.baseUrl}${path}`);
    const router = {
      prepareHeaders: (_c: Record<string, string>, p: Provider) => ({
        authorization: `Bearer ${p.id}`,
      }),
      getTargetUrl,
    } as unknown as Router;

    const stage = new SmartRoutingStage(configWithRule, router, catalog);
    const body = Buffer.from(JSON.stringify({ model: publicId }), "utf-8");
    const result = stage.process(makeRouting({}), body);

    expect(result.routing.provider.id).toBe(anthropicUpstreamId);
    const parsedBody = JSON.parse(result.body.toString("utf-8")) as { model: string };
    expect(parsedBody.model).toBe("custom-upstream-model");
  });

  it("rejects an excluded model instead of forwarding to the current provider", async () => {
    const currentId = "llm-router-su-gpt";
    const providers: Record<string, Provider> = {
      [currentId]: {
        id: currentId,
        name: "su",
        baseUrl: "https://su.example.com",
        mode: "inject",
        providerType: "openai",
        enabled: true,
        modelMappingEnabled: true,
        modelMap: [{ pattern: "gpt-5.6-luna", model: "gpt-5.6-luna" }],
        useCustomModelsList: true,
        customModelsList: ["gpt-5.6-luna"],
      },
    };
    const config = mockConfig(providers, { exclude: ["llm-router-su-gpt:gpt-5.6-luna"] });
    const catalog = new ModelCatalog(config);
    await catalog.refreshAll();
    const router = {
      prepareHeaders: () => ({ authorization: "Bearer su" }),
      getTargetUrl: (path: string, provider: Provider) => `${provider.baseUrl}${path}`,
    } as unknown as Router;
    const stage = new SmartRoutingStage(config, router, catalog);
    const routing = makeRouting({
      provider: providers[currentId],
      clientSurface: "openai_responses",
    });
    const body = Buffer.from(JSON.stringify({ model: "gpt-5.6-luna" }), "utf-8");

    const result = stage.process(routing, body);

    expect(result.rejected?.statusCode).toBe(404);
    expect(result.rejected?.body).toContain("excluded from smart routing");
    expect(result.routing.provider.id).toBe(currentId);
    const parsedBody = JSON.parse(result.body.toString("utf-8")) as { model: string };
    expect(parsedBody.model).toBe("gpt-5.6-luna");
  });

  it("rejects when the current provider model map would land on an excluded model", async () => {
    const currentId = "llm-router-su-gpt";
    const providers: Record<string, Provider> = {
      [currentId]: {
        id: currentId,
        name: "su",
        baseUrl: "https://su.example.com",
        mode: "inject",
        providerType: "openai",
        enabled: true,
        modelMappingEnabled: true,
        modelMap: [{ pattern: "claude-sonnet-*", model: "gpt-5.6-terra" }],
        useCustomModelsList: true,
        customModelsList: ["gpt-5.6-terra"],
      },
    };
    const config = mockConfig(providers, { exclude: ["llm-router-su-gpt:gpt-5.6-terra"] });
    const catalog = new ModelCatalog(config);
    await catalog.refreshAll();
    const router = {
      prepareHeaders: () => ({}),
      getTargetUrl: (path: string, provider: Provider) => `${provider.baseUrl}${path}`,
    } as unknown as Router;
    const stage = new SmartRoutingStage(config, router, catalog);
    const body = Buffer.from(JSON.stringify({ model: "claude-sonnet-5" }), "utf-8");

    const result = stage.process(makeRouting({ provider: providers[currentId] }), body);

    expect(result.rejected?.statusCode).toBe(404);
    expect(result.routing.provider.id).toBe(currentId);
  });

  it("skips a custom rule whose target is excluded", async () => {
    const suId = "llm-router-su-gpt";
    const devId = "llm-router-dev";
    const providers: Record<string, Provider> = {
      [suId]: {
        id: suId,
        name: "su",
        baseUrl: "https://su.example.com",
        mode: "inject",
        providerType: "openai",
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["gpt-5.6-luna"],
      },
      [devId]: {
        id: devId,
        name: "dev",
        baseUrl: "https://dev.example.com",
        mode: "inject",
        providerType: "openai",
        enabled: true,
        useCustomModelsList: true,
        customModelsList: ["gpt-5.6-terra"],
      },
    };
    const config = mockConfig(providers, {
      exclude: ["llm-router-su-gpt:gpt-5.6-luna"],
      modelRules: [
        { pattern: "claude-sonnet-*", provider: suId, model: "gpt-5.6-luna" },
        { pattern: "claude-sonnet-*", provider: devId, model: "gpt-5.6-terra" },
      ],
    });
    const catalog = new ModelCatalog(config);
    await catalog.refreshAll();
    const router = {
      prepareHeaders: (_c: Record<string, string>, p: Provider) => ({ authorization: p.id }),
      getTargetUrl: (path: string, provider: Provider) => `${provider.baseUrl}${path}`,
    } as unknown as Router;
    const stage = new SmartRoutingStage(config, router, catalog);
    const body = Buffer.from(JSON.stringify({ model: "claude-sonnet-5" }), "utf-8");

    const result = stage.process(makeRouting({ provider: providers[suId] }), body);

    expect(result.rejected).toBeUndefined();
    expect(result.routing.provider.id).toBe(devId);
    const parsedBody = JSON.parse(result.body.toString("utf-8")) as { model: string };
    expect(parsedBody.model).toBe("gpt-5.6-terra");
  });
});
