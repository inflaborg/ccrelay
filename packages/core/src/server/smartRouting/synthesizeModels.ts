import type { ApiSurface, SmartRoutingCatalogEntry } from "../../types";
import {
  convertOpenAISingleModelToAnthropic,
  openAiModelsPageToAnthropicModelsList,
  type OpenAIModelEntry,
} from "../../converter/models-fallback";

/** Combine provider + model labels; omit redundant parts when label equals id. */
export function buildSmartRoutingModelDisplayName(entry: SmartRoutingCatalogEntry): string {
  const providerLabel =
    entry.providerDisplayName && entry.providerDisplayName !== entry.providerId
      ? entry.providerDisplayName
      : entry.providerId;
  const modelLabel =
    entry.displayName && entry.displayName !== entry.upstreamModelId
      ? entry.displayName
      : entry.upstreamModelId;
  return `${providerLabel} · ${modelLabel}`;
}

function entryToOpenAiModel(entry: SmartRoutingCatalogEntry, wireId: string): OpenAIModelEntry {
  const now = Math.floor(Date.now() / 1000);
  const displayName = buildSmartRoutingModelDisplayName(entry);
  return {
    id: wireId,
    object: "model",
    created: now,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- OpenAI wire JSON
    owned_by: entry.providerId,
    ...(displayName !== wireId
      ? {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- OpenAI wire JSON
          display_name: displayName,
        }
      : {}),
  };
}

export function synthesizeSmartRoutingModelsListBody(options: {
  clientSurface: ApiSurface;
  entries: SmartRoutingCatalogEntry[];
  useAlias: boolean;
}): string {
  const openaiPage = {
    object: "list" as const,
    data: options.entries.map(entry =>
      entryToOpenAiModel(entry, options.useAlias ? entry.aliasHash : entry.publicId)
    ),
  };

  if (options.clientSurface === "anthropic") {
    return JSON.stringify(openAiModelsPageToAnthropicModelsList(openaiPage, false));
  }
  return JSON.stringify(openaiPage);
}

export function synthesizeSmartRoutingModelDetailBody(options: {
  clientSurface: ApiSurface;
  modelId: string;
  entries: SmartRoutingCatalogEntry[];
}): string | null {
  const want = options.modelId;
  const hit = options.entries.find(
    e => e.publicId === want || e.aliasHash === want || e.legacyAlias === want
  );
  if (!hit) {
    return null;
  }
  const wireId = want;
  const openaiEntry = entryToOpenAiModel(hit, wireId);
  if (options.clientSurface === "anthropic") {
    return JSON.stringify(convertOpenAISingleModelToAnthropic(openaiEntry));
  }
  return JSON.stringify(openaiEntry);
}

/** Resolve detail path suffix to catalog lookup key (supports encoded colons). */
export function decodeSmartRoutingModelDetailId(pathSuffix: string): string {
  try {
    return decodeURIComponent(pathSuffix);
  } catch {
    return pathSuffix;
  }
}

export function extractSmartRoutingDetailSuffix(requestPath: string): string | null {
  const p = requestPath.split("?")[0] ?? requestPath;
  if (p.startsWith("/v1/models/") && p.length > "/v1/models/".length) {
    return p.slice("/v1/models/".length);
  }
  if (p.startsWith("/models/") && p.length > "/models/".length) {
    return p.slice("/models/".length);
  }
  return null;
}
