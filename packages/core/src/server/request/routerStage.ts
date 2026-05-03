/**
 * Router Stage - handles blocking check and routing resolution
 *
 * Derives upstream request paths from inbound HTTP paths:
 *
 * - **OpenAI (two supported ccrelay bases)**:
 *   - `http://host/openai` → `/openai/chat/completions`, `/openai/models`, … (no extra `/v1` in path).
 *   - `http://host/v1` → `/v1/chat/completions`, `/v1/models`, … (legacy host segment).
 *   When `provider.baseUrl` already includes `/v1`, an inbound path that still starts
 *   with `/v1/...` for these resources would join to `.../v1/v1/...`. For the three routes
 *   below we collapse `/v1/<resource>` → `/<resource>`. Same collapse applies after stripping
 *   `/openai` if an SDK emits `/openai/v1/...`.
 *
 * - **Anthropic**: `/anthropic/v1/messages`, `/anthropic/v1/models`, … strip `/anthropic` only;
 *   upstream path keeps canonical `/v1/...`.
 */

import type * as http from "http";
import type * as url from "url";
import type { Router } from "../router";
import type { ApiSurface, RoutingContext } from "./context";
import { detectApiSurface, resolveInboundClientSurface } from "./apiSurfaceDetector";
import { isOpenAIType } from "../../converter";

const INBOUND_PREFIX_OPENAI = "/openai/";
const INBOUND_PREFIX_ANTHROPIC = "/anthropic/";

/** Collapse inbound `/v1/<resource>` for OpenAI-wire paths when upstream `baseUrl` already ends with `/v1`. */
const LEGACY_OPENAI_V1_PATH_COLLAPSE = new Map<string, string>([
  ["/v1/chat/completions", "/chat/completions"],
  ["/v1/responses", "/responses"],
  ["/v1/models", "/models"],
]);

function stripAnthropicInboundPrefix(path: string): string | null {
  if (!path.startsWith(INBOUND_PREFIX_ANTHROPIC)) {
    return null;
  }
  return path.slice("/anthropic".length);
}

function stripOpenaiInboundPrefix(path: string): string {
  return path.startsWith(INBOUND_PREFIX_OPENAI) ? path.slice("/openai".length) : path;
}

function collapseDuplicateOpenAiV1Segment(pathAfterPrefixStrips: string): string {
  return LEGACY_OPENAI_V1_PATH_COLLAPSE.get(pathAfterPrefixStrips) ?? pathAfterPrefixStrips;
}

export function resolveUpstreamPath(clientPath: string): string {
  const anthropicStripped = stripAnthropicInboundPrefix(clientPath);
  if (anthropicStripped !== null) {
    return anthropicStripped;
  }
  const withoutOpenAiPrefix = stripOpenaiInboundPrefix(clientPath);
  return collapseDuplicateOpenAiV1Segment(withoutOpenAiPrefix);
}

/**
 * RouterStage processes request routing and blocking
 */
export class RouterStage {
  constructor(private router: Router) {}

  /**
   * Process request routing - returns RoutingContext.
   * Returns null when the path should get a 404 (not_found).
   */
  process(
    req: http.IncomingMessage,
    path: string,
    parsedUrl: url.UrlWithParsedQuery
  ): RoutingContext | null {
    const method = req.method || "GET";
    const clientSurface: ApiSurface = detectApiSurface(method, path) ?? "anthropic";

    // 1. Unified resolve: block → forward → not_found
    const result = this.router.resolve(path);

    if (result.type === "block") {
      return {
        blocked: true,
        blockResponse: result.response,
        blockStatusCode: result.code,
        method,
        path,
        provider: null as never,
        headers: {},
        targetUrl: "",
        targetPath: "",
        targetQuery: "",
        isRouted: false,
        isOpenAIProvider: false,
        clientSurface,
      };
    }

    if (result.type === "not_found") {
      return null;
    }

    // type === "forward"
    const { provider, isRouted } = result;
    const isOpenAIProvider = isOpenAIType(provider.providerType);

    // 2. Prepare headers
    const originalHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        originalHeaders[key] = Array.isArray(value) ? value[0] : value;
      }
    }
    const headers = this.router.prepareHeaders(originalHeaders, provider);

    // 3. Build target URL
    const targetQuery = typeof parsedUrl.search === "string" ? parsedUrl.search : "";
    const targetPath = resolveUpstreamPath(path);
    let targetUrl = this.router.getTargetUrl(targetPath, provider);
    if (targetQuery) {
      targetUrl += targetQuery;
    }

    return {
      blocked: false,
      method,
      path,
      provider,
      headers,
      targetUrl,
      targetPath,
      targetQuery,
      isRouted,
      isOpenAIProvider,
      clientSurface: resolveInboundClientSurface(method, path, provider),
    };
  }
}
