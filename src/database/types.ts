/**
 * Database driver interface and type definitions
 * Provides abstraction layer for supporting multiple database backends
 */

/**
 * Request status type
 */
export type RequestStatus = "pending" | "completed";

/**
 * Route type
 */
export type RouteType = "block" | "passthrough" | "router";

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
  clientId?: string;
  status?: RequestStatus;
  routeType?: RouteType;
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
 * Database statistics
 */
export interface DatabaseStats {
  totalLogs: number;
  successCount: number;
  errorCount: number;
  avgDuration: number;
  byProvider: Record<string, number>;
}

/**
 * Configuration for SQLite driver
 */
export interface SqliteDriverConfig {
  readonly type: "sqlite";
  readonly path: string;
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

/**
 * Database driver interface - exposes business-level methods
 * Each driver implementation handles its own SQL dialect internally
 */
export interface DatabaseDriver {
  /**
   * Initialize the database (create tables, indexes, run migrations)
   */
  initialize(): Promise<void>;

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
    originalResponseBody?: string
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
   * Clear all logs
   */
  clearAllLogs(): Promise<void>;

  /**
   * Get database statistics
   */
  getStats(): Promise<DatabaseStats>;

  /**
   * Clean old logs (background maintenance)
   */
  cleanOldLogs(): Promise<void>;

  /**
   * Check if the driver is enabled and ready
   */
  readonly enabled: boolean;

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
