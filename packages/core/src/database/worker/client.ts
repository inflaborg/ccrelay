/**
 * Database Worker Client - Main thread client for communicating with database worker
 *
 * This client provides the same interface as DatabaseDriver but routes
 * all operations to a worker thread, keeping the main event loop responsive.
 */

import { Worker } from "worker_threads";
import * as path from "path";
import { Logger } from "../../utils/logger";
import type {
  DatabaseDriver,
  RequestLog,
  LogFilter,
  LogQueryResult,
  DatabaseStats,
  RequestStatus,
  DatabaseDriverConfig,
  StatsQuery,
  DatabaseInitializeOptions,
  LogDbMigrationChoice,
  SqliteDriverConfig,
} from "../types";

// Message types (must match worker)
type WorkerMessageType =
  | "init"
  | "close"
  | "setLogsEnabled"
  | "insertLog"
  | "insertLogPending"
  | "updateLogCompleted"
  | "updateLogStatus"
  | "writeBatch"
  | "queryLogs"
  | "getLogById"
  | "deleteLogs"
  | "clearAllLogs"
  | "getStats"
  | "cleanOldLogs"
  | "forceFlush";

interface WorkerMessage {
  id: string;
  type: WorkerMessageType;
  payload?: unknown;
}

interface WorkerResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Outer timeout must be larger than CliConnection.commandTimeoutMs (15s)
 * to give the inner layer time to detect and recover from errors.
 */
const DEFAULT_TIMEOUT_MS = 25_000;

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Database Worker Client - Proxies database operations to worker thread
 */
export class DatabaseWorkerClient implements DatabaseDriver {
  private worker: Worker | null = null;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private log = Logger.getInstance();
  private _enabled: boolean = false;
  private _logsEnabled: boolean = false;
  private config: DatabaseDriverConfig;
  private isClosing = false;

  private workerRestartCount = 0;
  private readonly maxWorkerRestarts = 5;
  private workerRestartTimer: NodeJS.Timeout | null = null;

  constructor(config: DatabaseDriverConfig) {
    this.config = config;
  }

  /**
   * Start the worker thread and wire up event handlers
   */
  private startWorker(): void {
    if (this.worker) {
      return;
    }

    const workerPath = path.join(__dirname, "database-worker.cjs");
    this.worker = new Worker(workerPath);

    this.worker.on("message", (response: WorkerResponse) => {
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);

        if (response.success) {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(response.error ?? "Unknown worker error"));
        }
      }
    });

    this.worker.on("error", err => {
      this.log.error("[DatabaseWorker] Worker error:", err);
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(err);
        this.pendingRequests.delete(id);
      }
    });

    this.worker.on("exit", code => {
      this.log.info(`[DatabaseWorker] Worker exited with code ${code}`);
      this.worker = null;
      this._enabled = false;

      if (!this.isClosing) {
        void this.restartWorker();
      }
    });
  }

  /**
   * Automatically restart the worker thread with exponential backoff.
   * Resets the restart counter on success so transient crashes don't
   * permanently disable the database.
   */
  private async restartWorker(): Promise<void> {
    if (this.isClosing) {
      return;
    }

    if (this.workerRestartCount >= this.maxWorkerRestarts) {
      this.log.error(
        "[DatabaseWorker] Max worker restarts exceeded, database permanently disabled"
      );
      return;
    }

    this.workerRestartCount++;
    const delay = Math.min(1000 * Math.pow(2, this.workerRestartCount - 1), 30_000);
    this.log.warn(
      `[DatabaseWorker] Scheduling worker restart in ${delay}ms (attempt ${this.workerRestartCount}/${this.maxWorkerRestarts})`
    );

    await new Promise<void>(resolve => {
      this.workerRestartTimer = setTimeout(resolve, delay);
    });
    this.workerRestartTimer = null;

    if (this.isClosing) {
      return;
    }

    try {
      this.startWorker();
      await this.send("init", {
        config: this.config,
        migrationChoice: "migrate" as LogDbMigrationChoice,
      });
      this._enabled = true;
      this.workerRestartCount = 0;
      this.log.info("[DatabaseWorker] Worker restarted successfully");
    } catch (err) {
      this.log.error("[DatabaseWorker] Worker restart failed:", err);
      // The exit handler will trigger another attempt if the worker crashed
    }
  }

  /**
   * Send message to worker and wait for response
   */
  private async send<T = unknown>(
    type: WorkerMessageType,
    payload?: unknown,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const id = generateRequestId();
      const message: WorkerMessage = { id, type, payload };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Worker operation timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timeout,
      });

      this.worker.postMessage(message);
    });
  }

  /**
   * Initialize the database
   */
  async initialize(options?: DatabaseInitializeOptions): Promise<void> {
    this.isClosing = false;
    this._logsEnabled = options?.logsEnabled ?? false;
    this.startWorker();
    await this.send("init", {
      config: this.config as SqliteDriverConfig,
      migrationChoice: options?.migrationChoice ?? "migrate",
      logsEnabled: this._logsEnabled,
    });
    this._enabled = true;
    this.log.info("[DatabaseWorker] Initialized");
  }

  /**
   * Close the database and terminate worker
   */
  async close(): Promise<void> {
    this.isClosing = true;

    if (this.workerRestartTimer) {
      clearTimeout(this.workerRestartTimer);
      this.workerRestartTimer = null;
    }

    if (this.worker) {
      try {
        await this.send("close");
      } catch {
        // Worker may already be dead
      }
      try {
        await this.worker.terminate();
      } catch {
        // ignore
      }
      this.worker = null;
    }
    this._enabled = false;
  }

  /**
   * Check if driver is enabled
   */
  get enabled(): boolean {
    return this._enabled;
  }

  get logsEnabled(): boolean {
    return this._logsEnabled;
  }

  setLogsEnabled(enabled: boolean): void {
    this._logsEnabled = enabled;
    if (this.worker) {
      void this.send("setLogsEnabled", { enabled }).catch(err => {
        this.log.error("[DatabaseWorker] setLogsEnabled error:", err);
      });
    }
  }

  /**
   * Insert a log entry (fire-and-forget)
   */
  insertLog(log: RequestLog): void {
    void this.send("insertLog", log).catch(err => {
      this.log.error("[DatabaseWorker] insertLog error:", err);
    });
  }

  /**
   * Insert a log entry with "pending" status
   */
  insertLogPending(log: RequestLog): void {
    void this.send("insertLogPending", log).catch(err => {
      this.log.error("[DatabaseWorker] insertLogPending error:", err);
    });
  }

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
    responseHeadersMasked?: string
  ): void {
    void this.send("updateLogCompleted", {
      clientId,
      statusCode,
      responseBody,
      duration,
      success,
      errorMessage,
      originalResponseBody,
      inputTokens,
      outputTokens,
      cacheTokens,
      ttfb,
      responseHeadersMasked,
    }).catch(err => {
      this.log.error("[DatabaseWorker] updateLogCompleted error:", err);
    });
  }

  /**
   * Update a log entry by clientId with custom status
   */
  updateLogStatus(
    clientId: string,
    status: RequestStatus,
    statusCode: number,
    duration: number,
    errorMessage: string | undefined
  ): void {
    void this.send("updateLogStatus", {
      clientId,
      status,
      statusCode,
      duration,
      errorMessage,
    }).catch(err => {
      this.log.error("[DatabaseWorker] updateLogStatus error:", err);
    });
  }

  /**
   * Batch insert logs
   */
  async writeBatch(logs: RequestLog[]): Promise<void> {
    await this.send("writeBatch", logs);
  }

  /**
   * Query logs with filter — returns empty on failure for graceful degradation
   */
  async queryLogs(filter: LogFilter): Promise<LogQueryResult> {
    try {
      return await this.send<LogQueryResult>("queryLogs", { filter });
    } catch (err) {
      this.log.warn(
        `[DatabaseWorker] queryLogs failed, returning empty: ${err instanceof Error ? err.message : String(err)}`
      );
      return { logs: [], total: 0 };
    }
  }

  /**
   * Get a single log by ID — returns null on failure
   */
  async getLogById(id: number): Promise<RequestLog | null> {
    try {
      return await this.send<RequestLog | null>("getLogById", { id });
    } catch (err) {
      this.log.warn(
        `[DatabaseWorker] getLogById failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
  }

  /**
   * Delete logs by IDs
   */
  async deleteLogs(ids: number[]): Promise<void> {
    await this.send("deleteLogs", { ids });
  }

  /**
   * Clear all logs
   */
  async clearAllLogs(): Promise<void> {
    await this.send("clearAllLogs");
  }

  /**
   * Get database statistics — returns zeroed stats on failure
   */
  async getStats(query?: StatsQuery): Promise<DatabaseStats> {
    try {
      return await this.send<DatabaseStats>("getStats", { query });
    } catch (err) {
      this.log.warn(
        `[DatabaseWorker] getStats failed, returning empty: ${err instanceof Error ? err.message : String(err)}`
      );
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
        p50Duration: 0,
        p90Duration: 0,
        providerBreakdown: [],
      };
    }
  }

  /**
   * Clean old logs (background maintenance)
   */
  async cleanOldLogs(): Promise<void> {
    await this.send("cleanOldLogs");
  }

  /**
   * Force flush any pending writes
   */
  forceFlush(): void {
    void this.send("forceFlush").catch(err => {
      this.log.error("[DatabaseWorker] forceFlush error:", err);
    });
  }
}
