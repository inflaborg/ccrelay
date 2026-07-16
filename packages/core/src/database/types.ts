/**
 * Database driver interface and type definitions
 * Provides abstraction layer for supporting multiple database backends
 */

/**
 * Request status type
 */
export type RequestStatus = "pending" | "completed" | "cancelled" | "timeout";

/**
 * Route type. `service` = handled locally by a registered service interceptor (not upstream proxy).
 */
export type RouteType = "block" | "passthrough" | "router" | "service";

/**
 * Request log entry
 */
export interface RequestLog {
  id?: number;
  timestamp: number;
  providerId: string;
  providerName: string;
  method: string;
  path: string;
  targetUrl?: string;
  requestBody?: string;
  responseBody?: string;
  originalRequestBody?: string;
  originalResponseBody?: string;
  statusCode?: number;
  duration: number;
  success: boolean;
  errorMessage?: string;
  model?: string;
  mappedModel?: string;
  clientId?: string;
  status?: RequestStatus;
  routeType?: RouteType;
  /** When routeType is service: which interceptor handled the request (e.g. web-search). */
  serviceHandler?: string;
  /** JSON string with handler-specific metadata; NULL when none. */
  serviceMeta?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  ttfb?: number;
  /** Queue wait time (enqueue → worker start), ms. */
  queueWaitMs?: number;
  /** Upstream TTFB (request sent → first byte), ms. */
  upstreamTtfbMs?: number;
  /** Post-header generation time (first byte → end), ms. */
  genMs?: number;
  /** End-to-end time (client receive → end), ms. */
  totalMs?: number;
  /** Masked JSON string of upstream-bound request headers (sensitive values masked). */
  requestHeaders?: string;
  /** Masked JSON string of upstream response headers (sensitive values masked). */
  responseHeaders?: string;
}

/** Per-request phase timings (milliseconds). */
export interface LogResponseTiming {
  queueWaitMs?: number;
  upstreamTtfbMs?: number;
  genMs?: number;
  totalMs?: number;
}

/**
 * Log query filter
 */
export interface LogFilter {
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
 * Log query result
 */
export interface LogQueryResult {
  logs: RequestLog[];
  total: number;
}

/**
 * Stats query input (time range filter)
 */
export interface StatsQuery {
  /** Millisecond epoch lower bound; omit for all time */
  since?: number;
}

/**
 * Per-provider row in dashboard breakdown
 */
export interface ProviderStatRow {
  providerId: string;
  providerName: string;
  count: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  cacheHitRate: number;
}

/**
 * Database statistics
 */
export interface DatabaseStats {
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
  /** Average queue wait across rows with queue_wait_ms recorded. */
  avgQueueWaitMs: number;
  p50Duration: number;
  p90Duration: number;
  providerBreakdown: ProviderStatRow[];
}

/**
 * Configuration for SQLite driver
 */
export interface SqliteDriverConfig {
  readonly type: "sqlite";
  readonly path: string;
  readonly sqlite3Executable?: string;
  /** Driver selection: "auto" (default) prefers native, falls back to CLI; "native" forces better-sqlite3; "cli" forces sqlite3 CLI. */
  readonly driver?: "auto" | "native" | "cli";
}

/**
 * Configuration for PostgreSQL driver
 */
export interface PostgresDriverConfig {
  readonly type: "postgres";
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly ssl?: boolean;
}

/**
 * Union type for all driver configurations
 */
export type DatabaseDriverConfig = SqliteDriverConfig | PostgresDriverConfig;

/** User choice when legacy request_logs has rows at startup. */
export type LogDbMigrationChoice = "migrate" | "discard";

export interface DatabaseInitializeOptions {
  migrationChoice?: LogDbMigrationChoice;
  /** When false, only request_metrics rows are written (no request body logging). */
  logsEnabled?: boolean;
}

/**
 * Database driver interface - exposes business-level methods
 * Each driver implementation handles its own SQL dialect internally
 */
export interface DatabaseDriver {
  /**
   * Initialize the database (create tables, indexes, run migrations)
   */
  initialize(options?: DatabaseInitializeOptions): Promise<void>;

  /**
   * Close the database connection gracefully
   */
  close(): Promise<void>;

  /**
   * Insert a log entry (fire-and-forget for async write queue)
   */
  insertLog(log: RequestLog): void;

  /**
   * Insert a log entry with "pending" status immediately
   */
  insertLogPending(log: RequestLog): void;

  /**
   * Update a log entry by clientId with response data
   */
  updateLogCompleted(
    clientId: string,
    statusCode: number,
    responseBody: string | undefined,
    duration: number,
    success: boolean,
    errorMessage: string | undefined,
    originalResponseBody?: string,
    inputTokens?: number,
    outputTokens?: number,
    cacheTokens?: number,
    ttfb?: number,
    responseHeadersMasked?: string,
    timing?: LogResponseTiming
  ): void;

  /**
   * Update a log entry by clientId with custom status (cancelled, timeout, etc.)
   */
  updateLogStatus(
    clientId: string,
    status: RequestStatus,
    statusCode: number,
    duration: number,
    errorMessage: string | undefined
  ): void;

  /**
   * Batch insert logs
   */
  writeBatch(logs: RequestLog[]): Promise<void>;

  /**
   * Query logs with filter
   */
  queryLogs(filter: LogFilter): Promise<LogQueryResult>;

  /**
   * Get a single log by ID (with full body content)
   */
  getLogById(id: number): Promise<RequestLog | null>;

  /**
   * Delete logs by IDs
   */
  deleteLogs(ids: number[]): Promise<void>;

  /**
   * Clear all request log rows (bodies only; metrics are kept).
   */
  clearAllLogs(): Promise<void>;

  /**
   * Clear all token / performance metrics (dashboard statistics).
   */
  clearAllMetrics(): Promise<void>;

  /**
   * Get database statistics
   */
  getStats(query?: StatsQuery): Promise<DatabaseStats>;

  /**
   * Clean old logs (background maintenance)
   */
  cleanOldLogs(): Promise<void>;

  /**
   * Check if the driver is enabled and ready
   */
  readonly enabled: boolean;

  /**
   * Whether request/response body logging to request_logs_v2 is enabled.
   * Metrics are always written when the driver is enabled.
   */
  readonly logsEnabled: boolean;

  /**
   * Toggle body logging without closing the database connection.
   */
  setLogsEnabled(enabled: boolean): void;

  /**
   * Force flush any pending writes
   */
  forceFlush(): void;
}

/**
 * Type guard for SQLite driver config
 */
export function isSqliteConfig(config: DatabaseDriverConfig): config is SqliteDriverConfig {
  return config.type === "sqlite";
}

/**
 * Type guard for PostgreSQL driver config
 */
export function isPostgresConfig(config: DatabaseDriverConfig): config is PostgresDriverConfig {
  return config.type === "postgres";
}
