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
    const result = this.router.resolve(path, clientSurface);

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
    const targetPath = path;
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
