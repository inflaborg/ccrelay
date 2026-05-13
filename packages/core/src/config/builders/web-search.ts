import type { WebSearchConfigInput, WebSearchGlobalConfig } from "../../types";

/** Compute GLM endpoint URL from protocol/region/coding. */
export function computeGlmEndpoint(
  protocol: "anthropic" | "openai",
  region: "intl" | "cn",
  coding: boolean
): string {
  const host = region === "cn" ? "https://open.bigmodel.cn" : "https://api.z.ai";
  if (protocol === "anthropic") {
    return `${host}/api/anthropic`;
  }
  const planPath = coding ? "/api/coding/paas/v4" : "/api/paas/v4";
  return `${host}${planPath}/chat/completions`;
}

export function buildWebSearchConfig(
  raw: WebSearchConfigInput | undefined
): WebSearchGlobalConfig | undefined {
  if (!raw) {
    return undefined;
  }
  const t = raw.tavily;
  const g = raw.glm;
  const providers = Array.isArray(raw.providers) ? raw.providers : undefined;
  const defaultSearchBackend =
    typeof raw.defaultSearchBackend === "string" ? raw.defaultSearchBackend : undefined;
  if (!t && !g && !providers && !defaultSearchBackend) {
    return undefined;
  }

  let glmConfig: WebSearchGlobalConfig["glm"] | undefined;
  if (g) {
    const protocol = g.protocol === "anthropic" ? "anthropic" : "openai";
    const region = g.region === "cn" ? "cn" : "intl";
    const coding = g.coding === true;
    const computedEndpoint = computeGlmEndpoint(protocol, region, coding);
    glmConfig = {
      apiKey: g.apiKey ?? g.api_key,
      endpoint:
        typeof g.endpoint === "string" && g.endpoint.length > 0 ? g.endpoint : computedEndpoint,
      protocol,
      region,
      coding,
      model: g.model,
    };
  }

  return {
    ...(t
      ? {
          tavily: {
            apiKey: t.apiKey ?? t.api_key,
            searchDepth: t.searchDepth ?? t.search_depth,
            maxResults: t.maxResults ?? t.max_results,
          },
        }
      : {}),
    ...(glmConfig ? { glm: glmConfig } : {}),
    ...(providers && providers.length > 0 ? { providers } : {}),
    ...(defaultSearchBackend ? { defaultSearchBackend } : {}),
  };
}
