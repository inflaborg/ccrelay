/**
 * Logs API endpoint
 * GET /ccrelay/api/logs - List logs
 * GET /ccrelay/api/logs/:id - Get log detail
 * POST /ccrelay/api/logs/batch - Full log bodies for selected IDs
 * DELETE /ccrelay/api/logs - Delete logs
 */

import * as http from "http";
import { getDatabase } from "../database";
import type { LogFilter, RequestLog } from "../database";
import { sendJson, parseJsonBody } from "./index";
import { rejectLogStorageApiIfNotLeader } from "./serverRef";
import { ScopedLogger } from "../utils/logger";

const log = new ScopedLogger("API:Logs");

/** Max IDs accepted by POST /logs/batch (full bodies). */
export const MAX_LOG_BATCH_IDS = 100;

function parseOptionalInt(value: string | null): number | undefined {
  if (value === null || value === "") {
    return undefined;
  }
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Handle GET /ccrelay/api/logs
 * Query params: limit, offset, providerId, method, pathPattern, hasError,
 *   startTime, endTime, minDuration, maxDuration
 */
export async function handleLogs(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _params: Record<string, string>
): Promise<void> {
  if (rejectLogStorageApiIfNotLeader(res)) {
    return;
  }

  log.info(`[handleLogs] Called - url=${req.url}, method=${req.method}`);

  const db = getDatabase();

  if (!db.enabled || !db.logsEnabled) {
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
  const startTime = parseOptionalInt(url.searchParams.get("startTime"));
  const endTime = parseOptionalInt(url.searchParams.get("endTime"));
  const minDuration = parseOptionalInt(url.searchParams.get("minDuration"));
  const maxDuration = parseOptionalInt(url.searchParams.get("maxDuration"));

  const filter: LogFilter = {
    limit,
    offset,
    providerId,
    method,
    pathPattern,
    hasError,
    startTime,
    endTime,
    minDuration,
    maxDuration,
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
  if (rejectLogStorageApiIfNotLeader(res)) {
    return;
  }

  const db = getDatabase();

  if (!db.enabled || !db.logsEnabled) {
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
 * Handle POST /ccrelay/api/logs/batch
 * Body: { ids: number[] }
 */
export async function handleLogsBatch(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (rejectLogStorageApiIfNotLeader(res)) {
    return;
  }

  const db = getDatabase();

  if (!db.enabled || !db.logsEnabled) {
    sendJson(res, 200, { logs: [] });
    return;
  }

  try {
    const data = await parseJsonBody<{ ids?: unknown }>(req);
    if (!Array.isArray(data.ids)) {
      sendJson(res, 400, { error: "ids must be an array of log IDs" });
      return;
    }

    const uniqueIds: number[] = [];
    const seen = new Set<number>();
    for (const raw of data.ids) {
      const id = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
      if (!Number.isInteger(id) || id <= 0 || seen.has(id)) {
        continue;
      }
      seen.add(id);
      uniqueIds.push(id);
      if (uniqueIds.length >= MAX_LOG_BATCH_IDS) {
        break;
      }
    }

    const logs: RequestLog[] = [];
    for (const id of uniqueIds) {
      const entry = await db.getLogById(id);
      if (entry) {
        logs.push(entry);
      }
    }

    log.info(`[handleLogsBatch] Returning ${logs.length} of ${uniqueIds.length} requested log(s)`);
    sendJson(res, 200, { logs });
  } catch (err) {
    log.error("Error processing logs batch request", err);
    sendJson(res, 400, { error: "Invalid JSON in request body" });
  }
}

/**
 * Handle DELETE /ccrelay/api/logs
 * Body: { ids?: number[], clearAll?: boolean }
 */
export async function handleDeleteLogs(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (rejectLogStorageApiIfNotLeader(res)) {
    return;
  }

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
      sendJson(res, 200, { success: true });
      return;
    }

    if (!db.logsEnabled) {
      sendJson(res, 200, { success: true });
      return;
    }

    if (data.ids && data.ids.length > 0) {
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
