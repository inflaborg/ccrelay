/**
 * Body Processor Stage - handles request body transformation
 */

import type { RoutingContext, BodyProcessResult } from "./context";
import { applyModelMapping } from "./modelMapping";
import {
  convertRequestToOpenAI,
  convertOpenAIRequestToAnthropic,
  convertResponsesRequestToChatCompletions,
  extractResponsesEcho,
  isOpenAIChatCompletionsRequest,
  isOpenAIResponsesRequest,
  resolveOpenAICompatForAnthropicToOpenAI,
  mapAnthropicWirePathToOpenAiUpstream,
  mapOpenAiWirePathToAnthropicUpstream,
  type ResponsesRequestEcho,
} from "../../converter";
import { ScopedLogger } from "../../utils/logger";
import type { ApiSurface } from "../../types";

const log = new ScopedLogger("BodyProcessor");

function extractClientWireModel(rawBody: Buffer): string | undefined {
  if (!rawBody || rawBody.length === 0) {
    return undefined;
  }
  try {
    const d = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
    return typeof d.model === "string" ? d.model : undefined;
  } catch {
    return undefined;
  }
}

function buildTargetUrl(baseUrl: string, path: string, query: string): string {
  const b = baseUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}${query}`;
}

function applyCrossProtocolUpstreamPath(
  routing: RoutingContext,
  clientSurface: ApiSurface,
  upstreamWire: ApiSurface,
  needsConversion: boolean
): void {
  if (!needsConversion) {
    return;
  }
  let next = routing.targetPath;
  if (clientSurface === "anthropic" && upstreamWire === "openai") {
    next = mapAnthropicWirePathToOpenAiUpstream(routing.targetPath, routing.method);
  } else if (clientSurface === "openai" && upstreamWire === "anthropic") {
    next = mapOpenAiWirePathToAnthropicUpstream(routing.targetPath, routing.method);
  }
  if (next !== routing.targetPath) {
    routing.targetPath = next;
    routing.targetUrl = buildTargetUrl(routing.provider.baseUrl, next, routing.targetQuery);
    log.info(
      `[CrossProtocolPath] ${routing.path} (${String(clientSurface)}->${String(upstreamWire)}) upstream path=${next} target="${routing.targetUrl}"`
    );
  }
}

/**
 * Cross-protocol: streaming is not supported in the first version — force non-streaming upstream.
 */
function forceDisableStreamInBody(body: Buffer, label: string): Buffer {
  if (!body || body.length === 0) {
    return body;
  }
  try {
    const data = JSON.parse(body.toString("utf-8")) as Record<string, unknown>;
    if (data.stream === true || data.stream === "true") {
      data.stream = false;
      log.info(
        `[${label}] stream=true is not supported for cross-protocol conversion; forcing stream=false`
      );
      return Buffer.from(JSON.stringify(data), "utf-8");
    }
  } catch {
    // ignore
  }
  return body;
}

/**
 * BodyProcessor maps models and applies Anthropic<->OpenAI conversion when client and upstream protocols differ
 */
export class BodyProcessor {
  /**
   * Process request body
   */
  process(rawBody: Buffer, routing: RoutingContext, databaseEnabled: boolean): BodyProcessResult {
    let originalRequestBody: string | undefined;
    let requestBodyLog: string | undefined;

    if (databaseEnabled && rawBody.length > 0) {
      try {
        originalRequestBody = rawBody.toString("utf-8");
      } catch {
        originalRequestBody = undefined;
      }
    }

    const clientSurface: ApiSurface = routing.clientSurface;
    const pt = routing.provider.providerType;
    const upstreamWire: ApiSurface = pt === "anthropic" ? "anthropic" : "openai";
    const needsConversion =
      pt === "anthropic"
        ? clientSurface !== "anthropic"
        : pt === "openai_chat"
          ? clientSurface !== "openai"
          : clientSurface !== "openai" && clientSurface !== "openai_responses";

    applyCrossProtocolUpstreamPath(routing, clientSurface, upstreamWire, needsConversion);

    // GET or no body: no JSON conversion; upstream path already aligned when needsConversion
    if (routing.method === "GET" || !rawBody || rawBody.length === 0) {
      const body = rawBody && rawBody.length > 0 ? rawBody : Buffer.alloc(0);
      if (databaseEnabled && body.length > 0) {
        try {
          requestBodyLog = body.toString("utf-8");
        } catch {
          requestBodyLog = undefined;
        }
      }
      return {
        body,
        originalModel: undefined,
        originalRequestBody,
        requestBodyLog,
      };
    }

    const clientWireModel = extractClientWireModel(rawBody);
    let body = applyModelMapping(rawBody, routing.provider);

    let responsesStreamRequested = false;
    let streamRequested = false;
    let originalResponsesEcho: ResponsesRequestEcho | undefined;

    if (
      needsConversion &&
      (clientSurface === "openai_responses" || clientSurface === "openai") &&
      body.length > 0
    ) {
      try {
        const d = JSON.parse(body.toString("utf-8")) as Record<string, unknown>;
        if (d.stream === true) {
          if (clientSurface === "openai_responses") {
            responsesStreamRequested = true;
          } else {
            streamRequested = true;
          }
        }
      } catch {
        // ignore
      }
    }

    if (needsConversion) {
      // Responses→Chat and OpenAI-surfaces→Anthropic streaming: keep stream=true upstream.
      const skipDisableStream =
        (clientSurface === "openai_responses" && upstreamWire === "openai") ||
        ((clientSurface === "openai" || clientSurface === "openai_responses") &&
          upstreamWire === "anthropic");
      if (!skipDisableStream) {
        body = forceDisableStreamInBody(body, `${clientSurface}->${upstreamWire}`);
      }
    }

    if (!needsConversion) {
      // Same protocol: pass through (only modelMap changes were applied)
    } else if (clientSurface === "openai_responses" && upstreamWire === "openai") {
      const result = this.convertResponsesToChatCompletionsOnly(body, routing);
      if (result) {
        body = result.body;
        originalResponsesEcho = result.originalResponsesEcho;
        routing.targetPath = result.newPath;
        routing.targetUrl = buildTargetUrl(
          routing.provider.baseUrl,
          result.newPath,
          routing.targetQuery
        );
        log.info(
          `[Router] Resp->Chat: path ${routing.path} -> ${result.newPath}, target="${routing.targetUrl}"`
        );
      }
    } else if (clientSurface === "openai_responses" && upstreamWire === "anthropic") {
      const result = this.convertResponsesToAnthropicChain(body, routing);
      if (result) {
        body = result.body;
        originalResponsesEcho = result.originalResponsesEcho;
        routing.targetPath = result.newPath;
        routing.targetUrl = buildTargetUrl(
          routing.provider.baseUrl,
          result.newPath,
          routing.targetQuery
        );
        log.info(
          `[Router] Resp->Chat->A: path ${routing.path} -> ${result.newPath}, target="${routing.targetUrl}"`
        );
      }
    } else if (clientSurface === "anthropic" && upstreamWire === "openai") {
      const result = this.convertAnthropicToOpenAIRequest(body, routing);
      if (result) {
        body = result.body;
        routing.targetPath = result.newPath;
        routing.targetUrl = buildTargetUrl(
          routing.provider.baseUrl,
          result.newPath,
          routing.targetQuery
        );
        log.info(
          `[Router] A->O request: path ${routing.path} -> ${result.newPath}, target="${routing.targetUrl}"`
        );
      }
    } else if (clientSurface === "openai" && upstreamWire === "anthropic") {
      const result = this.convertOpenAIToAnthropicRequest(body, routing);
      if (result) {
        body = result.body;
        routing.targetPath = result.newPath;
        routing.targetUrl = buildTargetUrl(
          routing.provider.baseUrl,
          result.newPath,
          routing.targetQuery
        );
        log.info(
          `[Router] O->A request: path ${routing.path} -> ${result.newPath}, target="${routing.targetUrl}"`
        );
      }
    }

    if (databaseEnabled && body && body.length > 0) {
      try {
        requestBodyLog = body.toString("utf-8");
      } catch {
        requestBodyLog = undefined;
      }
    }

    return {
      body,
      originalModel: clientWireModel,
      originalRequestBody,
      requestBodyLog,
      ...(responsesStreamRequested ? { responsesStreamRequested: true } : {}),
      ...(streamRequested ? { streamRequested: true } : {}),
      ...(originalResponsesEcho !== undefined ? { originalResponsesEcho } : {}),
    };
  }

  private convertAnthropicToOpenAIRequest(
    body: Buffer,
    routing: RoutingContext
  ): { body: Buffer; newPath: string } | null {
    try {
      const bodyStr = body.toString("utf-8");
      const anthropicRequest = JSON.parse(bodyStr) as Record<string, unknown>;
      if (!anthropicRequest.messages || !Array.isArray(anthropicRequest.messages)) {
        return null;
      }
      const openaiCompat = resolveOpenAICompatForAnthropicToOpenAI(routing.provider);
      const conversionResult = convertRequestToOpenAI(
        anthropicRequest as unknown as Parameters<typeof convertRequestToOpenAI>[0],
        routing.targetPath,
        { openaiCompat, providerBaseUrl: routing.provider.baseUrl }
      );
      return {
        body: Buffer.from(JSON.stringify(conversionResult.request), "utf-8"),
        newPath: conversionResult.newPath,
      };
    } catch (err) {
      log.error("[A->O Conversion] Failed to convert request", err);
      return null;
    }
  }

  private convertResponsesToChatCompletionsOnly(
    body: Buffer,
    routing: RoutingContext
  ): {
    body: Buffer;
    newPath: string;
    originalResponsesEcho: ResponsesRequestEcho;
  } | null {
    try {
      const bodyStr = body.toString("utf-8");
      const raw = JSON.parse(bodyStr) as Record<string, unknown>;
      if (!isOpenAIResponsesRequest(raw)) {
        return null;
      }
      const originalResponsesEcho = extractResponsesEcho(raw);
      const c = convertResponsesRequestToChatCompletions(raw, routing.targetPath, {
        providerBaseUrl: routing.provider.baseUrl,
      });
      return {
        body: Buffer.from(JSON.stringify(c.request), "utf-8"),
        newPath: c.newPath,
        originalResponsesEcho,
      };
    } catch (err) {
      log.error("[Resp->Chat] Failed to convert request", err);
      return null;
    }
  }

  private convertResponsesToAnthropicChain(
    body: Buffer,
    routing: RoutingContext
  ): {
    body: Buffer;
    newPath: string;
    originalResponsesEcho: ResponsesRequestEcho;
  } | null {
    try {
      const bodyStr = body.toString("utf-8");
      const raw = JSON.parse(bodyStr) as Record<string, unknown>;
      if (!isOpenAIResponsesRequest(raw)) {
        return null;
      }
      const originalResponsesEcho = extractResponsesEcho(raw);
      const chat = convertResponsesRequestToChatCompletions(raw, routing.path, {
        providerBaseUrl: routing.provider.baseUrl,
      });
      const c = convertOpenAIRequestToAnthropic(chat.request, chat.newPath);
      return {
        body: Buffer.from(JSON.stringify(c.request), "utf-8"),
        newPath: c.newPath,
        originalResponsesEcho,
      };
    } catch (err) {
      log.error("[Resp->Chat->A] Failed to convert request", err);
      return null;
    }
  }

  private convertOpenAIToAnthropicRequest(
    body: Buffer,
    routing: RoutingContext
  ): { body: Buffer; newPath: string } | null {
    try {
      const bodyStr = body.toString("utf-8");
      const oai = JSON.parse(bodyStr) as Record<string, unknown>;
      if (!isOpenAIChatCompletionsRequest(oai)) {
        return null;
      }
      const c = convertOpenAIRequestToAnthropic(
        oai as unknown as Parameters<typeof convertOpenAIRequestToAnthropic>[0],
        routing.targetPath
      );
      return {
        body: Buffer.from(JSON.stringify(c.request), "utf-8"),
        newPath: c.newPath,
      };
    } catch (err) {
      log.error("[O->A Conversion] Failed to convert request", err);
      return null;
    }
  }
}
