/**
 * Router Stage - handles blocking check and routing resolution
 *
 * Derives the **client wire canonical path** (what the client protocol uses before cross-protocol remap):
 *
 * - **`/anthropic/...`** → strip `/anthropic` → Anthropic wire (`/v1/models`, `/v1/messages`, …).
 * - **`/openai/...`** → strip `/openai` → OpenAI wire; if the remainder is **`/v1/models`** (GET) or
 *   **`/v1/chat/completions` / `/v1/responses`** (POST), normalize to **`/models`**, **`/chat/completions`**,
 *   **`/responses`** so custom forwards on unsupported shapes still get correct OpenAI-relative paths.
 * - **Legacy relay root **`/v1/...`** (no prefix)** → normalize OpenAI-wire inbounds (**`/v1/models`**, …) to **`/models`**, **`/chat/completions`**,
 *   **`/responses`** per method; Anthropic (**`/v1/messages`**, …) stays **`/v1/...`**.
 *
 * **`Router.getTargetUrl`** concatenates **`provider.baseUrl`** + path **without** deduplication (`/v1` is part of vendor config).
 */

import type * as http from "http";
import type * as url from "url";
import type { Router } from "../router";
import type { ApiSurface, RoutingContext } from "./context";
import { detectApiSurface, resolveInboundClientSurface } from "./apiSurfaceDetector";
import { isOpenAIType } from "../../converter";

const INBOUND_PREFIX_OPENAI = "/openai/";
const INBOUND_PREFIX_ANTHROPIC = "/anthropic/";

function pathNoQuery(path: string): string {
  const noQuery = path.split("?")[0] ?? path;
  return noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
}

/** Legacy `/v1/...` on relay root maps to OpenAI wire paths (method-specific). */
function legacyV1ToOpenAiWireCanonical(method: string, path: string): string | null {
  const m = (method || "GET").toUpperCase();
  if (path === "/v1/models" && m === "GET") {
    return "/models";
  }
  if (m === "GET" && path.startsWith("/v1/models/") && path.length > "/v1/models/".length) {
    return `/models${path.slice("/v1/models".length)}`;
  }
  if (path === "/v1/chat/completions" && m === "POST") {
    return "/chat/completions";
  }
  if (path === "/v1/responses" && m === "POST") {
    return "/responses";
  }
  return null;
}

function stripAnthropicInboundPrefix(path: string): string | null {
  if (!path.startsWith(INBOUND_PREFIX_ANTHROPIC)) {
    return null;
  }
  return path.slice("/anthropic".length);
}

function stripOpenaiInboundPrefix(path: string): string {
  return path.startsWith(INBOUND_PREFIX_OPENAI) ? path.slice("/openai".length) : path;
}

/**
 * Client wire-relative path upstream (same as upstream path when protocol matches provider).
 *
 * `method` is required because legacy **`/v1/models`** vs **`/v1/messages`** are disambiguated by HTTP method.
 */
export function resolveUpstreamPath(method: string, clientPath: string): string {
  const p = pathNoQuery(clientPath);
  const anthropicStripped = stripAnthropicInboundPrefix(p);
  if (anthropicStripped !== null) {
    return anthropicStripped;
  }

  const afterOpenai = stripOpenaiInboundPrefix(p);
  const hadOpenaiPrefix = afterOpenai !== p;
  const candidate = hadOpenaiPrefix ? afterOpenai : p;
  const normalized = legacyV1ToOpenAiWireCanonical(method, candidate);
  return normalized ?? candidate;
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
        clientHeaders: {},
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
    const { provider, isRouted, forwardRuleProvider } = result;
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
    const targetPath = resolveUpstreamPath(method, path);
    let targetUrl = this.router.getTargetUrl(targetPath, provider);
    if (targetQuery) {
      targetUrl += targetQuery;
    }

    return {
      blocked: false,
      method,
      path,
      provider,
      clientHeaders: originalHeaders,
      headers,
      targetUrl,
      targetPath,
      targetQuery,
      isRouted,
      forwardRuleProvider,
      isOpenAIProvider,
      clientSurface: resolveInboundClientSurface(method, path, provider),
    };
  }
}
