/* eslint-disable @typescript-eslint/naming-convention -- HTTP header keys */

import { Logger } from "../../utils/logger";
import type { ApiSurface } from "../../types";
import type { WebSearchGlobalConfig } from "../../types";
import { detectWebSearchCall } from "./detector";
import { formatAnthropicWebSearchSse, formatAnthropicWebResponse } from "./formatter";
import { createSearchProvider } from "./providers";
import { synthesizeAnswer } from "./synthesizer";
import type { WebSearchDetection } from "./types";

const log = Logger.getInstance();

/** Successful web-search synthesis (caller applies headers and body to the HTTP response). */
export interface WebSearchOrchestrationResult {
  body: string;
  headers: Record<string, string>;
}

/**
 * Pure detection: whether this request should be handled by the web-search interceptor
 * (wire shape + provider allowlist + Tavily configured). No I/O.
 *
 * Returns `WebSearchDetection` when this interceptor should claim the request; `null` otherwise.
 */
export function detectWebSearchInterception(
  rawBody: Buffer,
  clientSurface: ApiSurface,
  providerId: string,
  globalConfig: WebSearchGlobalConfig | undefined
): WebSearchDetection | null {
  log.info(
    `[web-search] detectWebSearchInterception provider=${providerId} surface=${clientSurface} config=${globalConfig ? `providers=[${(globalConfig.providers ?? []).join(",")}]` : "undefined"}`
  );

  const detection = detectWebSearchCall(rawBody, clientSurface);
  if (!detection.intercept) {
    log.info(
      `[web-search] Detection skipped for provider=${providerId} surface=${clientSurface} bodyLen=${rawBody.length}`
    );
    return null;
  }

  log.info(
    `[web-search] Detection hit: query="${detection.query}" model=${detection.model} stream=${detection.stream} provider=${providerId}`
  );

  const enabledProviders = globalConfig?.providers;
  if (!enabledProviders || !enabledProviders.includes(providerId)) {
    log.info(
      `[web-search] Provider "${providerId}" not in enabled list: [${(enabledProviders ?? []).join(", ")}]`
    );
    return null;
  }

  const provider = createSearchProvider(undefined, globalConfig ?? {});
  if (!provider) {
    log.info("[web-search] No search provider configured, not intercepting");
    return null;
  }

  return detection;
}

/**
 * Run search and build response payload. Throws if the search provider fails (no silent fall-through).
 */
export async function executeWebSearchQuery(
  detection: WebSearchDetection,
  globalConfig: WebSearchGlobalConfig
): Promise<WebSearchOrchestrationResult> {
  const provider = createSearchProvider(undefined, globalConfig);
  if (!provider) {
    throw new Error("Web search provider not configured");
  }

  const searchResult = await provider.search(detection.query);

  if (searchResult.answer === null) {
    searchResult.answer = synthesizeAnswer(detection.query, searchResult);
  }

  let body: string;
  let headers: Record<string, string>;
  if (detection.stream) {
    body = formatAnthropicWebSearchSse(detection.query, searchResult, detection.model);
    headers = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    };
  } else {
    body = formatAnthropicWebResponse(detection.query, searchResult, detection.model);
    headers = { "Content-Type": "application/json" };
  }

  log.info(
    `[web-search] Executed query="${detection.query}" stream=${detection.stream} results=${searchResult.results.length}`
  );
  return { body, headers };
}
