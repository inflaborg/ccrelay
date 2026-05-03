/**
 * Providers API endpoint
 * GET /ccrelay/api/providers
 * POST /ccrelay/api/providers
 * POST /ccrelay/api/providers/duplicate
 * DELETE /ccrelay/api/providers/:id
 */

import * as http from "http";
import type { ProxyServer } from "../server/handler";
import type { Provider, ProvidersResponse, ProviderConfigInput, ModelMapEntry } from "../types";
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
    modelMappingEnabled: p.modelMappingEnabled !== false,
    useCustomModelsList: Boolean(p.useCustomModelsList),
    customModelsList: p.useCustomModelsList ? (p.customModelsList ?? []) : undefined,
    openaiCompat: p.openaiCompat,
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
    const effectiveEnabled = body.id === "official" ? true : (body.enabled ?? true);
    const providerConfig: ProviderConfigInput = {
      name: body.name,
      baseUrl: body.baseUrl,
      mode: body.mode,
      providerType: body.providerType,
      apiKey: body.apiKey || existingProvider?.apiKey,
      authHeader: body.authHeader,
      enabled: effectiveEnabled,
      modelMap: body.modelMap,
      vlModelMap: body.vlModelMap,
      ...(body.modelMappingEnabled !== undefined
        ? { modelMappingEnabled: body.modelMappingEnabled }
        : {}),
      headers: body.headers,
      useCustomModelsList: body.useCustomModelsList === true,
      ...(body.useCustomModelsList === true
        ? { customModelsList: body.customModelsList ?? [] }
        : {}),
      ...(body.openaiCompat !== undefined ? { openaiCompat: body.openaiCompat } : {}),
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
  const router = serverInstance.getRouter();
  const wasActive = router.getCurrentProviderId() === id;
  const success = configManager.deleteProvider(id);

  if (success) {
    // If the deleted provider was active, switch to the default
    if (wasActive) {
      const fallbackId = configManager.defaultProvider;
      void router.switchProvider(fallbackId);
    }
    sendJson(res, 200, { status: "ok", message: `Provider "${id}" deleted` });
  } else {
    sendJson(res, 400, { status: "error", message: `Failed to delete provider "${id}"` });
  }
}

function buildDuplicateConfigFromProvider(source: Provider, name: string): ProviderConfigInput {
  const out: ProviderConfigInput = {
    name,
    baseUrl: source.baseUrl,
    mode: source.mode,
    providerType: source.providerType,
    apiKey: source.apiKey,
    authHeader: source.authHeader,
    modelMap: source.modelMap,
    vlModelMap: source.vlModelMap,
    ...(source.modelMappingEnabled !== undefined
      ? { modelMappingEnabled: source.modelMappingEnabled }
      : {}),
    headers: source.headers && Object.keys(source.headers).length > 0 ? source.headers : undefined,
    enabled: source.enabled,
  };
  if (source.useCustomModelsList) {
    out.useCustomModelsList = true;
    out.customModelsList = [...(source.customModelsList ?? [])];
  }
  if (source.openaiCompat !== undefined) {
    out.openaiCompat = source.openaiCompat;
  }
  return out;
}

/**
 * Handle POST /ccrelay/api/providers/duplicate
 * Copies a provider in memory + YAML (including apiKey). `newId` comes from the client body.
 */
export async function handleDuplicateProvider(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _params: Record<string, string>
): Promise<void> {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }

  try {
    const body = await parseJsonBody<{
      sourceId?: string;
      newId?: string;
      name?: string;
    }>(req);

    if (!body.sourceId || !body.newId || !body.name?.trim()) {
      sendJson(res, 400, { status: "error", message: "sourceId, newId, and name are required" });
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(body.newId)) {
      sendJson(res, 400, {
        status: "error",
        message: "Invalid newId format. Only alphanumeric, underscore, and hyphen are allowed.",
      });
      return;
    }

    if (body.newId === body.sourceId) {
      sendJson(res, 400, { status: "error", message: "newId must differ from sourceId" });
      return;
    }

    const configManager = serverInstance.getConfig();

    if (configManager.getProvider(body.newId)) {
      sendJson(res, 400, {
        status: "error",
        message: `Provider "${body.newId}" already exists`,
      });
      return;
    }

    const source = configManager.getProvider(body.sourceId);
    if (!source) {
      sendJson(res, 404, {
        status: "error",
        message: `Source provider "${body.sourceId}" not found`,
      });
      return;
    }

    const providerConfig = buildDuplicateConfigFromProvider(source, body.name.trim());
    const success = configManager.addProvider(body.newId, providerConfig);

    if (success) {
      sendJson(res, 200, {
        status: "ok",
        provider: {
          id: body.newId,
          name: body.name.trim(),
          mode: providerConfig.mode,
          providerType: providerConfig.providerType,
          baseUrl: providerConfig.baseUrl,
          active: false,
        },
      });
    } else {
      sendJson(res, 500, { status: "error", message: "Failed to duplicate provider" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    sendJson(res, 500, { status: "error", message });
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
  providerType: "anthropic" | "openai" | "openai_chat";
  mode: "passthrough" | "inject";
  apiKey?: string;
  authHeader?: string;
  enabled?: boolean;
  modelMap?: ModelMapEntry[];
  vlModelMap?: ModelMapEntry[];
  /** When false, model maps are stored but not applied. Omit or true = enabled (default). */
  modelMappingEnabled?: boolean;
  headers?: Record<string, string>;
  useCustomModelsList?: boolean;
  customModelsList?: string[];
  openaiCompat?: "default" | "azure_openai";
}
