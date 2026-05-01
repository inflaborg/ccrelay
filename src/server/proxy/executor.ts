/**
 * Proxy executor - handles the actual HTTP request execution
 */

/* eslint-disable @typescript-eslint/naming-convention */
// HTTP headers use hyphenated names (Content-Type, etc.)

import * as http from "http";
import * as https from "https";
import * as url from "url";
import { ScopedLogger } from "../../utils/logger";
import {
  buildModelsListFallback,
  convertAnthropicResponseToOpenAI,
  convertChatCompletionToResponses,
  formatOpenAIResponsesSse,
  formatOpenAIChatCompletionsSse,
  convertResponseToAnthropic,
  convertOpenAIModelsToAnthropic,
  convertAnthropicModelsToOpenAI,
  isOpenAIType,
} from "../../converter";
import { isAnthropicMessageResponse } from "../../converter/anthropic-to-openai-response";
import type { OpenAIChatCompletionResponse } from "../../converter/openai-to-anthropic";
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

      // No request timeout - rely on client disconnect detection
      // Long-running LLM requests can take arbitrary time

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

    log.info(`[Perf:${clientId}] TTFB: ${ttfb}ms (upstream response headers, total elapsed: ${duration}ms)`);

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

    if (
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

    if (
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
    this.handleBufferedResponse(proxyRes, task, ctx, onClientDisconnect, status, responseHeaders, resolve);
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
        const anthropicResponse = convertResponseToAnthropic(openaiResponse, originalModel || "none");

        ctx.responseChunks.push(Buffer.from(JSON.stringify(anthropicResponse), "utf-8"));

        this.responseLogger.logResponse(
          clientId,
          duration,
          status,
          ctx.responseChunks,
          undefined,
          ctx.originalResponseBody
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
          ctx.originalResponseBody
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
          log.info(
            `[A->ChatCompletions] synthetic SSE: bytes=${sse.length}`
          );
          ctx.responseChunks.push(Buffer.from(sse, "utf-8"));
          this.responseLogger.logResponse(
            clientId,
            duration,
            status,
            ctx.responseChunks,
            undefined,
            ctx.originalResponseBody
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
            ctx.originalResponseBody
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
          ctx.originalResponseBody
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
        const openaiResponse = JSON.parse(responseBody) as OpenAIChatCompletionResponse;
        const out = convertChatCompletionToResponses(openaiResponse, originalModel || "none");
        if (responsesStreamRequested) {
          const sse = formatOpenAIResponsesSse(out);
          // if (process.env.CCRELAY_LOG_RESPONSES_SSE === "1") {
            const head = sse
              .split("\n\n")
              .filter(Boolean)
              .slice(0, 6)
              .join(" | ");
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
            ctx.originalResponseBody
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
            ctx.originalResponseBody
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
          ctx.originalResponseBody
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
        const out = convertChatCompletionToResponses(chat, originalModel || chat.model);
        if (responsesStreamRequested) {
          const sse = formatOpenAIResponsesSse(out);
          // if (process.env.CCRELAY_LOG_RESPONSES_SSE === "1") {
            const head = sse
              .split("\n\n")
              .filter(Boolean)
              .slice(0, 6)
              .join(" | ");
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
            ctx.originalResponseBody
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
            ctx.originalResponseBody
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
          ctx.originalResponseBody
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
        log.info(`[Perf:${clientId}] FirstChunk: ${firstChunkDelay}ms after headers, ${chunk.length} bytes`);
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
        ctx.clientDisconnected ? "Client disconnected" : undefined
      );
      resolve({
        statusCode: ctx.clientDisconnected ? 499 : status,
        headers: responseHeaders,
        duration: totalDuration,
        responseBodyChunks: ctx.responseChunks,
        streamed: true,
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
      if (
        task.method === "GET" &&
        (task.requestPath === "/v1/models" || task.requestPath.split("?")[0] === "/v1/models") &&
        status >= 400
      ) {
        const fallback = buildModelsListFallback(task.provider);
        const j = JSON.stringify(fallback);
        const buf = Buffer.from(j, "utf-8");
        ctx.responseChunks = [buf];
        outStatus = 200;
        outHeaders["content-type"] = "application/json";
        if ("Content-Length" in outHeaders) {
          delete outHeaders["Content-Length"];
        }
        log.info(`[${clientId}] GET /v1/models upstream returned ${status}; using config model list fallback`);
      }

      // Cross-protocol: convert /v1/models response format to match client's expected API surface
      const upstreamWireFmt: ApiSurface = isOpenAIType(task.provider.providerType) ? "openai" : "anthropic";
      if (
        task.method === "GET" &&
        (task.requestPath === "/v1/models" || task.requestPath.split("?")[0] === "/v1/models") &&
        outStatus === 200 &&
        task.clientSurface !== upstreamWireFmt &&
        ctx.responseChunks.length > 0
      ) {
        try {
          const bodyStr = Buffer.concat(ctx.responseChunks).toString("utf-8");
          const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
          const clientWantsAnthropic = task.clientSurface === "anthropic";
          const upstreamIsOpenAI =
            Array.isArray(parsed.data) &&
            (parsed.data as unknown[]).length > 0 &&
            ((parsed.data as Record<string, unknown>[])[0] as { object?: string })?.object === "model";
          const upstreamIsAnthropic =
            Array.isArray(parsed.data) &&
            (parsed.data as unknown[]).length > 0 &&
            ((parsed.data as Record<string, unknown>[])[0] as { type?: string })?.type === "model";

          if (upstreamIsOpenAI && clientWantsAnthropic) {
            const anthropicList = convertOpenAIModelsToAnthropic(
              parsed as unknown as Parameters<typeof convertOpenAIModelsToAnthropic>[0]
            );
            const buf = Buffer.from(JSON.stringify(anthropicList), "utf-8");
            ctx.responseChunks = [buf];
            outHeaders["content-type"] = "application/json";
            log.info(`[${clientId}] GET /v1/models: converted OpenAI -> Anthropic format`);
          } else if (upstreamIsAnthropic && !clientWantsAnthropic) {
            const openaiList = convertAnthropicModelsToOpenAI(
              parsed as unknown as Parameters<typeof convertAnthropicModelsToOpenAI>[0]
            );
            const buf = Buffer.from(JSON.stringify(openaiList), "utf-8");
            ctx.responseChunks = [buf];
            outHeaders["content-type"] = "application/json";
            log.info(`[${clientId}] GET /v1/models: converted Anthropic -> OpenAI format`);
          }
        } catch {
          // Parse failed; keep original response
        }
      }

      // Cross-protocol: convert error response format to match client's expected API surface
      const upstreamWire: ApiSurface = isOpenAIType(task.provider.providerType) ? "openai" : "anthropic";
      if (outStatus >= 400 && task.clientSurface !== upstreamWire && ctx.responseChunks.length > 0) {
        try {
          const errorBody = Buffer.concat(ctx.responseChunks).toString("utf-8");
          const parsed = JSON.parse(errorBody) as Record<string, unknown>;
          let wrappedError: string;
          if (task.clientSurface === "anthropic") {
            const message =
              ((parsed.error as Record<string, unknown>)?.message as string) ||
              (parsed.message as string) ||
              errorBody;
            const type =
              ((parsed.error as Record<string, unknown>)?.type as string) || "api_error";
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

      this.responseLogger.logResponse(clientId, totalDuration, outStatus, ctx.responseChunks, undefined);
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
        this.responseLogger.logResponse(clientId, duration, 499, ctx.responseChunks, "Client disconnected");
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
            this.executeFn({ ...task, attempt: attempt + 1 }).then(resolve).catch(reject);
          } else {
            reject(new Error(`Proxy error: ${err.message} (no retry handler)`));
          }
        }, 1000 * attempt);
        return;
      }

      log.error(`Proxy error to ${provider.id} (${duration}ms): ${err.message}`);
      this.responseLogger.logResponse(clientId, duration, 0, ctx.responseChunks, err.message);
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
      this.responseLogger.logResponse(clientId, duration, 0, ctx.responseChunks, "Timeout");
      reject(new Error("Proxy timeout"));
    });
  }
}
