import type { ApiSurface } from "../../types";

/** A web search call was detected and should be intercepted. */
export interface WebSearchDetection {
  intercept: true;
  /** The search query extracted from the user message. */
  query: string;
  /** Whether the client requested streaming. */
  stream: boolean;
  /** The model string from the request body. */
  model: string;
  /** The client API surface format. */
  clientSurface: ApiSurface;
}

/** No interception needed — fall through to normal proxy. */
export interface WebSearchNoop {
  intercept: false;
}

export type WebSearchDetectionResult = WebSearchDetection | WebSearchNoop;
