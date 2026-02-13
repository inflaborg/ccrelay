/**
 * Providers API endpoint
 * GET /ccrelay/api/providers
 */

import * as http from "http";
import type { ProxyServer } from "../server/handler";
import type { ProvidersResponse } from "../types";
import { sendJson } from "./index";

let serverInstance: ProxyServer | null = null;

/**
 * Set the server instance (called from extension.ts)
 */
export function setServer(server: ProxyServer): void {
  serverInstance = server;
}

/**
 * Handle GET /ccrelay/api/providers
 */
export function handleListProviders(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _params: Record<string, string>
): void {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }

  const router = serverInstance.getRouter();
  const config = serverInstance.getConfig();
  const currentId = router.getCurrentProviderId();

  const providers = config.enabledProviders.map(p => ({
    id: p.id,
    name: p.name,
    mode: p.mode,
    providerType: p.providerType,
    active: p.id === currentId,
  }));

  const response: ProvidersResponse = {
    providers,
    current: currentId,
  };

  sendJson(res, 200, response);
}
