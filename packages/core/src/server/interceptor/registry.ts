import type { ApiSurface } from "../../types";
import type { InterceptResult, ServiceInterceptor, ServiceInterceptorContext } from "./types";

/**
 * Ordered list of interceptors; first non-null result wins.
 */
export class InterceptorRegistry {
  private readonly interceptors: ServiceInterceptor[] = [];

  register(interceptor: ServiceInterceptor): void {
    this.interceptors.push(interceptor);
  }

  async tryIntercept(
    rawBody: Buffer,
    clientSurface: ApiSurface,
    providerId: string,
    method: string,
    path: string
  ): Promise<InterceptResult | null> {
    const ctx: ServiceInterceptorContext = { rawBody, clientSurface, providerId, method, path };
    for (const interceptor of this.interceptors) {
      if (interceptor.shouldIntercept(ctx)) {
        return await interceptor.execute(ctx);
      }
    }
    return null;
  }
}
