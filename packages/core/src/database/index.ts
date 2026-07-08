/**
 * Database module for storing request/response logs
 * Exports business-level interface, delegates to driver implementations
 */

import * as path from "path";
import * as os from "os";
import { Logger } from "../utils/logger";
import type { DatabaseDriver, DatabaseDriverConfig } from "./types";
import { createDriver } from "./factory";
import { isSqliteCliUnavailableError } from "./drivers/sqlite";

export type {
  RequestLog,
  LogFilter,
  LogQueryResult,
  RequestStatus,
  RouteType,
  DatabaseStats,
  DatabaseDriverConfig,
  SqliteDriverConfig,
  PostgresDriverConfig,
  LogDbMigrationChoice,
} from "./types";

/**
 * LogDatabase - Simple wrapper around database driver
 * Delegates all operations to the underlying driver implementation
 */
export class LogDatabase {
  private driver: DatabaseDriver | null = null;
  private readonly driverConfig: DatabaseDriverConfig;
  private readonly log = Logger.getInstance();
  private initPromise: Promise<void> | null = null;
  private _logsEnabled = false;

  constructor(customDbPath?: string, driverConfig?: DatabaseDriverConfig) {
    // Determine default path
    const defaultPath = path.join(os.homedir(), ".ccrelay", "logs.db");

    // Use provided config or create default SQLite config
    if (driverConfig) {
      this.driverConfig = driverConfig;
    } else if (customDbPath) {
      this.driverConfig = {
        type: "sqlite",
        path: customDbPath,
      };
    } else {
      this.driverConfig = {
        type: "sqlite",
        path: defaultPath,
      };
    }
  }

  /**
   * Initialize the database for metrics (always on for leader).
   * @param active When false, closes the database (followers).
   * @param logsEnabled When true, also persists request/response bodies to request_logs_v2.
   */
  async initialize(active: boolean, logsEnabled = false): Promise<void> {
    this._logsEnabled = logsEnabled;

    if (!active) {
      await this.close();
      this.log.info("[LogDatabase] Initialization skipped - inactive (follower)");
      return;
    }

    if (this.driver?.enabled) {
      this.setLogsEnabled(logsEnabled);
      return;
    }

    // Avoid double initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize(logsEnabled);

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInitialize(logsEnabled: boolean): Promise<void> {
    try {
      this.log.info(`[LogDatabase] Creating ${this.driverConfig.type} driver...`);
      this.driver = createDriver(this.driverConfig);

      await this.driver.initialize({ migrationChoice: "migrate", logsEnabled });

      this.log.info("[LogDatabase] Initialization complete");
    } catch (err) {
      try {
        await this.driver?.close();
      } catch {
        /* ignore teardown after failed init */
      }
      this.driver = null;

      if (this.driverConfig.type === "sqlite" && isSqliteCliUnavailableError(err)) {
        this.log.warn(
          "[LogDatabase] sqlite3 CLI is not installed or not on PATH; metrics and logs cannot be persisted."
        );
        return;
      }

      this.log.error("[LogDatabase] Failed to initialize", err);
      throw err;
    }
  }

  /**
   * Insert a log entry (async via write queue if supported)
   */
  insertLog(log: Parameters<DatabaseDriver["insertLog"]>[0]): void {
    this.driver?.insertLog(log);
  }

  /**
   * Insert a log entry with "pending" status immediately
   */
  insertLogPending(log: Parameters<DatabaseDriver["insertLogPending"]>[0]): void {
    this.driver?.insertLogPending(log);
  }

  /**
   * Update a log entry by clientId with response data
   */
  updateLogCompleted(...args: Parameters<DatabaseDriver["updateLogCompleted"]>): void {
    this.driver?.updateLogCompleted(...args);
  }

  /**
   * Update a log entry by clientId with custom status (cancelled, timeout, etc.)
   */
  updateLogStatus(...args: Parameters<DatabaseDriver["updateLogStatus"]>): void {
    this.driver?.updateLogStatus(...args);
  }

  /**
   * Query logs with filter
   */
  async queryLogs(filter?: Parameters<DatabaseDriver["queryLogs"]>[0]) {
    if (!this.driver) {
      return { logs: [], total: 0 };
    }
    return this.driver.queryLogs(filter ?? {});
  }

  /**
   * Get a single log by ID
   */
  async getLogById(id: number) {
    return this.driver?.getLogById(id) ?? null;
  }

  /**
   * Delete logs by IDs
   */
  async deleteLogs(ids: number[]): Promise<void> {
    await this.driver?.deleteLogs(ids);
  }

  /**
   * Clear all request log rows (bodies only).
   */
  async clearAllLogs(): Promise<void> {
    await this.driver?.clearAllLogs();
  }

  /**
   * Clear all dashboard metrics.
   */
  async clearAllMetrics(): Promise<void> {
    await this.driver?.clearAllMetrics();
  }

  /**
   * Get database statistics
   */
  async getStats(query?: import("./types").StatsQuery) {
    if (!this.driver) {
      return {
        totalLogs: 0,
        successCount: 0,
        errorCount: 0,
        avgDuration: 0,
        byProvider: {},
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheTokens: 0,
        cacheHitRate: 0,
        avgTtfb: 0,
        outputTps: 0,
        outputTpsSampleCount: 0,
        avgQueueWaitMs: 0,
        p50Duration: 0,
        p90Duration: 0,
        providerBreakdown: [],
        pendingWrites: 0,
      };
    }

    const stats = await this.driver.getStats(query);
    return {
      ...stats,
      pendingWrites: 0,
    };
  }

  /**
   * Close the database
   */
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }

  /**
   * Check if database driver is available (metrics can be read/written).
   */
  get enabled(): boolean {
    return this.driver?.enabled ?? false;
  }

  /**
   * Whether request/response body logging is enabled.
   */
  get logsEnabled(): boolean {
    return this.driver?.logsEnabled ?? this._logsEnabled;
  }

  /**
   * Toggle body logging at runtime (e.g. when logging.enabled changes in config).
   */
  setLogsEnabled(enabled: boolean): void {
    this._logsEnabled = enabled;
    this.driver?.setLogsEnabled(enabled);
  }
}

// Singleton instance
let dbInstance: LogDatabase | null = null;

/** When set before the first {@link getDatabase} call, configures driver from `logging.database`. */
let logDatabaseDriverResolver:
  | (() => import("./types").DatabaseDriverConfig | undefined)
  | undefined;

export function setLogDatabaseDriverConfigResolver(
  fn: (() => import("./types").DatabaseDriverConfig | undefined) | undefined
): void {
  logDatabaseDriverResolver = fn;
}

/** True when a host (e.g. desktop) registered a driver resolver before {@link ProxyServer} starts. */
export function hasLogDatabaseDriverConfigResolver(): boolean {
  return logDatabaseDriverResolver !== undefined;
}

/**
 * Get the database singleton (uses default SQLite ~/.ccrelay/logs.db unless resolver was set).
 */
export function getDatabase(): LogDatabase {
  if (!dbInstance) {
    const resolved = logDatabaseDriverResolver?.();
    dbInstance = resolved !== undefined ? new LogDatabase(undefined, resolved) : new LogDatabase();
  }
  return dbInstance;
}

export { loggingDatabaseConfigToDriver } from "./logging-driver-config";

/**
 * Initialize database with custom configuration
 * Must be called before getDatabase() for custom config to take effect
 * @param config Database configuration
 */
export function initializeDatabase(config: DatabaseDriverConfig): LogDatabase {
  if (dbInstance) {
    console.warn("[LogDatabase] Database already initialized, returning existing instance");
    return dbInstance;
  }
  dbInstance = new LogDatabase(undefined, config);
  return dbInstance;
}

/**
 * Reset the database singleton (for testing or reconfiguration)
 */
export function resetDatabase(): void {
  if (dbInstance) {
    dbInstance.close().catch(err => {
      console.error("[LogDatabase] Error closing database during reset:", err);
    });
  }
  dbInstance = null;
}
