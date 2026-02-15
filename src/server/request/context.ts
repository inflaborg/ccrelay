/**
 * Request processing context - shared data structures
 */

import type * as http from "http";
import type * as url from "url";
import type { Provider } from "../../types";

/**
 * Routing context from RouterStage
 */
export interface RoutingContext {
  blocked: boolean;
  blockResponse?: string;
  blockStatusCode?: number;
  method: string;
  path: string;
  provider: Provider;
  headers: Record<string, string>;
  targetUrl: string;
  targetPath: string;
  isRouted: boolean;
  isOpenAIProvider: boolean;
}

/**
 * Body processing result from BodyProcessor
 */
export interface BodyProcessResult {
  body: Buffer;
  originalModel: string | undefined;
  originalRequestBody: string | undefined;
  requestBodyLog: string | undefined;
}

/**
 * Complete request context passed through all stages
 */
export interface RequestContext {
  // From HTTP request
  req: http.IncomingMessage;
  res: http.ServerResponse;
  path: string;
  parsedUrl: url.UrlWithParsedQuery;

  // From RouterStage
  routing: RoutingContext;

  // From BodyProcessor
  bodyResult: BodyProcessResult;

  // Generated
  clientId: string;
  requestReceiveStart: number;
  bodyReceiveTime: number;
}

/**
 * Execution options
 */
export interface ExecutionOptions {
  useQueue: boolean;
  queueName?: string;
}
