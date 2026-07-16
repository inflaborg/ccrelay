import type { WebSearchGlobalConfig } from "../../types";
import type {
  InterceptResult,
  ServiceInterceptor,
  ServiceInterceptorContext,
} from "../../server/interceptor";
import { detectWebSearchInterception, executeWebSearchQuery } from "./executor";
import type { WebSearchDetection } from "./types";

/**
 * Intercepts Anthropic-style web_search tool requests and answers via configured search backend.
 */
export class WebSearchInterceptor implements ServiceInterceptor {
  readonly name = "web-search";

  private readonly detectionCache = new WeakMap<Buffer, WebSearchDetection>();

  constructor(private readonly getWebSearchConfig: () => WebSearchGlobalConfig | undefined) {}

  shouldIntercept(ctx: ServiceInterceptorContext): boolean {
    const globalConfig = this.getWebSearchConfig();
    const detection = detectWebSearchInterception(
      ctx.rawBody,
      ctx.clientSurface,
      ctx.providerId,
      globalConfig
    );
    if (!detection) {
      return false;
    }
    this.detectionCache.set(ctx.rawBody, detection);
    return true;
  }

  async execute(ctx: ServiceInterceptorContext): Promise<InterceptResult> {
    const detection = this.detectionCache.get(ctx.rawBody);
    if (!detection) {
      throw new Error("[web-search] execute called without cached detection (registry bug?)");
    }
    const globalConfig = this.getWebSearchConfig() ?? {};
    const out = await executeWebSearchQuery(detection, globalConfig);
    return {
      handled: true,
      statusCode: 200,
      headers: out.headers,
      body: out.body,
      routeType: "service",
      serviceHandler: this.name,
      serviceMeta: { searchBackend: detection.searchBackend },
    };
  }
}
