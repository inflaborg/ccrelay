/**
 * Task Executor - handles task execution via queue or direct
 */

import type * as http from "http";
import type { RequestTask, ProxyResult } from "../../types";
import type { RoutingContext, BodyProcessResult } from "./context";
import type { ResponseWriter } from "../response";
import type { LogDatabase, RequestStatus, RouteType } from "../../database";
import type { QueueManager } from "../queueManager";
import type { ProxyExecutor } from "../proxy/executor";
import { ScopedLogger } from "../../utils/logger";
import { extractModelFromPartialJson, serializeServiceMeta } from "../../database/shared-utils";
import { maskHeadersForLog } from "../headerMask";

const log = new ScopedLogger("TaskExecutor");

/**
 * TaskExecutor handles submitting tasks to queue or executing directly
 */
export class TaskExecutor {
  constructor(
    private queueManager: QueueManager,
    private proxyExecutor: ProxyExecutor,
    private database: LogDatabase
  ) {}

  /**
   * Execute request - chooses queue or direct based on configuration
   */
  execute(
    routing: RoutingContext,
    bodyResult: BodyProcessResult,
    clientId: string,
    requestReceiveStart: number,
    bodyReceiveTime: number,
    responseWriter: ResponseWriter
  ): void {
    // Build the task
    const task = this.buildTask(routing, bodyResult, clientId, responseWriter.response);
    task.requestReceiveStart = requestReceiveStart;

    // Check if queue is configured for this path
    const queueInfo = this.queueManager.getQueueForPath(routing.path);

    if (queueInfo) {
      this.submitToQueue(
        task,
        queueInfo.queue,
        queueInfo.name,
        clientId,
        requestReceiveStart,
        bodyReceiveTime,
        responseWriter
      );
    } else {
      this.executeDirect(task, clientId, requestReceiveStart, responseWriter);
    }
  }

  /**
   * Build RequestTask from routing and body result
   */
  buildTask(
    routing: RoutingContext,
    bodyResult: BodyProcessResult,
    clientId: string,
    res: http.ServerResponse
  ): RequestTask {
    return {
      id: clientId,
      method: routing.method,
      targetUrl: routing.targetUrl,
      headers: routing.headers,
      body: bodyResult.body,
      provider: routing.provider,
      inboundPath: routing.path,
      requestPath: routing.targetPath,
      requestBodyLog: bodyResult.requestBodyLog,
      originalRequestBody: bodyResult.originalRequestBody,
      isOpenAIProvider: routing.isOpenAIProvider,
      clientSurface: routing.clientSurface,
      originalModel: bodyResult.originalModel,
      clientId,
      createdAt: Date.now(),
      priority: 0,
      res,
      ...(bodyResult.responsesStreamRequested ? { responsesStreamRequested: true } : {}),
      ...(bodyResult.streamRequested ? { streamRequested: true } : {}),
      ...(bodyResult.originalResponsesEcho !== undefined
        ? { originalResponsesEcho: bodyResult.originalResponsesEcho }
        : {}),
      ...(bodyResult.hasHostedWebSearch ? { hasHostedWebSearch: true } : {}),
      ...(bodyResult.upstreamResponseFormat !== undefined
        ? { upstreamResponseFormat: bodyResult.upstreamResponseFormat }
        : {}),
    };
  }

  /**
   * Insert pending log to database
   */
  insertPendingLog(
    routing: RoutingContext,
    bodyResult: BodyProcessResult,
    clientId: string,
    options?: {
      routeType?: RouteType;
      targetUrl?: string;
      serviceHandler?: string;
      serviceMeta?: Record<string, unknown>;
      /** Upstream-bound request headers (sensitive values masked before storage). */
      requestHeaders?: Record<string, string>;
    }
  ): void {
    if (!this.database.enabled) {
      return;
    }

    const routeType: RouteType =
      options?.routeType ?? (routing.isRouted ? "router" : "passthrough");

    const upstreamModel =
      (bodyResult.requestBodyLog
        ? extractModelFromPartialJson(bodyResult.requestBodyLog)
        : undefined) ??
      (bodyResult.originalRequestBody
        ? extractModelFromPartialJson(bodyResult.originalRequestBody)
        : undefined) ??
      bodyResult.originalModel;

    this.database.insertLogPending({
      timestamp: Date.now(),
      providerId: routing.provider.id,
      providerName: routing.provider.name,
      method: routing.method,
      path: routing.targetPath || routing.path,
      targetUrl: options?.targetUrl ?? routing.targetUrl,
      requestBody: bodyResult.requestBodyLog,
      originalRequestBody: bodyResult.originalRequestBody,
      requestHeaders: maskHeadersForLog(options?.requestHeaders),
      statusCode: undefined,
      duration: 0,
      success: false,
      clientId,
      status: "pending",
      routeType,
      serviceHandler: options?.serviceHandler,
      serviceMeta: serializeServiceMeta(options?.serviceMeta),
      model: upstreamModel,
    });
  }

  /**
   * Submit task to queue
   */
  private submitToQueue(
    task: RequestTask,
    targetQueue: {
      submit: (task: RequestTask) => Promise<ProxyResult>;
      cancelTask: (id: string, reason: string) => void;
    },
    queueName: string,
    clientId: string,
    requestReceiveStart: number,
    bodyReceiveTime: number,
    responseWriter: ResponseWriter
  ): void {
    log.info(
      `[Perf:${clientId}] TaskSubmit: submitting to queue "${queueName}" (body ready in ${bodyReceiveTime}ms)`
    );

    // Insert pending log
    this.insertPendingLog(
      {
        method: task.method,
        path: task.requestPath,
        provider: task.provider,
        targetUrl: task.targetUrl,
        isRouted: true,
      } as RoutingContext,
      {
        requestBodyLog: task.requestBodyLog,
        originalRequestBody: task.originalRequestBody,
      } as BodyProcessResult,
      clientId,
      { requestHeaders: task.headers }
    );

    // Track if client disconnected
    let clientDisconnected = false;

    // Register disconnect handler
    const cleanup = responseWriter.onClientDisconnect(clientId, () => {
      if (task.streamCompleted) {
        return;
      }
      if (!clientDisconnected) {
        clientDisconnected = true;
        task.cancelled = true;
        task.cancelledReason = "Client disconnected while queuing";
        targetQueue.cancelTask(clientId, "Client disconnected");
      }
    });

    // Submit to queue
    targetQueue
      .submit(task)
      .then(result => {
        cleanup();
        const totalTime = Date.now() - requestReceiveStart;

        if (!result.streamCompleted && (clientDisconnected || !responseWriter.isWritable())) {
          log.info(
            `[Perf:${clientId}] TaskComplete: client disconnected, skipping response (status: ${result.statusCode}, time: ${totalTime}ms)`
          );
          return;
        }

        responseWriter.write(result, clientId);
        log.info(`[Perf:${clientId}] TaskComplete: done in ${totalTime}ms`);
      })
      .catch(err => {
        cleanup();
        const totalTime = Date.now() - requestReceiveStart;

        // Handle error
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(`Task ${clientId} rejected from queue "${queueName}": ${errMsg}`);

        // Update log status
        if (this.database.enabled) {
          let logStatus: RequestStatus = "cancelled";
          if (errMsg.includes("timeout")) {
            logStatus = "timeout";
          }
          this.database.updateLogStatus(clientId, logStatus, 503, totalTime, errMsg);
        }

        // Write error response if client still connected
        if (!clientDisconnected && !responseWriter.headersSent()) {
          responseWriter.writeError(errMsg, 503, clientId);
        }
      });
  }

  /**
   * Execute task directly without queue
   */
  private executeDirect(
    task: RequestTask,
    clientId: string,
    requestReceiveStart: number,
    responseWriter: ResponseWriter
  ): void {
    // Insert pending log first
    this.insertPendingLog(
      {
        method: task.method,
        path: task.requestPath,
        provider: task.provider,
        targetUrl: task.targetUrl,
        isRouted: true,
      } as RoutingContext,
      {
        requestBodyLog: task.requestBodyLog,
        originalRequestBody: task.originalRequestBody,
      } as BodyProcessResult,
      clientId,
      { requestHeaders: task.headers }
    );

    // Execute directly
    this.proxyExecutor
      .execute(task)
      .then(result => {
        const totalTime = Date.now() - requestReceiveStart;
        responseWriter.write(result, clientId);
        log.info(`[Perf:${clientId}] DirectExecute: done in ${totalTime}ms`);
      })
      .catch(err => {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`Task ${clientId} direct execution failed: ${errMsg}`);
        responseWriter.writeError(errMsg, 502, clientId);
      });
  }
}
