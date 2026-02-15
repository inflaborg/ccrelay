/**
 * Request Handler - coordinates all request processing stages
 */

import type * as http from "http";
import type * as url from "url";
import type { Router } from "../router";
import type { QueueManager } from "../queueManager";
import type { ProxyExecutor } from "../proxy/executor";
import type { LogDatabase } from "../../database";
import { RouterStage } from "./routerStage";
import { BodyProcessor } from "./bodyProcessor";
import { TaskExecutor } from "./taskExecutor";
import { ResponseWriter } from "../response";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("RequestHandler");

/**
 * RequestHandler coordinates all stages of request processing
 */
export class RequestHandler {
  private routerStage: RouterStage;
  private bodyProcessor: BodyProcessor;
  private taskExecutor: TaskExecutor;

  constructor(
    router: Router,
    queueManager: QueueManager,
    proxyExecutor: ProxyExecutor,
    database: LogDatabase
  ) {
    this.routerStage = new RouterStage(router);
    this.bodyProcessor = new BodyProcessor();
    this.taskExecutor = new TaskExecutor(queueManager, proxyExecutor, database);
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
    routing: ReturnType<RouterStage["process"]>,
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

      // Stage 3: Body processing - apply model mapping and OpenAI conversion
      const bodyResult = this.bodyProcessor.process(
        rawBody,
        routing,
        true // databaseEnabled
      );

      // Generate client ID
      const clientId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      // Stage 4: Execute task (queue or direct)
      const responseWriter = new ResponseWriter(res);
      this.taskExecutor.execute(
        routing,
        bodyResult,
        clientId,
        requestReceiveStart,
        bodyReceiveTime,
        responseWriter
      );
    });
  }

  /**
   * Log blocked request to database
   */
  private logBlockedRequest(_routing: ReturnType<RouterStage["process"]>): void {
    // Database logging would be handled here if needed
    // For now, simplified - can be extended
  }
}
