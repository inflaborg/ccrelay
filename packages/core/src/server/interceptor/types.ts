/**
 * Generic service interceptors — protocol layer calls the registry without
 * knowing specific business capabilities (web search, etc.).
 */

import type { ApiSurface } from "../../types";
import type { RouteType } from "../../database";

/** Successful interception: caller writes HTTP response and completes logging. */
export interface InterceptHandled {
  handled: true;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  routeType: RouteType;
  /** Optional token counts (merged over body extraction in ResponseLogger). */
  tokens?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheTokens?: number;
  };
}

export type InterceptResult = InterceptHandled;

export interface ServiceInterceptorContext {
  rawBody: Buffer;
  clientSurface: ApiSurface;
  providerId: string;
  method: string;
  path: string;
}

export interface ServiceInterceptor {
  readonly name: string;
  /** Sync, no I/O — whether this interceptor claims the request. */
  shouldIntercept(ctx: ServiceInterceptorContext): boolean;
  /** Called only after `shouldIntercept` returned true. May perform I/O; throws on failure. */
  execute(ctx: ServiceInterceptorContext): Promise<InterceptResult>;
}
