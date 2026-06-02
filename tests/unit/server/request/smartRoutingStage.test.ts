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
    logging: { enabled: false },
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
});
