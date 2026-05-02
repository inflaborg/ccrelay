/**
 * Switch Provider API endpoint
 * POST /ccrelay/api/switch
 */

import * as http from "http";
import type { ProxyServer } from "../server/handler";
import type { SwitchResponse } from "../types";
import { sendJson, parseJsonBody } from "./index";
import { ScopedLogger } from "../utils/logger";

const log = new ScopedLogger("API:Switch");

let serverInstance: ProxyServer | null = null;

/**
 * Set the server instance (called from extension.ts)
 */
export function setServer(server: ProxyServer): void {
  serverInstance = server;
}

/**
 * Handle POST /ccrelay/api/switch
 */
export async function handleSwitchProvider(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _params: Record<string, string>
): Promise<void> {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }

  try {
    const data = await parseJsonBody<{ provider: string }>(req);
    const providerId = data.provider;

    if (!providerId) {
      const error: SwitchResponse = {
        status: "error",
        message: "Missing provider field in request body",
      };
      sendJson(res, 400, error);
      return;
    }

    const router = serverInstance.getRouter();
    const config = serverInstance.getConfig();
    const success = await router.switchProvider(providerId);

    if (success) {
      const provider = router.getCurrentProvider();
      log.info(`Switched to provider: ${providerId} (${provider?.name})`);
      const response: SwitchResponse = {
        status: "ok",
        provider: providerId,
        name: provider?.name,
      };
      sendJson(res, 200, response);
    } else {
      log.warn(`Failed to switch to provider: ${providerId}`);
      const error: SwitchResponse = {
        status: "error",
        message: `Provider '${providerId}' not found`,
        available: Object.keys(config.providers),
      };
      sendJson(res, 404, error);
    }
  } catch (err) {
    log.error("Error processing switch request", err);
    const error: SwitchResponse = {
      status: "error",
      message: "Invalid JSON in request body",
    };
    sendJson(res, 400, error);
  }
}
