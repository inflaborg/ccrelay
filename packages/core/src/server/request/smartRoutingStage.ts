import type { ApiSurface } from "../../types";
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

export interface SmartRoutingRejection {
  statusCode: number;
  body: string;
  model: string;
}

export interface SmartRoutingStageResult {
  routing: RoutingContext;
  body: Buffer;
  /** Set when the request targets an excluded model and must not be forwarded. */
  rejected?: SmartRoutingRejection;
}

function modelNotFoundResponse(
  model: string,
  message: string,
  surface: ApiSurface
): SmartRoutingRejection {
  if (surface === "anthropic") {
    return {
      statusCode: 404,
      model,
      body: JSON.stringify({
        type: "error",
        error: { type: "not_found_error", message },
      }),
    };
  }
  return {
    statusCode: 404,
    model,
    body: JSON.stringify({
      error: { message, type: "invalid_request_error", code: "model_not_found" },
    }),
  };
}

function missingModelResponse(surface: ApiSurface): SmartRoutingRejection {
  const message = "Smart routing needs a model in the request body";
  if (surface === "anthropic") {
    return {
      statusCode: 400,
      model: "",
      body: JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message },
      }),
    };
  }
  return {
    statusCode: 400,
    model: "",
    body: JSON.stringify({
      error: { message, type: "invalid_request_error", code: "missing_model" },
    }),
  };
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

  process(routing: RoutingContext, rawBody: Buffer): SmartRoutingStageResult {
    if (routing.blocked) {
      return { routing, body: rawBody };
    }
    // The router's placeholder has no upstream, so it must always be resolved here.
    const pending = routing.provider.id === SMART_ROUTING_VIRTUAL_PROVIDER.id;
    if (!pending && (!this.catalog.isEnabled() || routing.forwardRuleProvider !== "auto")) {
      return { routing, body: rawBody };
    }

    if (
      routing.method === "GET" &&
      (isModelsListUpstreamPath(routing.targetPath) ||
        isModelDetailUpstreamPath(routing.targetPath))
    ) {
      return { routing: withSmartRoutingModelsContext(routing), body: rawBody };
    }

    const model = readModelFromBody(rawBody)?.trim();
    if (!model) {
      log.warn(`[route] rejected ${routing.method} ${routing.path}: no model in request body`);
      return { routing, body: rawBody, rejected: missingModelResponse(routing.clientSurface) };
    }

    const modelRules = this.config.configValue.smartRouting?.modelRules;
    let excludedRuleBlocked = false;
    const customMatch = matchSmartRoutingModelRules(
      model,
      modelRules,
      id => this.config.getProvider(id),
      match => {
        if (this.catalog.isExcludedTarget(match.providerId, match.upstreamModelId)) {
          excludedRuleBlocked = true;
          return false;
        }
        return true;
      }
    );
    const catalogEntry = customMatch ? null : this.catalog.resolveModelWireId(model);
    const providerId = customMatch?.providerId ?? catalogEntry?.providerId;
    const upstreamModelId = customMatch?.upstreamModelId ?? catalogEntry?.upstreamModelId;

    if (!providerId || !upstreamModelId) {
      const excluded = this.catalog.isExcludedWireId(model) || excludedRuleBlocked;
      log.warn(`[route] rejected ${excluded ? "excluded" : "unknown"} model "${model}"`);
      return {
        routing,
        body: rawBody,
        rejected: modelNotFoundResponse(
          model,
          excluded
            ? `Model "${model}" is excluded from smart routing`
            : `Model "${model}" is not in the smart routing catalog`,
          routing.clientSurface
        ),
      };
    }

    const provider = this.config.getProvider(providerId);
    if (!provider) {
      log.warn(`[route] rejected model "${model}": provider "${providerId}" is not configured`);
      return {
        routing,
        body: rawBody,
        rejected: modelNotFoundResponse(
          model,
          `Model "${model}" routes to provider "${providerId}", which is not configured`,
          routing.clientSurface
        ),
      };
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
