/**
 * Router Stage - handles blocking check and routing resolution
 */

import type * as http from "http";
import type * as url from "url";
import type { Router } from "../router";
import type { RoutingContext } from "./context";

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
        isRouted: false,
        isOpenAIProvider: false,
      };
    }

    // 2. Get target provider
    const provider = this.router.getTargetProvider(path);
    const isRouted = this.router.shouldRoute(path);
    const isOpenAIProvider = provider.providerType === "openai";

    // 3. Prepare headers
    const originalHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        originalHeaders[key] = Array.isArray(value) ? value[0] : value;
      }
    }
    const headers = this.router.prepareHeaders(originalHeaders, provider);

    // 4. Build target URL
    let targetPath = path;
    let targetUrl = this.router.getTargetUrl(path, provider);
    if (parsedUrl.search) {
      targetUrl += parsedUrl.search;
    }

    return {
      blocked: false,
      method,
      path,
      provider,
      headers,
      targetUrl,
      targetPath,
      isRouted,
      isOpenAIProvider,
    };
  }
}
