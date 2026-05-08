/**
 * Proxy executor - handles the actual HTTP request execution
 */

/* eslint-disable @typescript-eslint/naming-convention */
// HTTP headers use hyphenated names (Content-Type, etc.)

import * as http from "http";
import * as https from "https";
import * as url from "url";
import { ScopedLogger } from "../../utils/logger";
import { providerHasConfigurableModelMap } from "../../utils/model-map";
import {
  convertAnthropicResponseToOpenAI,
  convertChatCompletionToResponses,
  formatOpenAIResponsesSse,
  formatOpenAIChatCompletionsSse,
  convertResponseToAnthropic,
  convertOpenAIModelsToAnthropic,
  convertAnthropicModelsToOpenAI,
  isAnthropicModelsListJson,
  isModelsListUpstreamPath,
  isOpenAIModelsListJson,
  synthesizeCustomModelsListBody,
  isOpenAIType,
  createStreamingState,
  processStreamingChunk,
  createSseLineBuffer,
  isAnthropicMessageResponse,
  createAnthropicToOpenAISseState,
  createAnthropicSseEnvelopeBuffer,
  processAnthropicStreamEnvelope,
  flushAnthropicToOpenAISseFinal,
  type OpenAIChatCompletionResponse,
} from "../../converter";
import { applyPlatformResponseTransforms } from "../../converter/platform-transforms";
import type { ApiSurface } from "../../types";
import type { RequestTask, ProxyResult } from "../../types";
import type { ResponseLogger } from "../responseLogger";

const log = new ScopedLogger("ProxyExecutor");

/** Replace Content-Type and drop hop-by-hop / body-size headers for synthesized Responses API SSE. */
function headersForResponsesSse(
  base: Record<string, string | string[]>
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
  };
  for (const [k, v] of Object.entries(base)) {
    const kl = k.toLowerCase();
    if (
      kl === "content-type" ||
      kl === "content-length" ||
      kl === "content-encoding" ||
      kl === "transfer-encoding" ||
      kl === "cache-control"
    ) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

// Headers to exclude when forwarding response
const EXCLUDED_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

// Retryable error codes
const RETRYABLE_CODES = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"];

/**
 * Context for tracking request execution state
 */
interface ExecutionContext {
  startTime: number;
  requestSentTime: number;
  firstByteTime: number;
  streamChunkCount: number;
  streamTotalBytes: number;
  firstChunkLogged: boolean;
  responseChunks: Buffer[];
  originalResponseBody?: string;
  clientDisconnected: boolean;
  /** Chat->Responses SSE handler finished writing normally */
  streamCompleted?: boolean;
}

/**
 * Proxy executor handles executing HTTP requests to upstream providers
 */
export class ProxyExecutor {
  private executeFn: ((task: RequestTask) => Promise<ProxyResult>) | null = null;

  constructor(private responseLogger: ResponseLogger) {}

  /**
   * Set the execute function (for retry support, called after full initialization)
   */
  setExecuteFn(fn: (task: RequestTask) => Promise<ProxyResult>): void {
    this.executeFn = fn;
  }

  /**
   * Execute a proxy request and return the result
   */
  async execute(task: RequestTask): Promise<ProxyResult> {
    const {
      method,
      targetUrl,
      headers: taskHeaders,
      body,
      provider,
      clientId,
      attempt = 1,
      res: clientRes,
    } = task;

    // Check if task was cancelled before starting
    if (task.cancelled) {
      log.info(`[${clientId}] Task cancelled before execution: ${task.cancelledReason}`);
      return {
        statusCode: 499,
        headers: {},
        error: new Error(task.cancelledReason ?? "Task cancelled"),
        errorMessage: task.cancelledReason ?? "Task cancelled",
        duration: 0,
      };
    }

    // Check if client connection is still alive
    if (clientRes && clientRes.writableEnded) {
      log.info(`[${clientId}] Client connection already closed, skipping execution`);
      return {
        statusCode: 499,
        headers: {},
        error: new Error("Client disconnected"),
        errorMessage: "Client disconnected",
        duration: 0,
      };
    }

    if (
      provider.useCustomModelsList &&
      method === "GET" &&
      isModelsListUpstreamPath(task.requestPath)
    ) {
      const synthStart = Date.now();
      const ids = provider.customModelsList ?? [];
      const body = synthesizeCustomModelsListBody({
        clientSurface: task.clientSurface,
        fullModelIds: ids,
        targetUrl,
        provider,
      });
      const chunks = [Buffer.from(body, "utf-8")];
      const duration = Date.now() - synthStart;
      log.info(
        `[${clientId}] GET /models: useCustomModelsList for ${provider.id}, models=${ids.length}`
      );
      this.responseLogger.logResponse(
        clientId,
        duration,
        200,
        chunks,
        undefined,
        undefined,
        undefined
      );
      return Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body,
        duration,
        responseBodyChunks: chunks,
      });
    }

    const maxRetries = 2;
    const urlParsed = url.parse(targetUrl);
    const isHttps = urlParsed.protocol === "https:";
    const httpModule = isHttps ? https : http;

    // Disable compression to avoid gzip response issues when logging to database
    const requestHeaders: Record<string, string> = { ...taskHeaders };
    requestHeaders["accept-encoding"] = "identity";

    // Use task's abortController if provided by ConcurrencyManager (queue mode),
    // otherwise create a local AbortController (non-queue mode)
    const abortController = task.abortController ?? new AbortController();
    const abortSignal = abortController.signal;

    const options: http.RequestOptions = {
      hostname: urlParsed.hostname,
      port: urlParsed.port || (isHttps ? 443 : 80),
      path: urlParsed.path,
      method,
      headers: requestHeaders,
      signal: abortSignal,
    };

    const ctx: ExecutionContext = {
      startTime: Date.now(),
      requestSentTime: 0,
      firstByteTime: 0,
      streamChunkCount: 0,
      streamTotalBytes: 0,
      firstChunkLogged: false,
      responseChunks: [],
      originalResponseBody: undefined,
      clientDisconnected: false,
    };

    // Track client disconnect during streaming
    const onClientDisconnect = () => {
      ctx.clientDisconnected = true;
      log.info(`[${clientId}] Client disconnected during streaming`);
      abortController.abort();
    };

    if (clientRes) {
      clientRes.on("close", onClientDisconnect);
    }

    log.info(`[Perf:${clientId}] ExecuteRequestStart: starting upstream request to ${provider.id}`);
    log.info(
      `[${clientId}] UpstreamTarget: ${method} inbound=${task.inboundPath} requestPath=${task.requestPath} url=${targetUrl}`
    );

    return new Promise<ProxyResult>((resolve, reject) => {
      const proxyReq = httpModule.request(options, proxyRes => {
        this.handleResponse(
          proxyRes,
          task,
          ctx,
          options,
          onClientDisconnect,
          abortController,
          abortSignal,
          attempt,
          maxRetries,
          resolve,
          reject
        );
      });

      this.setupErrorHandlers(
        proxyReq,
        task,
        ctx,
        onClientDisconnect,
        abortController,
        abortSignal,
        attempt,
        maxRetries,
        resolve,
        reject
      );

      // Explicitly disable upstream socket idle-timeout. Some runtimes (e.g. Electron)
      // inherit a ~5s default; LLM upstream TTFB can exceed that. Rely on client disconnect + abortSignal.
      proxyReq.setTimeout(0);

      if (body) {
        proxyReq.write(body);
        log.info(`[Perf:${clientId}] RequestBodySent: ${body.length} bytes to upstream`);
      }

      proxyReq.end();
      ctx.requestSentTime = Date.now();
      log.info(
        `[Perf:${clientId}] RequestSent: setup time ${ctx.requestSentTime - ctx.startTime}ms, waiting for upstream...`
      );
    });
  }

  /**
   * Handle upstream response
   */
  private handleResponse(
    proxyRes: http.IncomingMessage,
    task: RequestTask,
    ctx: ExecutionContext,
    _options: http.RequestOptions,
    onClientDisconnect: () => void,
    _abortController: AbortController,
    _abortSignal: AbortSignal,
    _attempt: number,
    _maxRetries: number,
    resolve: (value: ProxyResult) => void,
    _reject: (reason: unknown) => void
  ): void {
    const { clientId, provider, originalModel, res: clientRes, clientSurface } = task;
    const pt = provider.providerType;
    const upstreamWire: ApiSurface = pt === "anthropic" ? "anthropic" : "openai";
    const needsResponseConversion =
      pt === "anthropic"
        ? clientSurface !== "anthropic"
        : pt === "openai_chat"
          ? clientSurface !== "openai"
          : clientSurface !== "openai" && clientSurface !== "openai_responses";

    const ttfb = Date.now() - ctx.requestSentTime;
    const duration = Date.now() - ctx.startTime;
    const status = proxyRes.statusCode || 200;
    ctx.firstByteTime = Date.now();

    log.info(
      `[Perf:${clientId}] TTFB: ${ttfb}ms (upstream response headers, total elapsed: ${duration}ms)`
    );

    // Log response
    if (status >= 400) {
      log.warn(`Response from ${provider.id}: ${status} (${duration}ms)`);
    } else {
      log.debug(`Response from ${provider.id}: ${status} (${duration}ms)`);
    }

    // Collect response headers
    const responseHeaders: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (value && !EXCLUDED_HEADERS.has(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    }

    const isJsonResponse = proxyRes.headers["content-type"]?.includes("application/json");

    /** Do not route through chat completion / Responses JSON converters — use buffered handlers + GET /models list conversion. */
    const skipStructuredChatJsonConverters =
      task.method === "GET" && isModelsListUpstreamPath(task.requestPath);

    if (
      !skipStructuredChatJsonConverters &&
      clientSurface === "openai_responses" &&
      upstreamWire === "openai" &&
      status === 200 &&
      isJsonResponse
    ) {
      this.handleOpenAIChatJsonToResponsesForClient(
        proxyRes,
        task,
        ctx,
        onClientDisconnect,
        status,
        responseHeaders,
        originalModel,
        resolve
      );
      return;
    }

    // Responses→Chat true SSE streaming: upstream returned SSE with stream=true
    const isSSEResponseEarly = proxyRes.headers["content-type"]?.includes("text/event-stream");
    if (
      clientSurface === "openai_responses" &&
      upstreamWire === "openai" &&
      status === 200 &&
      isSSEResponseEarly &&
      task.responsesStreamRequested &&
      clientRes
    ) {
      this.handleOpenAISseToResponsesSse(
        proxyRes,
        task,
        ctx,
        onClientDisconnect,
        status,
        responseHeaders,
        originalModel,
        resolve
      );
      return;
    }

    if (
      !skipStructuredChatJsonConverters &&
      clientSurface === "openai_responses" &&
      upstreamWire === "anthropic" &&
      status === 200 &&
      isJsonResponse
    ) {
      this.handleAnthropicJsonToOpenAIResponsesForClient(
        proxyRes,
        task,
        ctx,
        onClientDisconnect,
        status,
        responseHeaders,
        originalModel,
        resolve
      );
      return;
    }

    if (
      !skipStructuredChatJsonConverters &&
      needsResponseConversion &&
      upstreamWire === "openai" &&
      status === 200 &&
      isJsonResponse
    ) {
      this.handleOpenAIJsonToAnthropicResponse(
        proxyRes,
        task,
        ctx,
        onClientDisconnect,
        status,
        responseHeaders,
        originalModel,
        resolve
      );
      return;
    }

    if (
      !skipStructuredChatJsonConverters &&
      needsResponseConversion &&
      upstreamWire === "anthropic" &&
      status === 200 &&
      isJsonResponse
    ) {
      this.handleAnthropicJsonToOpenAIResponse(
        proxyRes,
        task,
        ctx,
        onClientDisconnect,
        status,
        responseHeaders,
        originalModel,
        resolve
      );
      return;
    }

    const isSSEResponse = proxyRes.headers["content-type"]?.includes("text/event-stream");

    // Anthropic upstream SSE → OpenAI Chat Completions SSE or Responses API SSE (true streaming).
    if (
      needsResponseConversion &&
      upstreamWire === "anthropic" &&
      isSSEResponse &&
      status === 200 &&
      clientRes
    ) {
      if (clientSurface === "openai") {
        this.handleAnthropicSseToOpenAIChat(
          proxyRes,
          task,
          ctx,
          onClientDisconnect,
          status,
          responseHeaders,
          originalModel,
          resolve
        );
        return;
      }
      if (clientSurface === "openai_responses") {
        this.handleAnthropicSseToResponsesSseThroughChat(
          proxyRes,
          task,
          ctx,
          onClientDisconnect,
          status,
          responseHeaders,
          originalModel,
          resolve
        );
        return;
      }
      this.handleCrossProtocolSseRejection(
        proxyRes,
        task,
        ctx,
        onClientDisconnect,
        status,
        responseHeaders,
        resolve
      );
      return;
    }

    if (needsResponseConversion && isSSEResponse && clientRes) {
      this.handleCrossProtocolSseRejection(
        proxyRes,
        task,
        ctx,
        onClientDisconnect,
        status,
        responseHeaders,
        resolve
      );
      return;
    }

    if (isSSEResponse && clientRes) {
      this.handleSSEResponse(
        proxyRes,
        task,
        ctx,
        onClientDisconnect,
        status,
        responseHeaders,
        resolve
      );
      return;
    }

    // Non-streaming: buffer the response
    this.handleBufferedResponse(
      proxyRes,
      task,
      ctx,
      onClientDisconnect,
      status,
      responseHeaders,
      resolve
    );
  }

  /** Anthropic upstream SSE → client OpenAI Chat Completions SSE. */
  private handleAnthropicSseToOpenAIChat(
    proxyRes: http.IncomingMessage,
    task: RequestTask,
    ctx: ExecutionContext,
    onClientDisconnect: () => void,
    status: number,
    responseHeaders: Record<string, string | string[]>,
    originalModel: string | undefined,
    resolve: (value: ProxyResult) => void
  ): void {
    const { clientId, provider, res: clientRes } = task;
    if (!clientRes) {
      resolve({
        statusCode: 500,
        headers: {},
        duration: Date.now() - ctx.startTime,
        errorMessage: "Missing client response for Anthropic SSE conversion",
      });
      return;
    }

    const sseHeaders = headersForResponsesSse(responseHeaders);
    log.info(`[A->Chat SSE] ${clientId}: anthropic → OpenAI chunks (${provider.id})`);
    clientRes.writeHead(status, sseHeaders);

    const startTime = Date.now();

    const chatState = createAnthropicToOpenAISseState(originalModel ?? task.originalModel ?? "");

    const sseBuffer = createAnthropicSseEnvelopeBuffer(envelope => {
      const fragments = processAnthropicStreamEnvelope(chatState, envelope);
      for (const line of fragments) {
        if (!ctx.clientDisconnected) {
          clientRes.write(line);
        }
      }
    });

    proxyRes.on("data", (chunk: Buffer) => {
      sseBuffer.push(chunk);
    });

    proxyRes.on("end", () => {
      sseBuffer.flush();
      if (!ctx.clientDisconnected) {
        if (!chatState.streamingFinished) {
          for (const line of flushAnthropicToOpenAISseFinal(chatState)) {
            clientRes.write(line);
          }
        }
        clientRes.end();
      }

      clientRes.off("close", onClientDisconnect);
      task.streamCompleted = !ctx.clientDisconnected;
      ctx.streamCompleted = task.streamCompleted;
      resolve({
        statusCode: ctx.clientDisconnected ? 499 : status,
        headers: sseHeaders,
        duration: Date.now() - startTime,
        streamed: true,
        streamCompleted: task.streamCompleted,
        errorMessage: ctx.clientDisconnected ? "Client disconnected" : undefined,
      });
    });

    proxyRes.on("error", err => {
      log.error(`[A->Chat SSE] upstream error ${provider.id}`, err);
      clientRes.off("close", onClientDisconnect);
      if (!ctx.clientDisconnected && !clientRes.writableEnded) {
        clientRes.end();
      }
    });

    clientRes.on("error", () => {
      proxyRes.destroy();
    });
  }

  /** Anthropic upstream SSE → Responses SSE via Chat completion chunk bridge. */
  private handleAnthropicSseToResponsesSseThroughChat(
    proxyRes: http.IncomingMessage,
    task: RequestTask,
    ctx: ExecutionContext,
    onClientDisconnect: () => void,
    status: number,
    responseHeaders: Record<string, string | string[]>,
    originalModel: string | undefined,
    resolve: (value: ProxyResult) => void
  ): void {
    const { provider, res: clientRes } = task;
    if (!clientRes) {
      resolve({
        statusCode: 500,
        headers: {},
        duration: Date.now() - ctx.startTime,
        errorMessage: "Missing client response for Anthropic→Responses SSE",
      });
      return;
    }

    const sseHeaders = headersForResponsesSse(responseHeaders);
    log.info(`[A->Responses SSE] anthropic sse → Responses (${provider.id})`);
    clientRes.writeHead(status, sseHeaders);

    const startTime = Date.now();
    const chatState = createAnthropicToOpenAISseState(originalModel ?? task.originalModel ?? "");
    const respState = createStreamingState({ echo: task.originalResponsesEcho });

    const feedSyntheticChatCompletionChunk = (line: string): void => {
      const trimmed = line.trimEnd();
      const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
      if (!payload) {
        return;
      }
      const synth = processStreamingChunk(respState, payload);
      for (const ev of synth) {
        if (!ctx.clientDisconnected) {
          clientRes.write(ev);
        }
      }
    };

    const sseBuffer = createAnthropicSseEnvelopeBuffer(envelope => {
      const fragments = processAnthropicStreamEnvelope(chatState, envelope);
      for (const line of fragments) {
        feedSyntheticChatCompletionChunk(line);
      }
    });

    proxyRes.on("data", (chunk: Buffer) => {
      sseBuffer.push(chunk);
    });

    proxyRes.on("end", () => {
      sseBuffer.flush();
      if (!ctx.clientDisconnected && !chatState.streamingFinished) {
        for (const line of flushAnthropicToOpenAISseFinal(chatState)) {
          feedSyntheticChatCompletionChunk(line);
        }
      }
      if (!ctx.clientDisconnected && respState.phase !== "done") {
        for (const ev of processStreamingChunk(respState, "[DONE]")) {
          clientRes.write(ev);
        }
      }

      clientRes.off("close", onClientDisconnect);
      if (!ctx.clientDisconnected) {
        clientRes.end();
      }

      task.streamCompleted = !ctx.clientDisconnected;
      ctx.streamCompleted = task.streamCompleted;

      resolve({
        statusCode: ctx.clientDisconnected ? 499 : status,
        headers: sseHeaders,
        duration: Date.now() - startTime,
        streamed: true,
        streamCompleted: task.streamCompleted,
        errorMessage: ctx.clientDisconnected ? "Client disconnected" : undefined,
      });
    });

    proxyRes.on("error", err => {
      log.error(`[A->Responses SSE via stream] upstream error ${provider.id}`, err);
      clientRes.off("close", onClientDisconnect);
      if (!ctx.clientDisconnected && !clientRes.writableEnded) {
        clientRes.end();
      }
    });

    clientRes.on("error", () => {
      proxyRes.destroy();
    });
  }

  /**
   * Cross-protocol streaming is unsupported: reject after draining upstream
   */
  private handleCrossProtocolSseRejection(
    proxyRes: http.IncomingMessage,
    task: RequestTask,
    ctx: ExecutionContext,
    onClientDisconnect: () => void,
    status: number,
    responseHeaders: Record<string, string | string[]>,
    resolve: (value: ProxyResult) => void
  ): void {
    const { clientId, res: clientRes } = task;
    log.warn(
      `[${clientId}] Cross-protocol streaming is not supported (client=${task.clientSurface}, upstream=${task.provider.providerType}); use stream=false in the request.`
    );
    proxyRes.on("data", () => {
      // drain
    });
    proxyRes.on("end", () => {
      if (clientRes) {
        clientRes.off("close", onClientDisconnect);
      }
      const errBody = JSON.stringify({
        error: {
          type: "api_error",
          message:
            "Cross-protocol conversion does not support streaming. Pass stream: false, or use the same API family as the upstream provider.",
        },
      });
      ctx.responseChunks.push(Buffer.from(errBody, "utf-8"));
      resolve({
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: errBody,
        duration: Date.now() - ctx.startTime,
        responseBodyChunks: ctx.responseChunks,
        errorMessage: "Cross-protocol streaming not supported",
      });
    });
  }

  /**
   * Upstream OpenAI JSON -> client Anthropic message JSON
   */
  private handleOpenAIJsonToAnthropicResponse(
    proxyRes: http.IncomingMessage,
    task: RequestTask,
    ctx: ExecutionContext,
    onClientDisconnect: () => void,
    status: number,
    responseHeaders: Record<string, string | string[]>,
    originalModel: string | undefined,
    resolve: (value: ProxyResult) => void
  ): void {
    const { clientId, provider, res: clientRes } = task;

    let responseBody = "";
    proxyRes.on("data", (chunk: Buffer) => {
      responseBody += chunk.toString();
    });

    proxyRes.on("end", () => {
      if (clientRes) {
        clientRes.off("close", onClientDisconnect);
      }
      ctx.originalResponseBody = responseBody;
      const duration = Date.now() - ctx.startTime;

      try {
        const openaiResponse = JSON.parse(responseBody) as OpenAIChatCompletionResponse;
        const anthropicResponse = convertResponseToAnthropic(
          openaiResponse,
          originalModel || "none"
        );
        anthropicResponse.content = applyPlatformResponseTransforms(
          openaiResponse as unknown as Record<string, unknown>,
          anthropicResponse.content,
          provider.baseUrl
        );

        ctx.responseChunks.push(Buffer.from(JSON.stringify(anthropicResponse), "utf-8"));

        this.responseLogger.logResponse(
          clientId,
          duration,
          status,
          ctx.responseChunks,
          undefined,
          ctx.originalResponseBody,
          ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
        );

        resolve({
          statusCode: status,
          headers: responseHeaders,
          body: JSON.stringify(anthropicResponse),
          duration,
          responseBodyChunks: ctx.responseChunks,
          originalResponseBody: ctx.originalResponseBody,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(`[O->A response] Conversion failed for ${provider.id}: ${errMsg}`);

        const errorResponse = {
          type: "error",
          error: {
            type: "api_error",
            message: `Response format conversion failed: ${errMsg}`,
          },
        };
        const errorBody = JSON.stringify(errorResponse);

        ctx.responseChunks.push(Buffer.from(errorBody, "utf-8"));

        this.responseLogger.logResponse(
          clientId,
          duration,
          502,
          ctx.responseChunks,
          `OpenAI conversion failed: ${errMsg}`,
          ctx.originalResponseBody,
          ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
        );

        resolve({
          statusCode: 502,
          headers: { "Content-Type": "application/json" },
          body: errorBody,
          duration,
          responseBodyChunks: ctx.responseChunks,
          errorMessage: `OpenAI conversion failed: ${errMsg}`,
        });
      }
    });
  }

  /**
   * Upstream Anthropic message JSON -> client OpenAI chat.completion JSON
   */
  private handleAnthropicJsonToOpenAIResponse(
    proxyRes: http.IncomingMessage,
    task: RequestTask,
    ctx: ExecutionContext,
    onClientDisconnect: () => void,
    status: number,
    responseHeaders: Record<string, string | string[]>,
    originalModel: string | undefined,
    resolve: (value: ProxyResult) => void
  ): void {
    const { clientId, provider, res: clientRes } = task;
    let responseBody = "";
    proxyRes.on("data", (chunk: Buffer) => {
      responseBody += chunk.toString();
    });
    proxyRes.on("end", () => {
      if (clientRes) {
        clientRes.off("close", onClientDisconnect);
      }
      ctx.originalResponseBody = responseBody;
      const duration = Date.now() - ctx.startTime;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse
        const parsed = JSON.parse(responseBody);
        if (!isAnthropicMessageResponse(parsed)) {
          throw new Error("Response is not a valid Anthropic non-streaming message");
        }
        const openaiResponse = convertAnthropicResponseToOpenAI(
          parsed,
          originalModel || (parsed as { model?: string }).model || "none"
        );

        if (task.streamRequested) {
          const sse = formatOpenAIChatCompletionsSse(openaiResponse);
          log.info(`[A->ChatCompletions] synthetic SSE: bytes=${sse.length}`);
          ctx.responseChunks.push(Buffer.from(sse, "utf-8"));
          this.responseLogger.logResponse(
            clientId,
            duration,
            status,
            ctx.responseChunks,
            undefined,
            ctx.originalResponseBody,
            ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
          );
          resolve({
            statusCode: status,
            headers: headersForResponsesSse(responseHeaders),
            body: sse,
            duration,
            responseBodyChunks: ctx.responseChunks,
            originalResponseBody: ctx.originalResponseBody,
          });
        } else {
          const outJson = JSON.stringify(openaiResponse);
          ctx.responseChunks.push(Buffer.from(outJson, "utf-8"));
          this.responseLogger.logResponse(
            clientId,
            duration,
            status,
            ctx.responseChunks,
            undefined,
            ctx.originalResponseBody,
            ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
          );
          resolve({
            statusCode: status,
            headers: responseHeaders,
            body: outJson,
            duration,
            responseBodyChunks: ctx.responseChunks,
            originalResponseBody: ctx.originalResponseBody,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(`[A->O response] Conversion failed for ${provider.id}: ${errMsg}`);
        const errorResponse = {
          error: {
            type: "api_error",
            message: `Response format conversion failed: ${errMsg}`,
          },
        };
        const errorBody = JSON.stringify(errorResponse);
        ctx.responseChunks.push(Buffer.from(errorBody, "utf-8"));
        this.responseLogger.logResponse(
          clientId,
          duration,
          502,
          ctx.responseChunks,
          `Anthropic to OpenAI conversion failed: ${errMsg}`,
          ctx.originalResponseBody,
          ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
        );
        resolve({
          statusCode: 502,
          headers: { "Content-Type": "application/json" },
          body: errorBody,
          duration,
          responseBodyChunks: ctx.responseChunks,
          errorMessage: `Anthropic to OpenAI conversion failed: ${errMsg}`,
        });
      }
    });
  }

  /**
   * Upstream Chat Completions JSON -> client OpenAI Responses API JSON
   */
  private handleOpenAIChatJsonToResponsesForClient(
    proxyRes: http.IncomingMessage,
    task: RequestTask,
    ctx: ExecutionContext,
    onClientDisconnect: () => void,
    status: number,
    responseHeaders: Record<string, string | string[]>,
    originalModel: string | undefined,
    resolve: (value: ProxyResult) => void
  ): void {
    const { clientId, provider, res: clientRes, responsesStreamRequested } = task;
    let responseBody = "";
    proxyRes.on("data", (chunk: Buffer) => {
      responseBody += chunk.toString();
    });
    proxyRes.on("end", () => {
      if (clientRes) {
        clientRes.off("close", onClientDisconnect);
      }
      ctx.originalResponseBody = responseBody;
      const duration = Date.now() - ctx.startTime;
      try {
        // Some upstream providers ignore stream=false and return SSE even when
        // Content-Type is application/json. Detect and extract the final JSON payload.
        let jsonBody = responseBody;
        if (responseBody.startsWith("data:")) {
          const dataLines = responseBody
            .split("\n")
            .map(line => line.trim())
            .filter(
              line => line.startsWith("data:") && line !== "data: [DONE]" && line !== "data:[DONE]"
            );
          if (dataLines.length > 0) {
            const lastLine = dataLines[dataLines.length - 1];
            jsonBody = lastLine.slice("data:".length).trim();
            log.info(
              `[Chat->Responses] Detected SSE in JSON response for ${provider.id}; ` +
                `extracted last data chunk from ${dataLines.length} SSE lines`
            );
          }
        }
        const openaiResponse = JSON.parse(jsonBody) as OpenAIChatCompletionResponse;
        const out = convertChatCompletionToResponses(
          openaiResponse,
          originalModel || "none",
          task.originalResponsesEcho
        );
        if (responsesStreamRequested) {
          const sse = formatOpenAIResponsesSse(out);
          // if (process.env.CCRELAY_LOG_RESPONSES_SSE === "1") {
          const head = sse.split("\n\n").filter(Boolean).slice(0, 6).join(" | ");
          log.info(
            `[Chat->Responses] synthetic SSE: bytes=${sse.length} ` +
              `data_lines~=${sse.split("\n\n").length} head=${head.slice(0, 2000)}`
          );
          // }
          ctx.responseChunks.push(Buffer.from(sse, "utf-8"));
          this.responseLogger.logResponse(
            clientId,
            duration,
            status,
            ctx.responseChunks,
            undefined,
            ctx.originalResponseBody,
            ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
          );
          resolve({
            statusCode: status,
            headers: headersForResponsesSse(responseHeaders),
            body: sse,
            duration,
            responseBodyChunks: ctx.responseChunks,
            originalResponseBody: ctx.originalResponseBody,
          });
        } else {
          const outJson = JSON.stringify(out);
          ctx.responseChunks.push(Buffer.from(outJson, "utf-8"));
          this.responseLogger.logResponse(
            clientId,
            duration,
            status,
            ctx.responseChunks,
            undefined,
            ctx.originalResponseBody,
            ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
          );
          resolve({
            statusCode: status,
            headers: responseHeaders,
            body: outJson,
            duration,
            responseBodyChunks: ctx.responseChunks,
            originalResponseBody: ctx.originalResponseBody,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(`[Chat->Responses] Conversion failed for ${provider.id}: ${errMsg}`);
        const errorBody = JSON.stringify({
          error: { type: "api_error", message: `Response format conversion failed: ${errMsg}` },
        });
        ctx.responseChunks.push(Buffer.from(errorBody, "utf-8"));
        this.responseLogger.logResponse(
          clientId,
          duration,
          502,
          ctx.responseChunks,
          `Chat to Responses failed: ${errMsg}`,
          ctx.originalResponseBody,
          ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
        );
        resolve({
          statusCode: 502,
          headers: { "Content-Type": "application/json" },
          body: errorBody,
          duration,
          responseBodyChunks: ctx.responseChunks,
          errorMessage: `Chat to Responses failed: ${errMsg}`,
        });
      }
    });
  }

  /**
   * Upstream OpenAI Chat SSE -> client Responses API SSE (true streaming)
   */
  private handleOpenAISseToResponsesSse(
    proxyRes: http.IncomingMessage,
    task: RequestTask,
    ctx: ExecutionContext,
    onClientDisconnect: () => void,
    status: number,
    responseHeaders: Record<string, string | string[]>,
    _originalModel: string | undefined,
    resolve: (value: ProxyResult) => void
  ): void {
    const { provider, res: clientRes } = task;

    const sseHeaders = headersForResponsesSse(responseHeaders);
    log.info(
      `[Chat->Responses SSE] Writing headers: status=${status} keys=${Object.keys(sseHeaders).join(",")}`
    );
    clientRes!.writeHead(status, sseHeaders);

    const startTime = Date.now();
    let chunkCount = 0;
    let firstChunkTime = 0;
    let totalBytes = 0;

    const state = createStreamingState({ echo: task.originalResponsesEcho });

    const processLine = (line: string): void => {
      // Strip "data:" prefix — upstream SSE lines come as "data: {...}" or "data: [DONE]"
      const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
      const events = processStreamingChunk(state, payload);
      for (const event of events) {
        clientRes!.write(event);
      }
    };

    const lineBuffer = createSseLineBuffer(processLine);

    proxyRes.on("data", (chunk: Buffer) => {
      chunkCount++;
      totalBytes += chunk.length;
      if (chunkCount === 1) {
        firstChunkTime = Date.now() - startTime;
        const preview =
          chunk.length > 200
            ? `${chunk.slice(0, 200).toString("utf-8")}...`
            : chunk.toString("utf-8");
        log.info(`[Chat->Responses SSE] First chunk: ${chunk.length} bytes, preview="${preview}"`);
      }
      lineBuffer.feed(chunk);
    });

    proxyRes.on("end", () => {
      clientRes!.off("close", onClientDisconnect);

      // Flush any remaining partial line
      lineBuffer.flush();

      // If stream ended without [DONE], emit completion
      if (state.phase !== "done") {
        const remaining = processStreamingChunk(state, "[DONE]");
        for (const event of remaining) {
          clientRes!.write(event);
        }
      }

      clientRes!.end();

      task.streamCompleted = true;
      ctx.streamCompleted = true;

      const duration = Date.now() - startTime;
      log.info(
        `[Chat->Responses SSE] ${provider.id}: ${chunkCount} upstream chunks, ` +
          `${totalBytes} bytes, ${state.seq} events emitted, ` +
          `first_chunk=${firstChunkTime}ms, total=${duration}ms`
      );

      resolve({
        statusCode: status,
        headers: sseHeaders,
        duration,
        streamed: true,
        streamCompleted: true,
        responseBodyChunks: ctx.responseChunks,
      });
    });

    proxyRes.on("error", err => {
      log.error(`[Chat->Responses SSE] upstream error for ${provider.id}`, err);
      clientRes!.end();
    });

    clientRes!.on("error", (err: Error) => {
      log.error(`[Chat->Responses SSE] client error for ${provider.id}: ${err.message}`);
      proxyRes.destroy();
    });
  }

  /**
   * Upstream Anthropic JSON -> Chat (intermediate) -> client Responses API JSON
   */
  private handleAnthropicJsonToOpenAIResponsesForClient(
    proxyRes: http.IncomingMessage,
    task: RequestTask,
    ctx: ExecutionContext,
    onClientDisconnect: () => void,
    status: number,
    responseHeaders: Record<string, string | string[]>,
    originalModel: string | undefined,
    resolve: (value: ProxyResult) => void
  ): void {
    const { clientId, provider, res: clientRes, responsesStreamRequested } = task;
    let responseBody = "";
    proxyRes.on("data", (chunk: Buffer) => {
      responseBody += chunk.toString();
    });
    proxyRes.on("end", () => {
      if (clientRes) {
        clientRes.off("close", onClientDisconnect);
      }
      ctx.originalResponseBody = responseBody;
      const duration = Date.now() - ctx.startTime;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse
        const parsed = JSON.parse(responseBody);
        if (!isAnthropicMessageResponse(parsed)) {
          throw new Error("Response is not a valid Anthropic non-streaming message");
        }
        const chat = convertAnthropicResponseToOpenAI(
          parsed,
          originalModel || (parsed as { model?: string }).model || "none"
        );
        const out = convertChatCompletionToResponses(
          chat,
          originalModel || chat.model,
          task.originalResponsesEcho
        );
        if (responsesStreamRequested) {
          const sse = formatOpenAIResponsesSse(out);
          // if (process.env.CCRELAY_LOG_RESPONSES_SSE === "1") {
          const head = sse.split("\n\n").filter(Boolean).slice(0, 6).join(" | ");
          log.info(
            `[A->Responses] synthetic SSE: bytes=${sse.length} ` +
              `data_lines~=${sse.split("\n\n").length} head=${head.slice(0, 2000)}`
          );
          // }
          ctx.responseChunks.push(Buffer.from(sse, "utf-8"));
          this.responseLogger.logResponse(
            clientId,
            duration,
            status,
            ctx.responseChunks,
            undefined,
            ctx.originalResponseBody,
            ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
          );
          resolve({
            statusCode: status,
            headers: headersForResponsesSse(responseHeaders),
            body: sse,
            duration,
            responseBodyChunks: ctx.responseChunks,
            originalResponseBody: ctx.originalResponseBody,
          });
        } else {
          const outJson = JSON.stringify(out);
          ctx.responseChunks.push(Buffer.from(outJson, "utf-8"));
          this.responseLogger.logResponse(
            clientId,
            duration,
            status,
            ctx.responseChunks,
            undefined,
            ctx.originalResponseBody,
            ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
          );
          resolve({
            statusCode: status,
            headers: responseHeaders,
            body: outJson,
            duration,
            responseBodyChunks: ctx.responseChunks,
            originalResponseBody: ctx.originalResponseBody,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(`[A->Responses] Conversion failed for ${provider.id}: ${errMsg}`);
        const errorBody = JSON.stringify({
          error: { type: "api_error", message: `Response format conversion failed: ${errMsg}` },
        });
        ctx.responseChunks.push(Buffer.from(errorBody, "utf-8"));
        this.responseLogger.logResponse(
          clientId,
          duration,
          502,
          ctx.responseChunks,
          `A to Responses failed: ${errMsg}`,
          ctx.originalResponseBody,
          ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
        );
        resolve({
          statusCode: 502,
          headers: { "Content-Type": "application/json" },
          body: errorBody,
          duration,
          responseBodyChunks: ctx.responseChunks,
          errorMessage: `A to Responses failed: ${errMsg}`,
        });
      }
    });
  }

  /**
   * Handle SSE streaming response
   */
  private handleSSEResponse(
    proxyRes: http.IncomingMessage,
    task: RequestTask,
    ctx: ExecutionContext,
    onClientDisconnect: () => void,
    status: number,
    responseHeaders: Record<string, string | string[]>,
    resolve: (value: ProxyResult) => void
  ): void {
    const { clientId, res: clientRes } = task;

    log.info(`[Perf:${clientId}] SSE streaming mode enabled`);

    // Write headers immediately
    clientRes!.writeHead(status, responseHeaders);

    // Pipe the response directly to client
    proxyRes.pipe(clientRes!);

    // Handle upstream errors during streaming
    proxyRes.on("error", (err: Error) => {
      log.error(`[${clientId}] SSE upstream error: ${err.message}`);
      if (!clientRes!.writableEnded) {
        try {
          clientRes!.end();
        } catch {
          // Ignore errors when ending already-closed stream
        }
      }
    });

    // Handle client errors during streaming
    clientRes!.on("error", (err: Error) => {
      log.error(`[${clientId}] Client connection error: ${err.message}`);
      proxyRes.destroy();
    });

    // Track streaming performance
    proxyRes.on("data", (chunk: Buffer) => {
      ctx.streamChunkCount++;
      ctx.streamTotalBytes += chunk.length;

      // Log first chunk (helps identify prefill delay)
      if (!ctx.firstChunkLogged) {
        ctx.firstChunkLogged = true;
        const firstChunkDelay = Date.now() - ctx.firstByteTime;
        log.info(
          `[Perf:${clientId}] FirstChunk: ${firstChunkDelay}ms after headers, ${chunk.length} bytes`
        );
      }

      // Log every 10 chunks or large chunks (>10KB)
      if (ctx.streamChunkCount % 10 === 0 || chunk.length > 10240) {
        const chunkDuration = Date.now() - ctx.startTime;
        log.info(
          `[Perf:${clientId}] Chunk#${ctx.streamChunkCount}: ${chunk.length} bytes, total: ${ctx.streamTotalBytes} bytes, elapsed: ${chunkDuration}ms`
        );
      }

      if (this.responseLogger.enabled) {
        ctx.responseChunks.push(chunk);
      }
    });

    proxyRes.on("end", () => {
      const totalDuration = Date.now() - ctx.startTime;
      const avgChunkSize =
        ctx.streamChunkCount > 0 ? Math.round(ctx.streamTotalBytes / ctx.streamChunkCount) : 0;

      // Clean up client disconnect listener
      if (clientRes) {
        clientRes.off("close", onClientDisconnect);
      }

      if (ctx.clientDisconnected) {
        log.info(
          `[Perf:${clientId}] StreamEnd (client disconnected): ${ctx.streamChunkCount} chunks, ${ctx.streamTotalBytes} bytes, total: ${totalDuration}ms`
        );
      } else {
        log.info(
          `[Perf:${clientId}] StreamEnd: ${ctx.streamChunkCount} chunks, ${ctx.streamTotalBytes} total bytes, avg ${avgChunkSize} bytes/chunk, total: ${totalDuration}ms`
        );
      }
      this.responseLogger.logResponse(
        clientId,
        totalDuration,
        ctx.clientDisconnected ? 499 : status,
        ctx.responseChunks,
        ctx.clientDisconnected ? "Client disconnected" : undefined,
        undefined,
        ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
      );
      if (!ctx.clientDisconnected) {
        task.streamCompleted = true;
      }
      resolve({
        statusCode: ctx.clientDisconnected ? 499 : status,
        headers: responseHeaders,
        duration: totalDuration,
        responseBodyChunks: ctx.responseChunks,
        streamed: true,
        streamCompleted: !ctx.clientDisconnected,
        errorMessage: ctx.clientDisconnected ? "Client disconnected" : undefined,
      });
    });
  }

  /**
   * Handle buffered (non-streaming) response
   */
  private handleBufferedResponse(
    proxyRes: http.IncomingMessage,
    task: RequestTask,
    ctx: ExecutionContext,
    onClientDisconnect: () => void,
    status: number,
    responseHeaders: Record<string, string | string[]>,
    resolve: (value: ProxyResult) => void
  ): void {
    const { clientId, res: clientRes } = task;

    proxyRes.on("data", (chunk: Buffer) => {
      ctx.streamChunkCount++;
      ctx.streamTotalBytes += chunk.length;
      ctx.responseChunks.push(chunk);
    });

    proxyRes.on("end", () => {
      const totalDuration = Date.now() - ctx.startTime;

      // Clean up client disconnect listener
      if (clientRes) {
        clientRes.off("close", onClientDisconnect);
      }

      log.info(
        `[Perf:${clientId}] ResponseEnd: ${ctx.streamChunkCount} chunks, ${ctx.streamTotalBytes} total bytes, total: ${totalDuration}ms`
      );

      let outStatus = status;
      const outHeaders: Record<string, string | string[]> = { ...responseHeaders };

      // GET /models: convert list shape only when entry path protocol differs from provider upstream wire
      const upstreamWireFmt: ApiSurface = isOpenAIType(task.provider.providerType)
        ? "openai"
        : "anthropic";
      const modelsCrossProtocolConversion =
        task.method === "GET" &&
        isModelsListUpstreamPath(task.requestPath) &&
        outStatus === 200 &&
        (task.clientSurface === "openai" || task.clientSurface === "anthropic") &&
        task.clientSurface !== upstreamWireFmt &&
        ctx.responseChunks.length > 0;
      if (modelsCrossProtocolConversion) {
        try {
          const bodyStr = Buffer.concat(ctx.responseChunks).toString("utf-8");
          const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
          const clientOpenaiUpstreamAnthropic =
            task.clientSurface === "openai" && upstreamWireFmt === "anthropic";
          const clientAnthropicUpstreamOpenai =
            task.clientSurface === "anthropic" && upstreamWireFmt === "openai";

          if (clientAnthropicUpstreamOpenai && isOpenAIModelsListJson(parsed)) {
            const anthropicList = convertOpenAIModelsToAnthropic(
              parsed as unknown as Parameters<typeof convertOpenAIModelsToAnthropic>[0]
            );
            ctx.responseChunks = [Buffer.from(JSON.stringify(anthropicList), "utf-8")];
            outHeaders["content-type"] = "application/json";
            if ("Content-Length" in outHeaders) {
              delete outHeaders["Content-Length"];
            }
            log.info(
              `[${clientId}] GET /models: entry anthropic vs OpenAI upstream; converted models list shape`
            );
          } else if (clientOpenaiUpstreamAnthropic && isAnthropicModelsListJson(parsed)) {
            const openaiList = convertAnthropicModelsToOpenAI(
              parsed as unknown as Parameters<typeof convertAnthropicModelsToOpenAI>[0]
            );
            ctx.responseChunks = [Buffer.from(JSON.stringify(openaiList), "utf-8")];
            outHeaders["content-type"] = "application/json";
            if ("Content-Length" in outHeaders) {
              delete outHeaders["Content-Length"];
            }
            log.info(
              `[${clientId}] GET /models: entry OpenAI vs Anthropic upstream; converted models list shape`
            );
          }
        } catch {
          /* parse failed — keep original */
        }
      }

      if (
        outStatus === 200 &&
        task.originalModel &&
        providerHasConfigurableModelMap(task.provider) &&
        ctx.responseChunks.length > 0 &&
        !(task.method === "GET" && isModelsListUpstreamPath(task.requestPath))
      ) {
        try {
          const bodyStr = Buffer.concat(ctx.responseChunks).toString("utf-8");
          const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
          if (typeof parsed.model === "string" && parsed.model !== task.originalModel) {
            parsed.model = task.originalModel;
            ctx.responseChunks = [Buffer.from(JSON.stringify(parsed), "utf-8")];
            for (const k of Object.keys(outHeaders)) {
              if (k.toLowerCase() === "content-length") {
                delete outHeaders[k];
              }
            }
          }
        } catch {
          /* not JSON */
        }
      }

      // Cross-protocol: convert error response format to match client's expected API surface
      const upstreamWire: ApiSurface = isOpenAIType(task.provider.providerType)
        ? "openai"
        : "anthropic";
      if (
        outStatus >= 400 &&
        task.clientSurface !== upstreamWire &&
        ctx.responseChunks.length > 0
      ) {
        try {
          const errorBody = Buffer.concat(ctx.responseChunks).toString("utf-8");
          const parsed = JSON.parse(errorBody) as Record<string, unknown>;
          let wrappedError: string;
          if (task.clientSurface === "anthropic") {
            const message =
              ((parsed.error as Record<string, unknown>)?.message as string) ||
              (parsed.message as string) ||
              errorBody;
            const type = ((parsed.error as Record<string, unknown>)?.type as string) || "api_error";
            wrappedError = JSON.stringify({ type: "error", error: { type, message } });
          } else {
            const message =
              ((parsed.error as Record<string, unknown>)?.message as string) ||
              (parsed.message as string) ||
              errorBody;
            const type =
              ((parsed.error as Record<string, unknown>)?.type as string) || "server_error";
            wrappedError = JSON.stringify({ error: { type, message, code: String(outStatus) } });
          }
          const wrappedBuf = Buffer.from(wrappedError, "utf-8");
          ctx.responseChunks = [wrappedBuf];
          outHeaders["content-type"] = "application/json";
          log.info(
            `[${clientId}] Cross-protocol error format converted: ${upstreamWire} -> ${task.clientSurface}`
          );
        } catch {
          // Parse failed; keep original error body
        }
      }

      this.responseLogger.logResponse(
        clientId,
        totalDuration,
        outStatus,
        ctx.responseChunks,
        undefined,
        undefined,
        ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
      );
      resolve({
        statusCode: outStatus,
        headers: outHeaders,
        body: ctx.responseChunks.length > 0 ? Buffer.concat(ctx.responseChunks) : undefined,
        duration: totalDuration,
        responseBodyChunks: ctx.responseChunks,
      });
    });
  }

  /**
   * Setup error and timeout handlers for the request
   */
  private setupErrorHandlers(
    proxyReq: http.ClientRequest,
    task: RequestTask,
    ctx: ExecutionContext,
    onClientDisconnect: () => void,
    abortController: AbortController,
    abortSignal: AbortSignal,
    attempt: number,
    maxRetries: number,
    resolve: (value: ProxyResult) => void,
    reject: (reason: unknown) => void
  ): void {
    const { clientId, provider, res: clientRes } = task;

    proxyReq.on("error", (err: NodeJS.ErrnoException) => {
      const duration = Date.now() - ctx.startTime;

      // Clean up client disconnect listener
      if (clientRes) {
        clientRes.off("close", onClientDisconnect);
      }

      // Check if aborted by client disconnect
      if (abortSignal.aborted) {
        log.info(`[${clientId}] Request aborted (client disconnect) after ${duration}ms`);
        this.responseLogger.logResponse(
          clientId,
          duration,
          499,
          ctx.responseChunks,
          "Client disconnected",
          undefined,
          ctx.firstByteTime > 0 ? ctx.firstByteTime - ctx.startTime : undefined
        );
        resolve({
          statusCode: 499,
          headers: {},
          duration,
          errorMessage: "Client disconnected",
        });
        return;
      }

      // Retry on connection-phase errors
      if (attempt < maxRetries && err.code && RETRYABLE_CODES.includes(err.code)) {
        log.warn(
          `Proxy connection error to ${provider.id} (attempt ${attempt}/${maxRetries}): ${err.message}, retrying in ${attempt}s...`
        );

        // Clean up listeners before retry
        if (clientRes) {
          clientRes.off("close", onClientDisconnect);
        }

        setTimeout(() => {
          if (this.executeFn) {
            this.executeFn({ ...task, attempt: attempt + 1 })
              .then(resolve)
              .catch(reject);
          } else {
            reject(new Error(`Proxy error: ${err.message} (no retry handler)`));
          }
        }, 1000 * attempt);
        return;
      }

      log.error(`Proxy error to ${provider.id} (${duration}ms): ${err.message}`);
      this.responseLogger.logResponse(
        clientId,
        duration,
        0,
        ctx.responseChunks,
        err.message,
        undefined,
        undefined
      );
      reject(new Error(`Proxy error: ${err.message}`));
    });

    proxyReq.on("timeout", () => {
      const duration = Date.now() - ctx.startTime;
      log.error(`Proxy timeout to ${provider.id} (${duration}ms)`);

      // Clean up client disconnect listener
      if (clientRes) {
        clientRes.off("close", onClientDisconnect);
      }

      // Abort the request
      abortController.abort();
      this.responseLogger.logResponse(
        clientId,
        duration,
        0,
        ctx.responseChunks,
        "Timeout",
        undefined,
        undefined
      );
      reject(new Error("Proxy timeout"));
    });
  }
}
