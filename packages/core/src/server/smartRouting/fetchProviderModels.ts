/**
 * Fetch upstream model ids for a configured provider (shared by wizard + ModelCatalog).
 */

import type { Provider } from "../../types";
import { executeWizardProbeModels } from "../../api/wizardUpstream";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("FetchProviderModels");

export { upstreamModelsRequestUrl, parseModelsResponseBody } from "../../api/wizardUpstream";

export interface FetchProviderModelsResult {
  ok: true;
  modelIds: string[];
}

export interface FetchProviderModelsError {
  ok: false;
  errorCode: "auth" | "network" | "format" | "missing_key";
}

export type FetchProviderModelsResponse = FetchProviderModelsResult | FetchProviderModelsError;

export async function fetchProviderModels(
  provider: Provider
): Promise<FetchProviderModelsResponse> {
  if (!provider.baseUrl?.trim()) {
    return { ok: false, errorCode: "format" };
  }
  if (provider.mode === "inject" && !provider.apiKey?.trim()) {
    return { ok: false, errorCode: "missing_key" };
  }

  const providerType = provider.providerType;
  const apiKey =
    provider.mode === "inject" ? (provider.apiKey?.trim() ?? "") : "passthrough-placeholder";

  log.info(`[fetch] ${provider.id} (${providerType}) GET models`);
  const result = await executeWizardProbeModels({
    baseUrl: provider.baseUrl,
    apiKey,
    providerType,
  });

  if (!result.ok) {
    return result;
  }

  return { ok: true, modelIds: result.modelIds };
}
