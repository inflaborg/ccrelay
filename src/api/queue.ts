/**
 * Queue statistics API handler
 * GET /ccrelay/api/queue
 */

import * as http from "http";
import type { ProxyServer } from "../server/handler";
import type { QueueStats } from "../types";
import { sendJson } from "./index";

let serverInstance: ProxyServer | null = null;

/**
 * Set the server instance for queue stats handler
 */
export function setServer(server: ProxyServer): void {
  serverInstance = server;
}

/**
 * Handle GET /ccrelay/api/queue
 * Returns queue statistics if concurrency is enabled
 */
export function handleQueueStats(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- params kept for consistent API signature
  params: Record<string, string>
): void {
  // Only GET method is supported
  if ((req.method || "GET") !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not available" });
    return;
  }

  // Get queue stats from server
  const queueStats: QueueStats | null = serverInstance.getQueueStats?.() ?? null;

  if (queueStats === null) {
    // Concurrency is not enabled
    sendJson(res, 200, {
      enabled: false,
      message: "Concurrency control is not enabled",
    });
    return;
  }

  // Concurrency is enabled, return stats
  sendJson(res, 200, {
    enabled: true,
    ...queueStats,
  });
}

/**
 * Handle DELETE /ccrelay/api/queue
 * Clears the pending queue
 */
export function handleClearQueue(req: http.IncomingMessage, res: http.ServerResponse): void {
  // Only DELETE method is supported
  if ((req.method || "DELETE") !== "DELETE") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not available" });
    return;
  }

  // Clear the queue
  const cleared = serverInstance.clearQueue?.() ?? 0;

  sendJson(res, 200, {
    message: `Cleared ${cleared} pending tasks from queue`,
    cleared,
  });
}
