/**
 * Status API endpoint
 * GET /ccrelay/api/status
 */

import * as http from "http";
import type { ProxyServer } from "../server/handler";
import type { RouterStatus } from "../types";
import { sendJson } from "./index";

let serverInstance: ProxyServer | null = null;

/**
 * Set the server instance (called from extension.ts)
 */
export function setServer(server: ProxyServer): void {
  serverInstance = server;
}

/**
 * Handle GET /ccrelay/api/status
 */
export function handleStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _params: Record<string, string>
): void {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }

  const router = serverInstance.getRouter();
  const provider = router.getCurrentProvider();
  const config = serverInstance.getConfig();

  const status: RouterStatus = {
    status: serverInstance.running ? "running" : "stopped",
    currentProvider: router.getCurrentProviderId(),
    providerName: provider?.name,
    providerMode: provider?.mode,
    port: config.port,
  };

  sendJson(res, 200, status);
}
