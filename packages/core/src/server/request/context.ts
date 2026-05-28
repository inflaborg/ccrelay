/**
 * Request processing context - shared data structures
 */

import type * as http from "http";
import type * as url from "url";
import type { ApiSurface, Provider } from "../../types";
import type { ResponsesRequestEcho } from "../../converter";

/**
 * Re-export for convenience
 */
export type { ApiSurface };

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
  /** Raw client headers before provider auth injection (for re-preparing after smart routing). */
  clientHeaders: Record<string, string>;
  headers: Record<string, string>;
  targetUrl: string;
  targetPath: string;
  /** Query string from client request, e.g. `?a=1` (empty if none) */
  targetQuery: string;
  isRouted: boolean;
  /** Forward rule provider id before resolution (`auto` or explicit provider id). */
  forwardRuleProvider?: string;
  isOpenAIProvider: boolean;
  /** Wire format the client is using; default anthropic for legacy paths */
  clientSurface: ApiSurface;
  /** Client wire model id before smart routing rewrites the request body. */
  smartRoutingClientModel?: string;
}

/**
 * Body processing result from BodyProcessor
 */
export interface BodyProcessResult {
  body: Buffer;
  originalModel: string | undefined;
  originalRequestBody: string | undefined;
  requestBodyLog: string | undefined;
  /** True if client had `stream: true` before we forced `stream: false` for cross-protocol conversion (both /v1/chat/completions and /v1/responses) */
  responsesStreamRequested?: boolean;
  /** True if client sent `stream: true` on a cross-protocol Chat Completions request */
  streamRequested?: boolean;
  /** Original POST /v1/responses fields echoed into synthesized Responses output */
  originalResponsesEcho?: ResponsesRequestEcho;
  /** Anthropic POST /v1/messages with hosted `web_search` tool — enables SSE response rewrite (GLM). */
  hasHostedWebSearch?: boolean;
  /** After cross-protocol conversion: upstream JSON wire shape for response handling (e.g. OpenAI Responses). */
  upstreamResponseFormat?: string;
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
