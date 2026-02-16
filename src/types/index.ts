/**
 * Core types for CCRelay VSCode extension
 */

/* eslint-disable @typescript-eslint/naming-convention */
// External API fields use snake_case (media_type, tool_use_id, etc.)

import * as http from "http";
import { z } from "zod";

export type ProviderMode = "passthrough" | "inject";

export type ProviderType = "anthropic" | "openai";

/**
 * Zod schemas for runtime type validation
 */

// Provider mode enum schema
export const ProviderModeSchema = z.enum(["passthrough", "inject"]);

// Provider type enum schema
export const ProviderTypeSchema = z.enum(["anthropic", "openai"]);

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
  modelMap: z.record(z.string(), z.string()).optional(),
  model_map: z.record(z.string(), z.string()).optional(),
  vlModelMap: z.record(z.string(), z.string()).optional(),
  vl_model_map: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

export type ProviderConfigInput = z.infer<typeof ProviderConfigSchema>;

// Server configuration schema
export const ServerConfigSchema = z.object({
  port: z.number().int().positive().default(7575),
  host: z.string().default("127.0.0.1"),
  autoStart: z.boolean().default(true),
});

export type ServerConfigInput = z.infer<typeof ServerConfigSchema>;

// Block pattern schema with custom response
export const BlockPatternSchema = z.object({
  path: z.string(),
  response: z.string(),
  code: z.number().optional(), // responseCode -> code
});

export type BlockPattern = z.infer<typeof BlockPatternSchema>;

// Routing configuration schema
export const RoutingConfigSchema = z.object({
  proxy: z.array(z.string()).optional(),
  passthrough: z.array(z.string()).optional(),
  block: z.array(BlockPatternSchema).optional(),
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

// Concurrency configuration schema
export const ConcurrencyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxWorkers: z.number().int().positive().default(3),
  maxQueueSize: z.number().int().nonnegative().optional(),
  requestTimeout: z.number().nonnegative().optional(), // Queue wait timeout in seconds (supports fractions)
  routes: z.array(RouteQueueConfigSchema).optional(),
});

export type ConcurrencyConfigInput = z.infer<typeof ConcurrencyConfigSchema>;

// SQLite configuration schema
export const SqliteConfigSchema = z.object({
  type: z.literal("sqlite"),
  path: z.string().optional(),
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
  modelMap?: Record<string, string>;
  vlModelMap?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface RouterConfig {
  port: number;
  host: string;
  autoStart: boolean;
  defaultProvider: string;
  providers: Record<string, Provider>;
  routing: {
    proxy: string[];
    passthrough: string[];
    block: BlockPattern[];
    openaiBlock: BlockPattern[];
  };
  concurrency?: ConcurrencyConfig;
  routeQueues?: RouteQueueConfig[]; // Route-based queue configurations
  logging: {
    enabled: boolean;
    database?: DatabaseConfig;
  };
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
  | ThinkingBlockParam;

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
 * Concurrency control configuration
 */
export interface ConcurrencyConfig {
  enabled: boolean;
  maxWorkers: number;
  maxQueueSize?: number;
  requestTimeout?: number; // Queue wait timeout in seconds
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
  requestPath: string;
  requestBodyLog?: string;
  originalRequestBody?: string;
  isOpenAIProvider: boolean;
  originalModel?: string;
  clientId: string;
  attempt?: number;
  priority?: number;
  timeout?: number;
  createdAt: number;
  startedAt?: number;
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
