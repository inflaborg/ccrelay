/**
 * Router Stage - handles blocking check and routing resolution
 */

import type * as http from "http";
import type * as url from "url";
import type { Router } from "../router";
import type { ApiSurface, RoutingContext } from "./context";
import { detectApiSurface, resolveInboundClientSurface } from "./apiSurfaceDetector";
import { isOpenAIType } from "../../converter";

/**
 * RouterStage processes request routing and blocking
 */
export class RouterStage {
  constructor(private router: Router) {}

  /**
   * Process request routing - returns RoutingContext
   */
  process(
    req: http.IncomingMessage,
    path: string,
    parsedUrl: url.UrlWithParsedQuery
  ): RoutingContext {
    const method = req.method || "GET";
    const defaultSurface: ApiSurface = detectApiSurface(method, path) ?? "anthropic";

    // 1. Check if path should be blocked
    const blockResult = this.router.shouldBlock(path);
    if (blockResult.blocked) {
      return {
        blocked: true,
        blockResponse: blockResult.response ?? JSON.stringify({ ok: true }),
        blockStatusCode: blockResult.responseCode ?? 200,
        method,
        path,
        provider: null as never, // Not needed if blocked
        headers: {},
        targetUrl: "",
        targetPath: "",
        targetQuery: "",
        isRouted: false,
        isOpenAIProvider: false,
        clientSurface: defaultSurface,
      };
    }

    // 2. Get target provider
    const provider = this.router.getTargetProvider(path);
    const isRouted = this.router.shouldRoute(path);
    const isOpenAIProvider = isOpenAIType(provider.providerType);

    // 3. Prepare headers
    const originalHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        originalHeaders[key] = Array.isArray(value) ? value[0] : value;
      }
    }
    const headers = this.router.prepareHeaders(originalHeaders, provider);

    // 4. Build target URL
    const targetQuery = typeof parsedUrl.search === "string" ? parsedUrl.search : "";
    let targetPath = path;
    let targetUrl = this.router.getTargetUrl(path, provider);
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
