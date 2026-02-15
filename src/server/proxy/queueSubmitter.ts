/**
 * Queue submitter - handles submitting tasks to the queue and managing client disconnects
 */

/* eslint-disable @typescript-eslint/naming-convention */
// HTTP headers use hyphenated names (Content-Type, etc.)

import type http from "http";
import type { ConcurrencyManager } from "../../queue";
import type { RequestTask, ProxyResult } from "../../types";
import type { LogDatabase, RequestStatus } from "../../database";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("QueueSubmitter");

/**
 * Result of queue submission
 */
export type QueueSubmissionResult = {
  /** Task was submitted to queue */
  submitted: true;
  /** Promise that resolves when task completes */
  promise: Promise<ProxyResult>;
  /** Cleanup function to call when response is done */
  cleanup: () => void;
} | {
  /** Task was not submitted (no queue available) */
  submitted: false;
};

/**
 * Options for queue submission
 */
export interface QueueSubmitOptions {
  task: RequestTask;
  queue: ConcurrencyManager;
  queueName: string;
  clientRes: http.ServerResponse;
  bodyReceiveTime: number;
  database: LogDatabase;
  onResult: (result: ProxyResult, clientDisconnected: boolean) => void;
  onError: (err: Error, clientDisconnected: boolean) => void;
}

/**
 * Submit a task to the queue with client disconnect handling
 */
export function submitToQueue(options: QueueSubmitOptions): QueueSubmissionResult {
  const { task, queue, queueName, clientRes, bodyReceiveTime, database, onResult, onError } = options;
  const clientId = task.clientId;

  log.info(
    `[Perf:${clientId}] TaskSubmit: submitting to queue "${queueName}" (body ready in ${bodyReceiveTime}ms)`
  );

  // Track if client disconnected while queuing
  let clientDisconnected = false;

  const onClientDisconnect = () => {
    if (!clientDisconnected) {
      clientDisconnected = true;
      task.cancelled = true;
      task.cancelledReason = "Client disconnected while queuing";
      log.info(`[${clientId}] Client disconnected, marking task as cancelled`);
      // Try to cancel from queue
      queue.cancelTask(clientId, "Client disconnected");
    }
  };

  // Listen for client disconnect
  clientRes.on("close", onClientDisconnect);

  const promise = queue.submit(task);

  promise
    .then(result => {
      // Clean up listeners
      clientRes.off("close", onClientDisconnect);

      onResult(result, clientDisconnected);
    })
    .catch(err => {
      // Clean up listeners
      clientRes.off("close", onClientDisconnect);

      // Update request log status based on error type
      const totalTime = Date.now() - task.createdAt;
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn(`Task ${task.id} rejected from queue "${queueName}": ${errMsg}`);

      if (database.enabled) {
        let logStatus: RequestStatus = "cancelled";
        if (errMsg.includes("timeout")) {
          logStatus = "timeout";
        }
        database.updateLogStatus(clientId, logStatus, 503, totalTime, errMsg);
      }

      // Convert to Error if not already
      const error = err instanceof Error ? err : new Error(String(err));
      onError(error, clientDisconnected);
    });

  return {
    submitted: true,
    promise,
    cleanup: () => {
      clientRes.off("close", onClientDisconnect);
    },
  };
}

/**
 * Write proxy result to client response
 */
export function writeProxyResultToResponse(
  result: ProxyResult,
  res: http.ServerResponse,
  clientId: string
): void {
  // Check if client disconnected
  if (res.writableEnded) {
    log.info(
      `[Perf:${clientId}] TaskComplete: client disconnected, skipping response (status: ${result.statusCode})`
    );
    return;
  }

  // Write response from result
  if (result.error) {
    // This is a logic error that happened during execution
    const errMsg = result.error.message;
    log.error(`Task ${clientId} failed: ${errMsg}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: errMsg }));
    }
    return;
  }

  // If streaming was already handled, skip writing response
  if (result.streamed) {
    log.info(`[Perf:${clientId}] TaskComplete: streaming done`);
    return;
  }

  // Success response (non-streaming)
  const responseHeaders = result.headers as Record<string, string | number | string[]>;
  res.writeHead(result.statusCode, responseHeaders);

  if (result.body) {
    res.end(result.body);
  } else {
    res.end();
  }
  log.info(`[Perf:${clientId}] TaskComplete: non-streaming done`);
}

/**
 * Write queue error to client response
 */
export function writeQueueErrorToResponse(
  err: Error,
  res: http.ServerResponse,
  clientDisconnected: boolean
): void {
  const errMsg = err instanceof Error ? err.message : String(err);

  // Don't write if client disconnected
  if (!clientDisconnected && !res.headersSent && !res.writableEnded) {
    // 503 Service Unavailable is appropriate for queue full/timeout
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: errMsg, code: "QUEUE_FULL_OR_TIMEOUT" }));
  }
}
