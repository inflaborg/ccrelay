/**
 * Settings API — read and patch YAML config sections
 * GET /ccrelay/api/config
 * PATCH /ccrelay/api/config
 */

import * as http from "http";
import type { ProxyServer } from "../server/handler";
import { sendJson, parseJsonBody } from "./index";

let serverInstance: ProxyServer | null = null;

export function setServer(server: ProxyServer): void {
  serverInstance = server;
}

const ALLOWED_SECTIONS = new Set(["logging", "concurrency", "server", "routing"]);

/**
 * GET /ccrelay/api/config
 * Returns the four settings sections from the YAML file (raw, no env-var expansion).
 */
export function handleGetConfig(_req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }
  const configManager = serverInstance.getConfig();
  try {
    const raw = configManager.getConfigRawForApi();
    sendJson(res, 200, raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: msg });
  }
}

/**
 * PATCH /ccrelay/api/config
 * Body: { section: "logging"|"concurrency"|"server"|"routing", data: {...} }
 */
export async function handlePatchConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }

  try {
    const body = await parseJsonBody<{
      section?: string;
      data?: Record<string, unknown>;
    }>(req);

    const section = body.section;
    if (!section || !ALLOWED_SECTIONS.has(section)) {
      sendJson(res, 400, {
        status: "error",
        message: `section must be one of: ${[...ALLOWED_SECTIONS].join(", ")}`,
      });
      return;
    }
    if (!body.data || typeof body.data !== "object") {
      sendJson(res, 400, { status: "error", message: "data is required" });
      return;
    }

    const configManager = serverInstance.getConfig();
    const result = configManager.updateConfigSection(
      section as "logging" | "concurrency" | "server" | "routing",
      body.data
    );

    if (!result.ok) {
      sendJson(res, 500, { status: "error", message: result.error });
      return;
    }

    const restartRequired = section === "server" || section === "logging";
    sendJson(res, 200, { status: "ok", restartRequired });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { status: "error", message: msg });
  }
}
