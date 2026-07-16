import type {
  InterceptResult,
  ServiceInterceptor,
  ServiceInterceptorContext,
} from "../../server/interceptor";
import { detectAvailabilityProbe } from "./detector";
import { formatAvailabilityProbeResponse } from "./formatter";
import type { AvailabilityProbeDetection } from "./types";

/**
 * Short-circuits one-token availability probes (max_tokens / max_completion_tokens === 1)
 * so validation requests never hit upstream providers.
 */
export class AvailabilityProbeInterceptor implements ServiceInterceptor {
  readonly name = "availability-probe";

  private readonly detectionCache = new WeakMap<Buffer, AvailabilityProbeDetection>();

  shouldIntercept(ctx: ServiceInterceptorContext): boolean {
    const detection = detectAvailabilityProbe(ctx.rawBody, ctx.method, ctx.path, ctx.clientSurface);
    if (!detection) {
      return false;
    }
    this.detectionCache.set(ctx.rawBody, detection);
    return true;
  }

  execute(ctx: ServiceInterceptorContext): Promise<InterceptResult> {
    const detection = this.detectionCache.get(ctx.rawBody);
    if (!detection) {
      return Promise.reject(
        new Error("[availability-probe] execute called without cached detection (registry bug?)")
      );
    }
    const out = formatAvailabilityProbeResponse(detection);
    return Promise.resolve({
      handled: true,
      statusCode: out.statusCode,
      headers: out.headers,
      body: out.body,
      routeType: "service",
      serviceHandler: this.name,
      tokens: out.tokens,
    });
  }
}
