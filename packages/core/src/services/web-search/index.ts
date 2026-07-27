export {
  detectWebSearchInterception,
  executeWebSearchQuery,
  isWebSearchFeatureEnabled,
  isWebSearchBackendReady,
  resolveWebSearchBackendName,
  runPlainWebSearch,
} from "./executor";
export type { WebSearchOrchestrationResult } from "./executor";
export type { WebSearchDetection, WebSearchDetectionResult, WebSearchNoop } from "./types";
export { WebSearchInterceptor } from "./interceptor";
export type { WebSearchGlobalConfig } from "./providers";
export type { SearchProviderResponse, NormalizedSearchResult } from "./providers/types";
export { runWebFetch, resolveWebFetchBackend, htmlToText } from "./fetch";
export type { WebFetchResult, WebFetchBackend, WebFetchOptions } from "./fetch";
