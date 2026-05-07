/**
 * Stats API endpoint
 * GET /ccrelay/api/stats?range=1d|7d|30d|all
 */

import * as http from "http";
import { getDatabase } from "../database";
import { sendJson } from "./index";
import { rejectLogStorageApiIfNotLeader } from "./serverRef";

export async function handleStats(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _params: Record<string, string>
): Promise<void> {
  if (rejectLogStorageApiIfNotLeader(res)) {
    return;
  }

  const db = getDatabase();

  if (!db.enabled) {
    sendJson(res, 200, {
      totalLogs: 0,
      successCount: 0,
      errorCount: 0,
      avgDuration: 0,
      byProvider: {},
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheTokens: 0,
      cacheHitRate: 0,
      avgTtfb: 0,
      outputTps: 0,
      outputTpsSampleCount: 0,
      p50Duration: 0,
      p90Duration: 0,
      providerBreakdown: [],
    });
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const range = url.searchParams.get("range") || "all";

  let since: number | undefined;
  const now = Date.now();
  if (range === "1d") {
    since = now - 24 * 60 * 60 * 1000;
  } else if (range === "7d") {
    since = now - 7 * 24 * 60 * 60 * 1000;
  } else if (range === "30d") {
    since = now - 30 * 24 * 60 * 60 * 1000;
  }

  const stats = await db.getStats(since ? { since } : undefined);
  sendJson(res, 200, stats);
}
