/**
 * Smart routing management API
 */

import * as http from "http";
import * as url from "url";
import type { ProxyServer } from "../server/handler";
import { collectAliasDrifts, applyAliasDriftUpdates } from "../server/smartRouting/aliasDrift";
import { computeCanonicalAliasHash } from "../server/smartRouting/aliasHash";
import { buildSmartRoutingConfig } from "../config/builders/smart-routing";
import { parseCustomModelLine } from "../converter/models-fallback";
import type { ModelCatalog } from "../server/smartRouting/modelCatalog";
import { sendJson, parseJsonBody } from "./httpJson";

let serverInstance: ProxyServer | null = null;

function buildCatalogPayload(catalog: ModelCatalog) {
  return {
    enabled: catalog.isEnabled(),
    entries: catalog.getAll(),
    stats: catalog.getStats(),
    providerErrors: catalog.getProviderErrors(),
  };
}

export function setServer(server: ProxyServer): void {
  serverInstance = server;
}

export function handleSmartRoutingCatalog(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }
  const catalog = serverInstance.getModelCatalog();
  void catalog.ensureReady().then(() => {
    sendJson(res, 200, buildCatalogPayload(catalog));
  });
}

export async function handleSmartRoutingRefresh(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }
  const catalog = serverInstance.getModelCatalog();
  const parsed = url.parse(req.url ?? "", true);
  const providerId =
    typeof parsed.query.providerId === "string" ? parsed.query.providerId : undefined;
  if (providerId) {
    await catalog.refreshProvider(providerId);
  } else {
    await catalog.refreshAll();
  }
  sendJson(res, 200, {
    status: "ok",
    ...buildCatalogPayload(catalog),
  });
}

export function handleSmartRoutingAliasDrift(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }
  const config = serverInstance.getConfig();
  const smartRouting = config.smartRoutingConfig ?? buildSmartRoutingConfig(undefined);
  const drifts = collectAliasDrifts(config.providers, smartRouting);
  sendJson(res, 200, { drifts });
}

export async function handleSmartRoutingAliasDriftApply(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }
  const body = await parseJsonBody<{
    updates?: Array<{ providerId: string; lineIndex: number }>;
  }>(req);
  const updates = body.updates ?? [];
  const config = serverInstance.getConfig();
  const smartRouting = config.smartRoutingConfig ?? buildSmartRoutingConfig(undefined);

  const byProvider = new Map<string, Array<{ lineIndex: number; newAlias: string }>>();
  for (const u of updates) {
    const provider = config.getProvider(u.providerId);
    if (!provider?.customModelsList) {
      continue;
    }
    const line = provider.customModelsList[u.lineIndex];
    if (!line) {
      continue;
    }
    const parsed = parseCustomModelLine(line);
    if (!parsed.id) {
      continue;
    }
    const newAlias = computeCanonicalAliasHash(
      u.providerId,
      provider.providerType,
      parsed.id,
      smartRouting.aliasPrefix
    );
    const list = byProvider.get(u.providerId) ?? [];
    list.push({ lineIndex: u.lineIndex, newAlias });
    byProvider.set(u.providerId, list);
  }

  for (const [providerId, providerUpdates] of byProvider) {
    const provider = config.getProvider(providerId);
    if (!provider?.customModelsList) {
      continue;
    }
    const next = applyAliasDriftUpdates(provider.customModelsList, providerUpdates);
    if (!config.updateProviderCustomModelsList(providerId, next)) {
      sendJson(res, 500, { status: "error", message: `Failed to update ${providerId}` });
      return;
    }
  }

  sendJson(res, 200, { status: "ok" });
}
