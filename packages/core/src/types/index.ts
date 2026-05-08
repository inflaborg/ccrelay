/**
 * Core types for CCRelay
 */

/* eslint-disable @typescript-eslint/naming-convention */
// External API fields use snake_case (media_type, tool_use_id, etc.)

import * as http from "http";
import { z } from "zod";

export type ProviderMode = "passthrough" | "inject";

export type ProviderType = "anthropic" | "openai" | "openai_chat";

/** Inbound client wire format (Anthropic Messages vs OpenAI Chat Completions vs OpenAI Responses API, etc.) */
export type ApiSurface = "anthropic" | "openai" | "openai_responses";

/** Subset of OpenAI Responses request fields echoed back into `response.{...}` shells (synthesized JSON/SSE). */
export interface ResponsesRequestEcho {
  tools: unknown[];
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
  reasoning?: { effort?: string | null; summary?: string | null };
  text?: { format?: unknown };
  instructions?: string | null;
  metadata?: Record<string, unknown>;
  store?: boolean;
  previous_response_id?: string | null;
  user?: string | null;
  truncation?: string;
}

/**
 * Zod schemas for runtime type validation
 */

// Provider mode enum schema
export const ProviderModeSchema = z.enum(["passthrough", "inject"]);

// Provider type enum schema
export const ProviderTypeSchema = z.enum(["anthropic", "openai", "openai_chat"]);

/** Chat Completions wire quirks when bridging Anthropic clients to OpenAI-family upstreams */
export const OpenAICompatSchema = z.enum(["default", "azure_openai"]);
export type OpenAICompat = z.infer<typeof OpenAICompatSchema>;

// Model map entry schema (pattern -> model mapping)
export const ModelMapEntrySchema = z.object({
  pattern: z.string(),
  model: z.string(),
});

export type ModelMapEntry = z.infer<typeof ModelMapEntrySchema>;

// Provider configuration schema (from YAML/VSCode settings)
export const ProviderConfigSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url().or(z.string().min(1)).optional(),
  base_url: z.string().url().or(z.string().min(1)).optional(),
  mode: ProviderModeSchema.default("passthrough"),
  providerType: ProviderTypeSchema.optional(),
  provider_type: ProviderTypeSchema.optional(),
  apiKey: z.string().optional(),
  api_key: z.string().optional(),
  authHeader: z.string().optional(),
  auth_header: z.string().optional(),
  modelMap: z.array(ModelMapEntrySchema).optional(),
  model_map: z.array(ModelMapEntrySchema).optional(),
  vlModelMap: z.array(ModelMapEntrySchema).optional(),
  vl_model_map: z.array(ModelMapEntrySchema).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  useCustomModelsList: z.boolean().optional(),
  use_custom_models_list: z.boolean().optional(),
  customModelsList: z.array(z.string()).optional(),
  custom_models_list: z.array(z.string()).optional(),
  openaiCompat: OpenAICompatSchema.optional(),
  openai_compat: OpenAICompatSchema.optional(),
  /** When false, `modelMap` / `vlModelMap` are ignored (request remap, list remap, response model). Default: enabled. */
  modelMappingEnabled: z.boolean().optional(),
  model_mapping_enabled: z.boolean().optional(),
});

export type ProviderConfigInput = z.infer<typeof ProviderConfigSchema>;

// Server configuration schema
export const ServerConfigSchema = z.object({
  port: z.number().int().positive().default(7575),
  host: z.string().default("127.0.0.1"),
  autoStart: z.boolean().default(true),
  /** Local HTTP API Bearer; auto-written when omitted (see ConfigManager). */
  apiBearerToken: z.string().optional(),
  /** UI language locale; undefined means not yet chosen (triggers language modal). */
  locale: z.enum(["en", "zh"]).optional(),
});

export type ServerConfigInput = z.infer<typeof ServerConfigSchema>;

// Block pattern schema with custom response
export const BlockPatternSchema = z.object({
  path: z.string(),
  response: z.string(),
  code: z.number().optional(), // responseCode -> code
});

export type BlockPattern = z.infer<typeof BlockPatternSchema>;

// ── New unified routing schemas ─────────────────────────────────────────────

export const BlockConditionSchema = z
  .object({
    /** If set: rule applies only when current provider ID is in this list (allowlist). */
    providers: z.array(z.string()).optional(),
    /** If set: skip rule when current provider ID is in this list */
    providerNot: z.array(z.string()).optional(),
  })
  .optional();

export const ForwardRuleSchema = z.object({
  path: z.string().min(1),
  provider: z.string().min(1), // "auto" or a provider ID
});

export const BlockRuleSchema = z.object({
  path: z.string().min(1),
  condition: BlockConditionSchema.optional(),
  response: z.string(),
  code: z.number().int().default(200),
});

export type ForwardRule = z.infer<typeof ForwardRuleSchema>;
export type BlockRule = z.infer<typeof BlockRuleSchema>;
export type BlockCondition = z.infer<typeof BlockConditionSchema>;

// ── Routing config schema (supports both legacy and new format) ─────────────

export const RoutingConfigSchema = z.object({
  // New unified format
  forward: z.array(ForwardRuleSchema).optional(),
  block: z.array(BlockRuleSchema).optional(),
  // Legacy (kept for backward compat; ignored when forward exists)
  proxy: z.array(z.string()).optional(),
  passthrough: z.array(z.string()).optional(),
  openaiBlock: z.array(BlockPatternSchema).optional(),
});

export type RoutingConfigInput = z.infer<typeof RoutingConfigSchema>;

// Route-based queue configuration schema (defined before ConcurrencyConfigSchema)
export const RouteQueueConfigSchema = z.object({
  pattern: z.string().min(1), // Regex pattern to match request path
  maxWorkers: z.number().int().positive().default(10),
  maxQueueSize: z.number().int().nonnegative().optional(),
  requestTimeout: z.number().nonnegative().optional(), // Queue wait timeout in seconds (supports fractions)
  name: z.string().optional(), // Optional name for logging
});

export type RouteQueueConfigInput = z.infer<typeof RouteQueueConfigSchema>;

// Retry 429 configuration schema
export const Retry429ConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxRetries: z.number().int().nonnegative().default(3),
  delayMs: z.number().int().nonnegative().default(1000), // Delay in milliseconds
});

export type Retry429ConfigInput = z.infer<typeof Retry429ConfigSchema>;

// Concurrency configuration schema
export const ConcurrencyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxWorkers: z.number().int().positive().default(3),
  maxQueueSize: z.number().int().nonnegative().optional(),
  requestTimeout: z.number().nonnegative().optional(), // Queue wait timeout in seconds (supports fractions)
  retry429: Retry429ConfigSchema.optional(),
  routes: z.array(RouteQueueConfigSchema).optional(),
});

export type ConcurrencyConfigInput = z.infer<typeof ConcurrencyConfigSchema>;

// SQLite configuration schema
export const SqliteConfigSchema = z.object({
  type: z.literal("sqlite"),
  path: z.string().optional(),
  /** Optional path to sqlite3 CLI; empty/not set resolves `sqlite3` from PATH only. */
  sqlite3Executable: z.string().optional(),
});

export type SqliteConfigInput = z.infer<typeof SqliteConfigSchema>;

// PostgreSQL configuration schema
export const PostgresConfigSchema = z.object({
  type: z.literal("postgres"),
  host: z.string().default("localhost"),
  port: z.number().int().positive().default(5432),
  name: z.string().min(1), // database -> name
  user: z.string().min(1),
  password: z.string().optional(),
  ssl: z.boolean().default(false),
});

export type PostgresConfigInput = z.infer<typeof PostgresConfigSchema>;

// Database configuration schema (union type)
export const DatabaseConfigSchema = z.discriminatedUnion("type", [
  SqliteConfigSchema,
  PostgresConfigSchema,
]);

export type DatabaseConfigInput = z.infer<typeof DatabaseConfigSchema>;

// Logging configuration schema
export const LoggingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  database: DatabaseConfigSchema.optional(),
});

export type LoggingConfigInput = z.infer<typeof LoggingConfigSchema>;

// Full file configuration schema
export const FileConfigSchema = z.object({
  configVersion: z.string().optional(),
  server: ServerConfigSchema.optional(),
  providers: z.record(z.string(), ProviderConfigSchema).optional(),
  defaultProvider: z.string().optional(),
  routing: RoutingConfigSchema.optional(),
  concurrency: ConcurrencyConfigSchema.optional(),
  logging: LoggingConfigSchema.optional(),
});

export type FileConfigInput = z.infer<typeof FileConfigSchema>;

/**
 * SQLite database configuration
 */
export interface SqliteDatabaseConfig {
  type: "sqlite";
  path?: string;
  /** Optional absolute or relative path to the sqlite3 executable; omit to use PATH. */
  sqlite3Executable?: string;
}

/**
 * PostgreSQL database configuration
 */
export interface PostgresDatabaseConfig {
  type: "postgres";
  host: string;
  port: number;
  name: string; // database -> name
  user: string;
  password?: string;
  ssl: boolean;
}

/**
 * Database configuration (union type)
 */
export type DatabaseConfig = SqliteDatabaseConfig | PostgresDatabaseConfig;

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  mode: ProviderMode;
  providerType: ProviderType;
  apiKey?: string;
  authHeader?: string;
  modelMap?: ModelMapEntry[];
  vlModelMap?: ModelMapEntry[];
  /**
   * When false, configured {@link modelMap}/{@link vlModelMap} are not applied. Default is on (undefined = enabled).
   */
  modelMappingEnabled?: boolean;
  headers?: Record<string, string>;
  enabled?: boolean;
  /** When true, GET /models is served locally from {@link Provider.customModelsList} (no upstream). */
  useCustomModelsList?: boolean;
  /** Model ids exposed when {@link Provider.useCustomModelsList} is true. */
  customModelsList?: string[];
  /** Anthropic→Chat Completions: use `azure_openai` to strip fields Azure rejects (e.g. `reasoning`). */
  openaiCompat?: OpenAICompat;
}

export interface RouterConfig {
  port: number;
  host: string;
  autoStart: boolean;
  /** Secret for Authorization: Bearer on /ccrelay/api/*. Never empty after loadConfig. */
  apiBearerToken: string;
  defaultProvider: string;
  providers: Record<string, Provider>;
  routing: {
    forward: ForwardRule[];
    block: BlockRule[];
  };
  concurrency?: ConcurrencyConfig;
  routeQueues?: RouteQueueConfig[]; // Route-based queue configurations
  logging: {
    enabled: boolean;
    database?: DatabaseConfig;
  };
  /** UI language locale; undefined means not yet chosen. */
  locale?: "en" | "zh";
}

export interface RouterStatus {
  status: "running" | "stopped";
  currentProvider: string | null;
  providerName?: string;
  providerMode?: ProviderMode;
  port?: number;
}

export interface ProvidersResponse {
  providers: ProviderInfo[];
  current: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  mode: ProviderMode;
  providerType: ProviderType;
  active: boolean;
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  modelMap?: ModelMapEntry[];
  modelMappingEnabled?: boolean;
  useCustomModelsList?: boolean;
  customModelsList?: string[];
  openaiCompat?: OpenAICompat;
}

export interface ProxyRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Buffer | null;
}

export interface SwitchResponse {
  status: "ok" | "error";
  provider?: string;
  name?: string;
  message?: string;
  available?: string[];
}

// Log-related types
export type RequestStatus = "pending" | "completed";
export type RouteType = "block" | "passthrough" | "router";

export interface RequestLogEntry {
  id: number;
  timestamp: number;
  providerId: string;
  providerName: string;
  method: string;
  path: string;
  requestBody?: string;
  responseBody?: string;
  statusCode?: number;
  duration: number;
  success: boolean;
  errorMessage?: string;
  clientId?: string;
  status?: RequestStatus;
  routeType?: RouteType;
}

export interface LogQueryOptions {
  providerId?: string;
  method?: string;
  pathPattern?: string;
  minDuration?: number;
  maxDuration?: number;
  hasError?: boolean;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

/**
 * Server instance lock information for leader election
 */
export interface ServerLockInfo {
  instanceId: string;
  pid: number;
  port: number;
  host: string;
  startTime: number;
  lastHeartbeat: number;
}

/**
 * Result of leader election
 */
export interface ElectionResult {
  isLeader: boolean;
  leaderUrl?: string;
  existingLeader?: ServerLockInfo;
}

/**
 * Instance role in the multi-instance setup
 */
export type InstanceRole = "leader" | "follower";

/**
 * Message parameter for Anthropic API
 */
export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlockParam[];
}

/**
 * Content block parameter for Anthropic API
 */
export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ThinkingBlockParam
  | ServerToolUseBlockParam
  | ServerToolResultBlockParam;

/**
 * Server-side tool invocation (Anthropic Messages API — executed upstream, no client callback).
 */
export interface ServerToolUseBlockParam {
  type: "server_tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Server-side tool result block (Anthropic Messages API — type varies per tool family).
 */
export interface ServerToolResultBlockParam {
  type: string;
  tool_use_id: string;
  content: unknown;
}

/**
 * True when `block` is a server-tool result (`tool_use_id` present, distinct from client `tool_result`).
 */
export function isServerToolResultBlock(block: { type?: string }): boolean {
  if (!block?.type || block.type === "tool_result") {
    return false;
  }
  return typeof (block as Record<string, unknown>).tool_use_id === "string";
}

/**
 * Anthropic request tool definition for server tools (`type` is not `"custom"`).
 */
export interface AnthropicServerToolDef {
  type: string;
  name: string;
  [key: string]: unknown;
}

/**
 * Thinking content block (with optional signature for Gemini)
 */
export interface ThinkingBlockParam {
  type: "thinking";
  thinking: string;
  signature?: string;
}

/**
 * Text content block
 */
export interface TextBlockParam {
  type: "text";
  text: string;
  cache_control?: { type: string; ttl?: string };
}

/**
 * Image content block
 */
export interface ImageBlockParam {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

/**
 * Tool use content block
 */
export interface ToolUseBlockParam {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result content block
 */
export interface ToolResultBlockParam {
  type: "tool_result";
  tool_use_id: string;
  content?: string | ContentBlockParam[] | Record<string, unknown>;
}

/**
 * Election state machine states for fine-grained control
 */
export type ElectionState =
  | "idle" // Initial state, not started
  | "electing" // Currently running election
  | "leader" // Won election, but server not started yet
  | "leader_active" // Leader with server running
  | "follower" // Following an active leader
  | "waiting"; // Waiting for a new leader to appear

/**
 * Extended role change information for callbacks
 */
export interface RoleChangeInfo {
  role: InstanceRole;
  state: ElectionState;
  leaderUrl?: string;
  error?: Error;
}

/**
 * Retry 429 configuration
 */
export interface Retry429Config {
  enabled: boolean;
  maxRetries: number;
  delayMs: number;
}

/**
 * Concurrency control configuration
 */
export interface ConcurrencyConfig {
  enabled: boolean;
  maxWorkers: number;
  maxQueueSize?: number;
  requestTimeout?: number; // Queue wait timeout in seconds
  retry429?: Retry429Config;
}

/**
 * Route-based queue configuration for handling specific paths with different concurrency
 */
export interface RouteQueueConfig {
  pattern: string; // Regex pattern to match request path
  maxWorkers: number;
  maxQueueSize?: number;
  requestTimeout?: number; // Queue wait timeout in seconds
  name?: string;
  compiledPattern?: RegExp; // Compiled regex for matching
}

/**
 * Provider-level concurrency configuration
 */
export interface ProviderConcurrencyConfig {
  maxWorkers?: number;
}

/**
 * Request task for queue processing
 */
export interface RequestTask {
  id: string;
  method: string;
  targetUrl: string;
  headers: Record<string, string>;
  body: Buffer | null;
  provider: Provider;
  /** Original inbound URL path (before upstream rewrite); used for diagnostics. */
  inboundPath: string;
  requestPath: string;
  requestBodyLog?: string;
  originalRequestBody?: string;
  isOpenAIProvider: boolean;
  /** Inbound client API surface; drives response conversion */
  clientSurface: ApiSurface;
  originalModel?: string;
  clientId: string;
  attempt?: number;
  priority?: number;
  timeout?: number;
  createdAt: number;
  startedAt?: number;
  /** Client had `stream: true` on POST /v1/responses; response may be synthesized as SSE */
  responsesStreamRequested?: boolean;
  /** Client had `stream: true` on cross-protocol POST /v1/chat/completions; response may be synthesized as SSE */
  streamRequested?: boolean;
  /** Fields from client's /v1/responses body echoed into response shells */
  originalResponsesEcho?: ResponsesRequestEcho;
  /** Streaming handler finished writing successfully (avoids disconnect false positives) */
  streamCompleted?: boolean;
  /** Optional response object for streaming support in queue mode */
  res?: http.ServerResponse;
  /** Whether the task has been cancelled */
  cancelled?: boolean;
  /** Reason for cancellation */
  cancelledReason?: string;
  /** AbortController for cancelling the underlying HTTP request */
  abortController?: AbortController;
}

/**
 * Task execution result
 */
export interface ProxyResult {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body?: Buffer | string;
  error?: Error;
  duration: number;
  responseBodyChunks?: Buffer[];
  originalResponseBody?: string;
  errorMessage?: string;
  /** Whether the response was streamed directly to client */
  streamed?: boolean;
  /** True when streamed bytes were flushed before downstream closed (lifecycle / logging only) */
  streamCompleted?: boolean;
}

/**
 * Task status
 */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "timeout";

/**
 * Queue statistics
 */
export interface QueueStats {
  queueLength: number;
  activeWorkers: number;
  maxWorkers: number;
  totalProcessed: number;
  totalFailed: number;
  avgWaitTime: number;
  avgProcessTime: number;
}

/**
 * Semaphore lease for automatic release
 */
export interface SemaphoreLease extends Disposable {
  release(): void;
}
