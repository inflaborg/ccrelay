/**
 * Web search / fetch API for Chat Agent and other callers.
 * GET  /ccrelay/api/web-search — availability (no secrets)
 * POST /ccrelay/api/web-search — run a search query
 * POST /ccrelay/api/web-fetch  — fetch URL content (Tavily Extract or direct)
 */

import * as http from "http";
import type { ProxyServer } from "../server/handler";
import { sendJson, parseJsonBody } from "./httpJson";
import {
  isWebSearchBackendReady,
  isWebSearchFeatureEnabled,
  resolveWebFetchBackend,
  resolveWebSearchBackendName,
  runPlainWebSearch,
  runWebFetch,
} from "../services/web-search";
import { ScopedLogger } from "../utils/logger";

const log = new ScopedLogger("API:WebSearch");

let serverInstance: ProxyServer | null = null;

export function setServer(server: ProxyServer): void {
  serverInstance = server;
}

function getWebSearchConfig() {
  if (!serverInstance) {
    return undefined;
  }
  return serverInstance.getConfig().webSearchConfig;
}

/** Fetch tool is offered whenever the Capabilities web-search feature is enabled. */
function isWebFetchAvailable(): boolean {
  return isWebSearchFeatureEnabled(getWebSearchConfig());
}

/**
 * GET /ccrelay/api/web-search
 * { available, backend?, fetchAvailable?, fetchBackend? }
 */
export function handleWebSearchStatus(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const config = getWebSearchConfig();
  const available = isWebSearchBackendReady(config);
  const fetchAvailable = isWebFetchAvailable();
  sendJson(res, 200, {
    available,
    enabled: available,
    backend: available ? resolveWebSearchBackendName(config) : undefined,
    fetchAvailable,
    fetchBackend: fetchAvailable ? resolveWebFetchBackend(config) : undefined,
  });
}

/**
 * POST /ccrelay/api/web-search
 * Body: { query: string }
 */
export async function handleWebSearch(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const config = getWebSearchConfig();
  if (!isWebSearchBackendReady(config) || !config) {
    sendJson(res, 503, {
      error: "Web search is not configured. Enable it and set an API key in Capabilities.",
      available: false,
    });
    return;
  }

  let body: { query?: string };
  try {
    body = await parseJsonBody<{ query?: string }>(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    sendJson(res, 400, { error: "query is required" });
    return;
  }
  if (query.length > 2000) {
    sendJson(res, 400, { error: "query is too long (max 2000 characters)" });
    return;
  }

  try {
    const result = await runPlainWebSearch(query, config);
    const backend = resolveWebSearchBackendName(config);
    log.info(`[web-search] agent query="${query.slice(0, 80)}" results=${result.results.length}`);
    sendJson(res, 200, {
      available: true,
      backend,
      query,
      answer: result.answer,
      results: result.results.map(r => ({
        title: r.title,
        url: r.url,
        content: r.content.length > 2000 ? `${r.content.slice(0, 2000)}…` : r.content,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[web-search] search failed", err);
    sendJson(res, 502, { error: message, available: true });
  }
}

/**
 * POST /ccrelay/api/web-fetch
 * Body: { url: string, query?: string }
 */
export async function handleWebFetch(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const config = getWebSearchConfig();
  if (!isWebFetchAvailable()) {
    sendJson(res, 503, {
      error: "Web fetch is not available. Enable web search in Capabilities.",
      available: false,
    });
    return;
  }

  let body: { url?: string; query?: string };
  try {
    body = await parseJsonBody<{ url?: string; query?: string }>(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    sendJson(res, 400, { error: "url is required" });
    return;
  }

  const query = typeof body.query === "string" ? body.query.trim() : undefined;

  try {
    const result = await runWebFetch(url, config, query ? { query } : undefined);
    log.info(
      `[web-fetch] backend=${result.backend} url=${url.slice(0, 80)} truncated=${result.truncated}`
    );
    sendJson(res, 200, {
      available: true,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[web-fetch] failed", err);
    sendJson(res, 502, { error: message, available: true });
  }
}
