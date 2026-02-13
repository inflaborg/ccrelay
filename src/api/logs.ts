/**
 * Logs API endpoint
 * GET /ccrelay/api/logs - List logs
 * GET /ccrelay/api/logs/:id - Get log detail
 * DELETE /ccrelay/api/logs - Delete logs
 */

import * as http from "http";
import { getDatabase } from "../database";
import type { LogFilter } from "../database";
import { sendJson, parseJsonBody } from "./index";
import { ScopedLogger } from "../utils/logger";

const log = new ScopedLogger("API:Logs");

/**
 * Handle GET /ccrelay/api/logs
 * Query params: limit, offset, providerId, method, pathPattern, hasError
 */
export async function handleLogs(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _params: Record<string, string>
): Promise<void> {
  log.info(`[handleLogs] Called - url=${req.url}, method=${req.method}`);

  const db = getDatabase();

  if (!db.enabled) {
    sendJson(res, 200, {
      logs: [],
      total: 0,
      hasMore: false,
    });
    return;
  }

  // Parse query parameters
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const providerId = url.searchParams.get("providerId") || undefined;
  const method = url.searchParams.get("method") || undefined;
  const pathPattern = url.searchParams.get("pathPattern") || undefined;
  const hasError = url.searchParams.get("hasError") === "true" ? true : undefined;

  const filter: LogFilter = {
    limit,
    offset,
    providerId,
    method,
    pathPattern,
    hasError,
  };

  const result = await db.queryLogs(filter);

  log.info(`[handleLogs] Returning ${result.logs.length} logs, total=${result.total}`);

  sendJson(res, 200, {
    logs: result.logs,
    total: result.total,
    hasMore: (offset || 0) + result.logs.length < result.total,
  });
}

/**
 * Handle GET /ccrelay/api/logs/:id
 */
export async function handleLogDetail(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>
): Promise<void> {
  const db = getDatabase();

  if (!db.enabled) {
    sendJson(res, 200, { log: null });
    return;
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    sendJson(res, 400, { error: "Invalid log ID" });
    return;
  }

  const logEntry = await db.getLogById(id);
  sendJson(res, 200, { log: logEntry });
}

/**
 * Handle DELETE /ccrelay/api/logs
 * Body: { ids?: number[], clearAll?: boolean }
 */
export async function handleDeleteLogs(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const db = getDatabase();

  if (!db.enabled) {
    sendJson(res, 200, { success: true });
    return;
  }

  try {
    const data = await parseJsonBody<{ ids?: number[]; clearAll?: boolean }>(req);

    if (data.clearAll) {
      await db.clearAllLogs();
      log.info("Cleared all logs via API");
    } else if (data.ids && data.ids.length > 0) {
      await db.deleteLogs(data.ids);
      log.info(`Deleted ${data.ids.length} log(s) via API`);
    }

    sendJson(res, 200, { success: true });
  } catch (err) {
    log.error("Error processing delete logs request", err);
    sendJson(res, 400, { error: "Invalid JSON in request body" });
  }
}

/**
 * Handle DELETE /ccrelay/api/logs (clear all alias)
 */
export async function handleClearLogs(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  return handleDeleteLogs(req, res);
}
