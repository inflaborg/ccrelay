/**
 * Request Handler - coordinates all request processing stages
 */

import type * as http from "http";
import type * as url from "url";
import type { Router } from "../router";
import type { ConfigManager } from "../../config";
import type { QueueManager } from "../queueManager";
import type { ProxyExecutor } from "../proxy/executor";
import type { LogDatabase } from "../../database";
import type { RoutingContext, BodyProcessResult } from "./context";
import { RouterStage } from "./routerStage";
import { BodyProcessor } from "./bodyProcessor";
import { SmartRoutingStage } from "./smartRoutingStage";
import { TaskExecutor } from "./taskExecutor";
import type { ModelCatalog } from "../smartRouting/modelCatalog";
import { ResponseWriter } from "../response";
import type { ResponseLogger } from "../responseLogger";
import type { InterceptorRegistry, InterceptResult } from "../interceptor";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("RequestHandler");

function buildRawBodyLogSnapshot(
  rawBody: Buffer,
  databaseEnabled: boolean
): Pick<BodyProcessResult, "originalRequestBody" | "requestBodyLog"> {
  if (!databaseEnabled || rawBody.length === 0) {
    return { originalRequestBody: undefined, requestBodyLog: undefined };
  }
  try {
    const s = rawBody.toString("utf-8");
    return { originalRequestBody: s, requestBodyLog: s };
  } catch {
    return { originalRequestBody: undefined, requestBodyLog: undefined };
  }
}

/**
 * RequestHandler coordinates all stages of request processing
 */
export class RequestHandler {
  private routerStage: RouterStage;
  private smartRoutingStage: SmartRoutingStage;
  private bodyProcessor: BodyProcessor;
  private taskExecutor: TaskExecutor;
  private database: LogDatabase;
  private responseLogger: ResponseLogger;
  private interceptorRegistry: InterceptorRegistry;

  constructor(
    router: Router,
    config: ConfigManager,
    modelCatalog: ModelCatalog,
    queueManager: QueueManager,
    proxyExecutor: ProxyExecutor,
    database: LogDatabase,
    responseLogger: ResponseLogger,
    interceptorRegistry: InterceptorRegistry
  ) {
    this.routerStage = new RouterStage(router);
    this.smartRoutingStage = new SmartRoutingStage(config, router, modelCatalog);
    this.bodyProcessor = new BodyProcessor();
    this.taskExecutor = new TaskExecutor(queueManager, proxyExecutor, database);
    this.database = database;
    this.responseLogger = responseLogger;
    this.interceptorRegistry = interceptorRegistry;
  }

  /**
   * Handle incoming HTTP request
   */
  handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    path: string,
    parsedUrl: url.UrlWithParsedQuery
  ): void {
    const requestReceiveStart = Date.now();

    // Stage 1: Router - check blocking and resolve routing
    const routing = this.routerStage.process(req, path, parsedUrl);

    // Not found — path not in forward rules
    if (routing === null) {
      log.info(`${req.method || "GET"} ${path} -> [NOT_FOUND]`);
      // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { type: "not_found", message: "Path not routed" } }));
      return;
    }

    // If blocked, write blocked response and return
    if (routing.blocked) {
      log.info(`${routing.method} ${path} -> [BLOCKED]`);

      // Log blocked request
      this.logBlockedRequest(routing);

      // Write blocked response
      const writer = new ResponseWriter(res);
      writer.writeBlocked(routing.blockResponse!, routing.blockStatusCode);
      return;
    }

    log.info(
      `${routing.method} ${path} -> [${routing.isRouted ? "ROUTE" : "PASSTHROUGH"}] ${routing.provider.id} (${routing.provider.name})` +
        ` [client:${routing.clientSurface} upstream:${routing.provider.providerType}]` +
        (routing.isOpenAIProvider ? " [OpenAI]" : "")
    );

    // Stage 2: Collect request body
    this.collectBody(req, routing, requestReceiveStart, res);
  }

  /**
   * Collect request body and continue processing
   */
  private collectBody(
    req: http.IncomingMessage,
    routing: RoutingContext,
    requestReceiveStart: number,
    res: http.ServerResponse
  ): void {
    let bodyChunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      bodyChunks.push(chunk);
    });

    req.on("end", () => {
      const bodyReceiveTime = Date.now() - requestReceiveStart;

      // Build raw body
      const rawBody = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : Buffer.alloc(0);

      if (bodyChunks.length > 0) {
        log.info(
          `[Perf] RequestBodyReceived: ${rawBody.length} bytes in ${bodyReceiveTime}ms from client`
        );
      }

      // Stage 2.5: Service interceptors (e.g. web search) — registry is generic; no capability names here
      if (routing.method === "POST" && rawBody.length > 0) {
        void (async () => {
          try {
            const intercepted = await this.interceptorRegistry.tryIntercept(
              rawBody,
              routing.clientSurface,
              routing.provider.id
            );
            if (intercepted) {
              if (res.writableEnded) {
                return;
              }
              this.completeInterceptedRequest(
                rawBody,
                routing,
                requestReceiveStart,
                res,
                intercepted
              );
              return;
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error(`[Interceptor] execution failed: ${errMsg}`);
            if (res.writableEnded) {
              return;
            }
            const writer = new ResponseWriter(res);
            writer.writeError(`Service interceptor failed: ${errMsg}`, 502);
            return;
          }

          this.continueProcessing(rawBody, routing, requestReceiveStart, bodyReceiveTime, res);
        })();
        return;
      }

      this.continueProcessing(rawBody, routing, requestReceiveStart, bodyReceiveTime, res);
    });
  }

  /**
   * Two-phase logging + response write for locally handled interceptor results.
   */
  private completeInterceptedRequest(
    rawBody: Buffer,
    routing: RoutingContext,
    requestReceiveStart: number,
    res: http.ServerResponse,
    intercepted: InterceptResult
  ): void {
    const clientId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const logFields = buildRawBodyLogSnapshot(rawBody, this.database.enabled);
    const bodyResult: BodyProcessResult = {
      body: rawBody,
      originalModel: undefined,
      originalRequestBody: logFields.originalRequestBody,
      requestBodyLog: logFields.requestBodyLog,
    };

    this.taskExecutor.insertPendingLog(routing, bodyResult, clientId, {
      routeType: intercepted.routeType,
      targetUrl: "service",
    });

    const responseWriter = new ResponseWriter(res);
    responseWriter.writeRaw(intercepted.statusCode, intercepted.headers, intercepted.body);

    const duration = Date.now() - requestReceiveStart;

    this.responseLogger.logResponse(
      clientId,
      duration,
      intercepted.statusCode,
      [Buffer.from(intercepted.body, "utf-8")],
      undefined,
      intercepted.body,
      duration,
      intercepted.tokens
    );
  }

  /**
   * Continue normal request processing after body collection (or interceptor fallback).
   */
  private continueProcessing(
    rawBody: Buffer,
    routing: RoutingContext,
    requestReceiveStart: number,
    bodyReceiveTime: number,
    res: http.ServerResponse
  ): void {
    // Stage 3: Body processing - smart routing, model mapping, protocol conversion
    const clientBody = rawBody;
    const smartRouted = this.smartRoutingStage.process(routing, rawBody);
    const bodyResult = this.bodyProcessor.process(
      smartRouted.body,
      smartRouted.routing,
      true // databaseEnabled
    );

    if (smartRouted.routing.smartRoutingClientModel !== undefined) {
      bodyResult.originalModel = smartRouted.routing.smartRoutingClientModel;
      if (this.database.enabled && clientBody.length > 0) {
        try {
          bodyResult.originalRequestBody = clientBody.toString("utf-8");
        } catch {
          // keep bodyProcessor snapshot
        }
      }
    }

    // Generate client ID
    const clientId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Stage 4: Execute task (queue or direct)
    const responseWriter = new ResponseWriter(res);
    this.taskExecutor.execute(
      smartRouted.routing,
      bodyResult,
      clientId,
      requestReceiveStart,
      bodyReceiveTime,
      responseWriter
    );
  }

  /**
   * Log blocked request to database
   */
  private logBlockedRequest(_routing: ReturnType<RouterStage["process"]>): void {
    // Database logging would be handled here if needed
    // For now, simplified - can be extended
  }
}
