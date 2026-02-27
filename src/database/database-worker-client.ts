/**
 * Database Worker Client - Main thread client for communicating with database worker
 *
 * This client provides the same interface as DatabaseDriver but routes
 * all operations to a worker thread, keeping the main event loop responsive.
 */

import { Worker } from "worker_threads";
import * as path from "path";
import { Logger } from "../utils/logger";
import type {
  DatabaseDriver,
  RequestLog,
  LogFilter,
  LogQueryResult,
  DatabaseStats,
  RequestStatus,
  DatabaseDriverConfig,
} from "./types";

// Message types (must match worker)
type WorkerMessageType =
  | "init"
  | "close"
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

// Default timeout for worker operations (30 seconds)
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Generate unique request ID
 */
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
  private config: DatabaseDriverConfig;

  constructor(config: DatabaseDriverConfig) {
    this.config = config;
  }

  /**
   * Start the worker thread
   */
  private startWorker(): void {
    if (this.worker) {
      return;
    }

    // Worker is bundled separately by esbuild to out/dist/database-worker.cjs
    // __dirname points to out/dist/ after bundling
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
      // Reject all pending requests
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
    });
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
  async initialize(): Promise<void> {
    this.startWorker();
    await this.send("init", this.config);
    this._enabled = true;
    this.log.info("[DatabaseWorker] Initialized");
  }

  /**
   * Close the database and terminate worker
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.send("close");
      await this.worker.terminate();
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
    originalResponseBody?: string
  ): void {
    void this.send("updateLogCompleted", {
      clientId,
      statusCode,
      responseBody,
      duration,
      success,
      errorMessage,
      originalResponseBody,
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
   * Query logs with filter
   */
  async queryLogs(filter: LogFilter): Promise<LogQueryResult> {
    return this.send<LogQueryResult>("queryLogs", { filter });
  }

  /**
   * Get a single log by ID
   */
  async getLogById(id: number): Promise<RequestLog | null> {
    return this.send<RequestLog | null>("getLogById", { id });
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
   * Get database statistics
   */
  async getStats(): Promise<DatabaseStats> {
    return this.send<DatabaseStats>("getStats");
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
