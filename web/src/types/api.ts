// API Response Types

// Model map entry type (pattern -> model mapping)
export interface ModelMapEntry {
  pattern: string;
  model: string;
}

export interface Provider {
  id: string;
  name: string;
  mode: "inject" | "passthrough";
  providerType: "anthropic" | "openai" | "openai_chat";
  baseUrl?: string;
  active: boolean;
  enabled: boolean;
  apiKey?: string;
  modelMap?: ModelMapEntry[];
  /** When false, model maps are kept but not applied. Default true (omit = enabled). */
  modelMappingEnabled?: boolean;
  useCustomModelsList?: boolean;
  /** Each entry: `realId`, `realId;displayName`, or `realId;displayName;alias` (see Provider.customModelsList). */
  customModelsList?: string[];
  /** Read-only: true when this provider ID is in the global webSearch.providers list. */
  webSearchEnabled?: boolean;
}

export interface ProvidersResponse {
  providers: Provider[];
  current: string;
}

export interface ServerStatus {
  status: "running" | "stopped";
  currentProvider: string;
  providerName: string | null;
  providerMode: "inject" | "passthrough" | null;
  port: number;
  host: string;
}

export interface SwitchRequest {
  provider: string;
}

export interface SwitchResponse {
  status: "ok" | "error";
  provider?: string;
  name?: string;
  message?: string;
  available?: string[];
}

// Add Provider Request
export interface AddProviderRequest {
  id: string;
  name: string;
  baseUrl: string;
  providerType: "anthropic" | "openai" | "openai_chat";
  mode: "passthrough" | "inject";
  apiKey?: string;
  enabled?: boolean;
  // Advanced options
  authHeader?: string;
  modelMap?: ModelMapEntry[];
  vlModelMap?: ModelMapEntry[];
  /** When false, configured maps are not applied. Default true. */
  modelMappingEnabled?: boolean;
  headers?: Record<string, string>;
  useCustomModelsList?: boolean;
  /** Each entry: `realId`, `realId;displayName`, or `realId;displayName;alias` (see Provider.customModelsList). */
  customModelsList?: string[];
}

export interface AddProviderResponse {
  status: "ok" | "error";
  provider?: Provider;
  message?: string;
}

/** POST /providers/duplicate — client supplies `newId` (e.g. `sourceId + "_copy"`) */
export interface DuplicateProviderRequest {
  sourceId: string;
  newId: string;
  name: string;
}

export interface DuplicateProviderResponse {
  status: "ok" | "error";
  provider?: Pick<Provider, "id" | "name" | "mode" | "providerType" | "baseUrl" | "active">;
  message?: string;
}

export interface DeleteProviderResponse {
  status: "ok" | "error";
  message?: string;
}

export interface ReloadConfigResponse {
  status: "ok" | "error";
  message?: string;
  providersCount?: number;
}

export interface ExportProvidersResponse {
  providers: AddProviderRequest[];
}

export interface ImportProvidersResponse {
  status: "ok" | "error";
  imported: number;
  ids: string[];
  message?: string;
}

export type RequestStatus = "pending" | "completed";
export type RouteType = "block" | "passthrough" | "router" | "service";

export interface LogEntry {
  id: number;
  timestamp: number;
  providerId: string;
  providerName: string;
  method: string;
  path: string;
  targetUrl?: string;
  model?: string;
  mappedModel?: string;
  requestBody?: string;
  responseBody?: string;
  originalRequestBody?: string;
  originalResponseBody?: string;
  statusCode: number;
  duration: number;
  success: boolean;
  errorMessage?: string;
  clientId?: string;
  status?: RequestStatus;
  routeType?: RouteType;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  ttfb?: number;
}

export interface LogsQuery {
  limit?: number;
  offset?: number;
  providerId?: string;
  method?: string;
  pathPattern?: string;
  hasError?: boolean;
}

export interface LogsResponse {
  logs: LogEntry[];
  total: number;
  hasMore: boolean;
}

export interface ProviderBreakdownRow {
  providerId: string;
  providerName: string;
  count: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
}

export interface LogStats {
  totalLogs: number;
  successCount: number;
  errorCount: number;
  avgDuration: number;
  byProvider: Record<string, number>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  cacheHitRate: number;
  avgTtfb: number;
  outputTps: number;
  outputTpsSampleCount: number;
  p50Duration: number;
  p90Duration: number;
  providerBreakdown: ProviderBreakdownRow[];
}

export type StatsRange = "1d" | "7d" | "30d" | "all";

export interface BlockPattern {
  path: string;
  response: string;
  responseCode?: number;
}

export interface Config {
  port: number;
  host: string;
  autoStart: boolean;
  enableLogStorage: boolean;
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
  routePatterns: string[];
  passthroughPatterns: string[];
  blockPatterns: BlockPattern[];
  openaiBlockPatterns: BlockPattern[];
}

export interface ProviderConfig {
  name: string;
  baseUrl?: string;
  mode: "inject" | "passthrough";
  authHeader?: string;
  apiKey?: string;
  modelMap?: ModelMapEntry[];
  headers?: Record<string, string>;
}

export interface VersionResponse {
  version: string;
  date: string;
  features: {
    modelExtraction: boolean;
    logListWithoutBody: boolean;
  };
}

export type ClientConfigItemStatus = "ok" | "missing" | "wrong_target" | "invalid";

export interface ClientConfigItem {
  status: ClientConfigItemStatus;
  filePath: string;
  currentValue?: string;
  modelProvider?: string;
  model?: string;
  message?: string;
}

export interface ClaudeDefaultModels {
  opus?: string;
  sonnet?: string;
  haiku?: string;
}

export interface ClientConfigGetResponse {
  expectedAnthropicBase: string;
  expectedCodexBaseUrl: string;
  port: number;
  claudeCode: ClientConfigItem;
  codex: ClientConfigItem;
  claudeDefaultModels: ClaudeDefaultModels;
}

// Settings API types
export interface SettingsConfig {
  logging: LoggingSettings;
  concurrency: ConcurrencySettings;
  server: ServerSettings;
  routing: RoutingSettings;
  /** Bundled default forward/block (read-only preview + "restore defaults" in editor until Save). */
  routingDefaults?: RoutingSettings;
  webSearch?: WebSearchSettings;
}

export interface WebSearchSettings {
  tavily?: {
    apiKey?: string;
    searchDepth?: "basic" | "advanced";
    maxResults?: number;
  };
  glm?: {
    apiKey?: string;
    endpoint?: string;
    protocol?: "anthropic" | "openai";
    region?: "intl" | "cn";
    coding?: boolean;
    model?: string;
  };
  providers?: string[];
  defaultSearchBackend?: string;
}

export interface LoggingSettings {
  enabled: boolean;
  database?: {
    type: "sqlite" | "postgres";
    path?: string;
    /** SQLite only: sqlite3 CLI path; omit or empty uses PATH */
    sqlite3Executable?: string;
    host?: string;
    port?: number;
    name?: string;
    user?: string;
    password?: string;
    ssl?: boolean;
  };
}

export interface ConcurrencySettings {
  enabled: boolean;
  maxWorkers: number;
  maxQueueSize?: number;
  requestTimeout?: number;
  retry429?: {
    enabled: boolean;
    maxRetries: number;
    delayMs: number;
  };
  routes?: Array<Record<string, unknown>>;
}

export interface ServerSettings {
  port: number;
  host: string;
  autoStart: boolean;
  locale?: string;
}

export interface RoutingBlockRule {
  path: string;
  condition?: { providers?: string[]; providerNot?: string[] };
  response: string;
  code: number;
}

export interface RoutingSettings {
  forward: Array<{ path: string; provider: string }>;
  block: RoutingBlockRule[];
}

export interface PatchConfigResponse {
  status: string;
  restartRequired?: boolean;
  message?: string;
}

/** Wizard upstream proxy (same-origin; avoids browser CORS to provider APIs) */

export type WizardProviderType = "anthropic" | "openai" | "openai_chat";

export interface WizardProbeModelsRequest {
  baseUrl: string;
  apiKey: string;
  providerType: WizardProviderType;
}

export type WizardProbeModelsResponse =
  | { ok: true; modelIds: string[] }
  | { ok: false; errorCode: "auth" | "network" | "format" };

export interface WizardEndpointVariantInput {
  id: string;
  name: string;
  baseUrl: string;
  providerType: WizardProviderType;
  authHeader?: string;
}

export interface WizardEndpointTestRequest {
  apiKey: string;
  modelId: string;
  variants: WizardEndpointVariantInput[];
}

export interface WizardEndpointTestResultLine {
  id: string;
  pass: boolean;
  httpStatus?: number;
  detail?: string;
}

export interface WizardEndpointTestResponse {
  ok: true;
  results: WizardEndpointTestResultLine[];
}
