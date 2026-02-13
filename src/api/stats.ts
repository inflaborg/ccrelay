/**
 * Stats API endpoint
 * GET /ccrelay/api/stats
 */

import * as http from "http";
import { getDatabase } from "../database";
import { sendJson } from "./index";

/**
 * Handle GET /ccrelay/api/stats
 */
export async function handleStats(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _params: Record<string, string>
): Promise<void> {
  const db = getDatabase();

  if (!db.enabled) {
    sendJson(res, 200, {
      totalLogs: 0,
      successCount: 0,
      errorCount: 0,
      avgDuration: 0,
      byProvider: {},
    });
    return;
  }

  const stats = await db.getStats();
  sendJson(res, 200, stats);
}
