/**
 * Settings API — read and patch YAML config sections
 * GET /ccrelay/api/config
 * PATCH /ccrelay/api/config
 */

import * as http from "http";
import type { ProxyServer } from "../server/handler";
import { getDefaultRoutingSettings } from "../config";
import { sendJson, parseJsonBody } from "./index";

let serverInstance: ProxyServer | null = null;

export function setServer(server: ProxyServer): void {
  serverInstance = server;
}

function serverPatchRequiresRestart(
  data: Record<string, unknown>,
  configManager: { getConfigRawForApi(): Record<string, unknown> }
): boolean {
  const current =
    (configManager.getConfigRawForApi().server as Record<string, unknown> | undefined) ?? {};
  if ("port" in data && data.port !== undefined && data.port !== current.port) {
    return true;
  }
  if ("host" in data && data.host !== undefined && data.host !== current.host) {
    return true;
  }
  if ("autoStart" in data && data.autoStart !== undefined && data.autoStart !== current.autoStart) {
    return true;
  }
  return false;
}

const ALLOWED_SECTIONS = new Set([
  "logging",
  "concurrency",
  "server",
  "routing",
  "webSearch",
  "smartRouting",
  "clientVersionDetection",
]);

/**
 * GET /ccrelay/api/config
 * Returns YAML settings sections (raw, no env-var expansion) plus `routingDefaults`:
 * bundled forward/block for the Settings UI (“restore defaults” preview before Save).
 */
export function handleGetConfig(_req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }
  const configManager = serverInstance.getConfig();
  try {
    const raw = configManager.getConfigRawForApi();
    const bundled = getDefaultRoutingSettings();
    sendJson(res, 200, {
      ...raw,
      routingDefaults: { forward: bundled.forward, block: bundled.block },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: msg });
  }
}

/**
 * PATCH /ccrelay/api/config
 * Body: `{ section, data }` to deep-merge into that section (except routing reset below).
 * Use `{ section: "routing", resetRoutingDefaults: true }` to replace `forward` + `block` with
 * bundled defaults (no `data` required).
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
      resetRoutingDefaults?: boolean;
    }>(req);

    const section = body.section;
    if (!section || !ALLOWED_SECTIONS.has(section)) {
      sendJson(res, 400, {
        status: "error",
        message: `section must be one of: ${[...ALLOWED_SECTIONS].join(", ")}`,
      });
      return;
    }

    const configManager = serverInstance.getConfig();

    if (section === "routing" && body.resetRoutingDefaults === true) {
      const def = getDefaultRoutingSettings();
      const routingPayload: Record<string, unknown> = {
        forward: def.forward,
        block: def.block,
      };
      const result = configManager.updateConfigSection("routing", routingPayload, { merge: false });

      if (!result.ok) {
        sendJson(res, 500, { status: "error", message: result.error });
        return;
      }
      sendJson(res, 200, { status: "ok", restartRequired: false });
      return;
    }

    if (!body.data || typeof body.data !== "object") {
      sendJson(res, 400, { status: "error", message: "data is required" });
      return;
    }

    const restartRequired =
      section === "logging" ||
      (section === "server" && serverPatchRequiresRestart(body.data, configManager));

    const result = configManager.updateConfigSection(
      section as
        | "logging"
        | "concurrency"
        | "server"
        | "routing"
        | "webSearch"
        | "smartRouting"
        | "clientVersionDetection",
      body.data
    );

    if (!result.ok) {
      sendJson(res, 500, { status: "error", message: result.error });
      return;
    }

    sendJson(res, 200, { status: "ok", restartRequired });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { status: "error", message: msg });
  }
}
