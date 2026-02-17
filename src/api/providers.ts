/**
 * Providers API endpoint
 * GET /ccrelay/api/providers
 * POST /ccrelay/api/providers
 * DELETE /ccrelay/api/providers/:id
 */

import * as http from "http";
import type { ProxyServer } from "../server/handler";
import type { ProvidersResponse, ProviderConfigInput, ModelMapEntry } from "../types";
import { sendJson, parseJsonBody } from "./index";

let serverInstance: ProxyServer | null = null;

/**
 * Set the server instance (called from extension.ts)
 */
export function setServer(server: ProxyServer): void {
  serverInstance = server;
}

/**
 * Mask API key for display (show first 4 and last 4 chars)
 */
function maskApiKey(apiKey: string | undefined): string | undefined {
  if (!apiKey) {
    return undefined;
  }
  if (apiKey.length <= 8) {
    return "************";
  }
  return `${apiKey.slice(0, 4)}************${apiKey.slice(-4)}`;
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

  // Return all providers (including disabled ones)
  const providers = Object.values(config.providers).map(p => ({
    id: p.id,
    name: p.name,
    mode: p.mode,
    providerType: p.providerType,
    baseUrl: p.baseUrl,
    active: p.id === currentId,
    enabled: p.enabled !== false,
    apiKey: maskApiKey(p.apiKey),
    modelMap: p.modelMap,
  }));

  const response: ProvidersResponse = {
    providers,
    current: currentId,
  };

  sendJson(res, 200, response);
}

/**
 * Handle POST /ccrelay/api/providers
 */
export async function handleAddProvider(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _params: Record<string, string>
): Promise<void> {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }

  try {
    const body = await parseJsonBody<AddProviderRequest>(req);

    if (!body.id || !body.name || !body.baseUrl || !body.providerType || !body.mode) {
      sendJson(res, 400, { status: "error", message: "Missing required fields" });
      return;
    }

    // Validate ID format (alphanumeric, underscore, hyphen)
    if (!/^[a-zA-Z0-9_-]+$/.test(body.id)) {
      sendJson(res, 400, {
        status: "error",
        message:
          "Invalid provider ID format. Only alphanumeric, underscore, and hyphen are allowed. Please delete and recreate with a valid ID.",
      });
      return;
    }

    const configManager = serverInstance.getConfig();
    const existingProvider = configManager.getProvider(body.id);

    // Build provider config - preserve existing apiKey when editing
    const providerConfig: ProviderConfigInput = {
      name: body.name,
      baseUrl: body.baseUrl,
      mode: body.mode,
      providerType: body.providerType,
      apiKey: body.apiKey || existingProvider?.apiKey,
      authHeader: body.authHeader,
      enabled: body.enabled ?? true,
      modelMap: body.modelMap,
      vlModelMap: body.vlModelMap,
      headers: body.headers,
    };

    const success = configManager.addProvider(body.id, providerConfig);

    if (success) {
      sendJson(res, 200, {
        status: "ok",
        provider: {
          id: body.id,
          name: body.name,
          mode: body.mode,
          providerType: body.providerType,
          baseUrl: body.baseUrl,
          active: false,
        },
      });
    } else {
      sendJson(res, 500, { status: "error", message: "Failed to add provider" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    sendJson(res, 500, { status: "error", message });
  }
}

/**
 * Handle DELETE /ccrelay/api/providers/:id
 */
export function handleDeleteProvider(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>
): void {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }

  const { id } = params;
  if (!id) {
    sendJson(res, 400, { status: "error", message: "Provider ID is required" });
    return;
  }

  const configManager = serverInstance.getConfig();
  const success = configManager.deleteProvider(id);

  if (success) {
    sendJson(res, 200, { status: "ok", message: `Provider "${id}" deleted` });
  } else {
    sendJson(res, 400, { status: "error", message: `Failed to delete provider "${id}"` });
  }
}

/**
 * Handle POST /ccrelay/api/reload
 */
export function handleReloadConfig(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _params: Record<string, string>
): void {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }

  try {
    const configManager = serverInstance.getConfig();
    configManager.reload();

    const providersCount = Object.keys(configManager.providers).length;

    sendJson(res, 200, {
      status: "ok",
      message: "Configuration reloaded",
      providersCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    sendJson(res, 500, { status: "error", message });
  }
}

interface AddProviderRequest {
  id: string;
  name: string;
  baseUrl: string;
  providerType: "anthropic" | "openai";
  mode: "passthrough" | "inject";
  apiKey?: string;
  authHeader?: string;
  enabled?: boolean;
  modelMap?: ModelMapEntry[];
  vlModelMap?: ModelMapEntry[];
  headers?: Record<string, string>;
}
