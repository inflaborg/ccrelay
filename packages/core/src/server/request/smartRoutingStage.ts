import type { ConfigManager } from "../../config";
import type { Router } from "../router";
import type { RoutingContext } from "./context";
import type { ModelCatalog } from "../smartRouting/modelCatalog";
import { matchSmartRoutingModelRules } from "../smartRouting/resolveModelRules";
import { SMART_ROUTING_VIRTUAL_PROVIDER } from "../smartRouting/virtualProvider";
import {
  isModelsListUpstreamPath,
  isModelDetailUpstreamPath,
} from "../../converter/models-fallback";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("SmartRoutingStage");

function readModelFromBody(rawBody: Buffer): string | undefined {
  if (!rawBody || rawBody.length === 0) {
    return undefined;
  }
  try {
    const data = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
    return typeof data.model === "string" ? data.model : undefined;
  } catch {
    return undefined;
  }
}

function rewriteBodyModel(rawBody: Buffer, upstreamModelId: string): Buffer {
  if (!rawBody || rawBody.length === 0) {
    return rawBody;
  }
  try {
    const data = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
    data.model = upstreamModelId;
    return Buffer.from(JSON.stringify(data), "utf-8");
  } catch {
    return rawBody;
  }
}

function withSmartRoutingModelsContext(routing: RoutingContext): RoutingContext {
  return {
    ...routing,
    provider: SMART_ROUTING_VIRTUAL_PROVIDER,
    targetUrl: "(smart-routing)",
    isRouted: false,
    isOpenAIProvider: false,
  };
}

export class SmartRoutingStage {
  constructor(
    private readonly config: ConfigManager,
    private readonly router: Router,
    private readonly catalog: ModelCatalog
  ) {}

  process(routing: RoutingContext, rawBody: Buffer): { routing: RoutingContext; body: Buffer } {
    if (!this.catalog.isEnabled() || routing.blocked) {
      return { routing, body: rawBody };
    }
    if (routing.forwardRuleProvider !== "auto") {
      return { routing, body: rawBody };
    }

    if (
      routing.method === "GET" &&
      (isModelsListUpstreamPath(routing.targetPath) ||
        isModelDetailUpstreamPath(routing.targetPath))
    ) {
      return { routing: withSmartRoutingModelsContext(routing), body: rawBody };
    }

    const model = readModelFromBody(rawBody);
    if (!model) {
      return { routing, body: rawBody };
    }

    const modelRules = this.config.configValue.smartRouting?.modelRules;
    const customMatch = matchSmartRoutingModelRules(model, modelRules, id =>
      this.config.getProvider(id)
    );
    const catalogEntry = customMatch ? null : this.catalog.resolveModelWireId(model);
    const providerId = customMatch?.providerId ?? catalogEntry?.providerId;
    const upstreamModelId = customMatch?.upstreamModelId ?? catalogEntry?.upstreamModelId;

    if (!providerId || !upstreamModelId) {
      log.warn(`[route] unresolved model "${model}"`);
      return { routing, body: rawBody };
    }

    const provider = this.config.getProvider(providerId);
    if (!provider) {
      return { routing, body: rawBody };
    }

    const routeSource = customMatch ? "custom-rule" : "catalog";

    routing.smartRoutingClientModel = model;
    routing.provider = provider;
    routing.isOpenAIProvider = provider.providerType !== "anthropic";
    routing.headers = this.router.prepareHeaders(routing.clientHeaders, provider);
    routing.targetUrl = this.router.getTargetUrl(routing.targetPath, provider);
    if (routing.targetQuery) {
      routing.targetUrl += routing.targetQuery;
    }
    const nextBody = rewriteBodyModel(rawBody, upstreamModelId);

    log.info(
      `[route] model="${model}" -> provider=${provider.id} upstreamModel=${upstreamModelId} (${routeSource})`
    );

    return { routing, body: nextBody };
  }
}

export function smartRoutingModelErrorBody(message: string): string {
  return JSON.stringify({
    type: "error",
    error: { type: "invalid_request_error", message },
  });
}
