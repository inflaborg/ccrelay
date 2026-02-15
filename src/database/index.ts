/**
 * Database module for storing request/response logs
 * Exports business-level interface, delegates to driver implementations
 */

import * as path from "path";
import * as os from "os";
import { Logger } from "../utils/logger";
import type { DatabaseDriver, DatabaseDriverConfig } from "./types";
import { createDriver } from "./factory";

// Re-export types
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
   * Initialize the database
   */
  async initialize(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.close();
      this.log.info("[LogDatabase] Initialization skipped - disabled by config");
      return;
    }

    // Avoid double initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInitialize(): Promise<void> {
    try {
      this.log.info(`[LogDatabase] Creating ${this.driverConfig.type} driver...`);

      this.driver = createDriver(this.driverConfig);
      await this.driver.initialize();

      this.log.info("[LogDatabase] Initialization complete");
    } catch (err) {
      this.log.error("[LogDatabase] Failed to initialize", err);
      this.driver = null;
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
   * Clear all logs
   */
  async clearAllLogs(): Promise<void> {
    await this.driver?.clearAllLogs();
  }

  /**
   * Get database statistics
   */
  async getStats() {
    if (!this.driver) {
      return {
        totalLogs: 0,
        successCount: 0,
        errorCount: 0,
        avgDuration: 0,
        byProvider: {},
        pendingWrites: 0,
      };
    }

    const stats = await this.driver.getStats();
    return {
      ...stats,
      pendingWrites: 0, // Driver handles its own queue internally
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
   * Check if database is enabled
   */
  get enabled(): boolean {
    return this.driver?.enabled ?? false;
  }
}

// Singleton instance
let dbInstance: LogDatabase | null = null;

/**
 * Get the database singleton (uses default SQLite config)
 */
export function getDatabase(): LogDatabase {
  if (!dbInstance) {
    dbInstance = new LogDatabase();
  }
  return dbInstance;
}

/**
 * Initialize database with custom configuration
 * Must be called before getDatabase() for custom config to take effect
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
