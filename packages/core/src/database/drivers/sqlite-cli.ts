/**
 * SQLite CLI Driver
 * Manages TWO long-lived sqlite3 CLI processes (read + write) via stdin/stdout pipes.
 * WAL mode enables concurrent reads while a write connection is busy.
 * Implements DatabaseDriver interface with business-level methods.
 */

import { spawn, execSync, ChildProcess } from "child_process";
import * as path from "path";
import * as fsSync from "fs";
import { Logger } from "../../utils/logger";
import type {
  DatabaseDriver,
  SqliteDriverConfig,
  RequestLog,
  LogFilter,
  LogQueryResult,
  DatabaseStats,
  RequestStatus,
} from "../types";

// Cleanup thresholds
const MAX_LOG_ROWS = 10000;
const MAX_LOG_AGE_DAYS = 30;

/**
 * Base64 encoding helpers for storage
 * Uses a prefix to distinguish encoded data from legacy plain text
 */
const BASE64_PREFIX = "B64:";

function encodeForStorage(value: string | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return BASE64_PREFIX + Buffer.from(value, "utf-8").toString("base64");
}

function decodeFromStorage(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.startsWith(BASE64_PREFIX)) {
    try {
      return Buffer.from(value.slice(BASE64_PREFIX.length), "base64").toString("utf-8");
    } catch {
      return value; // Fallback if decode fails
    }
  }
  return value; // Return as-is (legacy plain text)
}

/**
 * Escape a value for safe insertion into a SQL string.
 */
function escapeValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (typeof value === "number") {
    if (!isFinite(value)) {
      return "NULL";
    }
    return value.toString();
  }
  const escaped = value.replace(/\u0000/g, "").replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * Interpolate parameters into a SQL template.
 */
function interpolateSql(
  sql: string,
  params?: (string | number | boolean | null | undefined)[]
): string {
  if (!params || params.length === 0) {
    return sql;
  }

  let paramIndex = 0;
  let result = "";
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (ch === "'" && !inSingleQuote) {
      inSingleQuote = true;
      result += ch;
    } else if (ch === "'" && inSingleQuote) {
      if (i + 1 < sql.length && sql[i + 1] === "'") {
        result += "''";
        i++;
      } else {
        inSingleQuote = false;
        result += ch;
      }
    } else if (ch === "?" && !inSingleQuote) {
      if (paramIndex >= params.length) {
        throw new Error(
          `SQL parameter count mismatch: more ? placeholders than parameters (${params.length})`
        );
      }
      result += escapeValue(params[paramIndex]);
      paramIndex++;
    } else {
      result += ch;
    }
  }

  if (paramIndex !== params.length) {
    throw new Error(
      `SQL parameter count mismatch: ${params.length} parameters but only ${paramIndex} ? placeholders`
    );
  }

  return result;
}

/**
 * Build an INSERT SQL statement for a RequestLog
 */
function buildInsertSql(
  log: RequestLog,
  status: string = "completed"
): {
  sql: string;
  params: (string | number | boolean | null | undefined)[];
} {
  return {
    sql: `INSERT INTO request_logs (
      timestamp, provider_id, provider_name, method, path, target_url,
      request_body, response_body, original_request_body, original_response_body,
      status_code, duration, success, error_message, client_id, status, route_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      log.timestamp,
      log.providerId,
      log.providerName,
      log.method,
      log.path,
      log.targetUrl ?? null,
      encodeForStorage(log.requestBody),
      encodeForStorage(log.responseBody),
      encodeForStorage(log.originalRequestBody),
      encodeForStorage(log.originalResponseBody),
      log.statusCode ?? null,
      log.duration,
      log.success ? 1 : 0,
      encodeForStorage(log.errorMessage),
      log.clientId ?? null,
      status,
      log.routeType ?? null,
    ],
  };
}

/**
 * Convert a database row to RequestLog (without body fields for list view)
 */
function dbRowToLogWithoutBody(row: Record<string, unknown>): RequestLog {
  const log: RequestLog = {
    id: row.id as number,
    timestamp: row.timestamp as number,
    providerId: row.provider_id as string,
    providerName: row.provider_name as string,
    method: row.method as string,
    path: row.path as string,
    statusCode: row.status_code as number | undefined,
    duration: row.duration as number,
    success: (row.success as number) !== 0,
    errorMessage: row.error_message as string | undefined,
    clientId: row.client_id as string | undefined,
    status: row.status as RequestLog["status"],
    routeType: row.route_type as RequestLog["routeType"],
  };

  if (log.errorMessage) {
    log.errorMessage = decodeFromStorage(log.errorMessage);
  }

  const rawRequestBody = row.request_body as string | undefined;
  if (rawRequestBody) {
    const requestBody = decodeFromStorage(rawRequestBody);
    if (requestBody) {
      try {
        const parsed = JSON.parse(requestBody) as { model?: string; data?: { model?: string } };
        const model = parsed.model || parsed.data?.model;
        if (model && typeof model === "string") {
          log.model = model;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  if (!log.model) {
    const pathModelMatch = log.path.match(/\/models\/([^\/\?]+)/);
    if (pathModelMatch) {
      log.model = pathModelMatch[1];
    }
  }

  return log;
}

/**
 * Convert database row to RequestLog (with body fields for detail view)
 */
function dbRowToLog(row: Record<string, unknown>): RequestLog {
  return {
    id: row.id as number,
    timestamp: row.timestamp as number,
    providerId: row.provider_id as string,
    providerName: row.provider_name as string,
    method: row.method as string,
    path: row.path as string,
    targetUrl: row.target_url as string | undefined,
    requestBody: decodeFromStorage(row.request_body as string | undefined),
    responseBody: decodeFromStorage(row.response_body as string | undefined),
    originalRequestBody: decodeFromStorage(row.original_request_body as string | undefined),
    originalResponseBody: decodeFromStorage(row.original_response_body as string | undefined),
    statusCode: row.status_code as number | undefined,
    duration: row.duration as number,
    success: (row.success as number) !== 0,
    errorMessage: decodeFromStorage(row.error_message as string | undefined),
    clientId: row.client_id as string | undefined,
    status: row.status as RequestLog["status"],
    routeType: row.route_type as RequestLog["routeType"],
  };
}

interface PendingQuery {
  sentinelId: string;
  resolve: (rows: Record<string, unknown>[]) => void;
  reject: (error: Error) => void;
  isExec: boolean;
}

// ---------------------------------------------------------------------------
// CliConnection — manages a single sqlite3 CLI subprocess
// ---------------------------------------------------------------------------

class CliConnection {
  private process: ChildProcess | null = null;
  private readonly config: SqliteDriverConfig;
  private readonly sqlite3Path: string;
  private readonly log: Logger;
  private readonly label: string;

  private readonly commandQueue: Array<() => void> = [];
  private isProcessingCommand = false;
  private currentQuery: PendingQuery | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";

  private isClosing = false;
  private restartCount = 0;
  private readonly maxRestarts = 10;
  private isStarted = false;
  private needsRestart = false;
  private readonly commandTimeoutMs = 15_000;
  private commandTimer: NodeJS.Timeout | null = null;

  /** Guards against exit handler spawning a duplicate process during restart */
  private isRestarting = false;
  /** Monotonic generation counter to ignore stale exit/data events */
  private processGeneration = 0;
  /** Timestamp of last successful command — used to decay restartCount */
  private lastSuccessTime = 0;

  private healthCheckInterval: NodeJS.Timeout | null = null;
  private static readonly healthCheckIntervalMs = 30_000;

  constructor(config: SqliteDriverConfig, sqlite3Path: string, log: Logger, label: string) {
    this.config = config;
    this.sqlite3Path = sqlite3Path;
    this.log = log;
    this.label = label;
  }

  get started(): boolean {
    return this.isStarted;
  }

  // ---- Lifecycle ----------------------------------------------------------

  async start(): Promise<void> {
    await this.spawnProcess();
  }

  async close(): Promise<void> {
    this.stopHealthCheck();
    this.isClosing = true;
    this.isStarted = false;

    if (!this.process) {
      this.log.info(`[SqliteCli:${this.label}] IPC channel close requested (no subprocess)`);
      return;
    }

    this.log.info(
      `[SqliteCli:${this.label}] Closing sqlite3 IPC channel (pid=${this.process.pid ?? "?"})`
    );
    const proc = this.process;
    return new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        if (this.process === proc) {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* ignore */
          }
          this.process = null;
        }
        resolve();
      }, 5000);

      proc.once("exit", () => {
        clearTimeout(timeout);
        if (this.process === proc) {
          this.process = null;
        }
        resolve();
      });

      try {
        proc.stdin?.write(".quit\n");
        proc.stdin?.end();
      } catch {
        clearTimeout(timeout);
        if (this.process === proc) {
          this.process = null;
        }
        resolve();
      }
    });
  }

  // ---- Health check -------------------------------------------------------

  startHealthCheck(): void {
    if (this.healthCheckInterval) {
      return;
    }
    this.healthCheckInterval = setInterval(() => {
      if (!this.isStarted || this.isClosing) {
        return;
      }
      this.queryScalar<number>("SELECT 1").catch(() => {
        this.log.warn(`[SqliteCli:${this.label}] Health check failed — rebuilding IPC channel`);
        this.needsRestart = true;
        void this.processNextCommand();
      });
    }, CliConnection.healthCheckIntervalMs);
  }

  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // ---- SQL helpers --------------------------------------------------------

  async exec(
    sql: string,
    params?: (string | number | boolean | null | undefined)[]
  ): Promise<void> {
    const interpolated = interpolateSql(sql, params);
    await this.sendCommand(interpolated, true);
  }

  async query(
    sql: string,
    params?: (string | number | boolean | null | undefined)[]
  ): Promise<Record<string, unknown>[]> {
    const interpolated = interpolateSql(sql, params);
    return this.sendCommand(interpolated, false);
  }

  async queryScalar<T = number>(
    sql: string,
    params?: (string | number | boolean | null | undefined)[]
  ): Promise<T | null> {
    const rows = await this.query(sql, params);
    if (rows.length === 0) {
      return null;
    }
    const firstRow = rows[0];
    const keys = Object.keys(firstRow);
    if (keys.length === 0) {
      return null;
    }
    return firstRow[keys[0]] as T;
  }

  async transaction(sqls: string[]): Promise<void> {
    const combined = ["BEGIN TRANSACTION", ...sqls, "COMMIT"]
      .map(s => (s.trim().endsWith(";") ? s : s + ";"))
      .join("\n");
    await this.sendCommand(combined, true);
  }

  // ---- Private: process management ----------------------------------------

  private spawnProcess(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const generation = ++this.processGeneration;

      const proc = spawn(this.sqlite3Path, [this.config.path], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
      this.process = proc;

      this.log.info(
        `[SqliteCli:${this.label}] Spawning sqlite3 IPC channel (generation=${generation}, pid=${proc.pid ?? "pending"}, db=${this.config.path})`
      );

      this.stdoutBuffer = "";
      this.stderrBuffer = "";

      proc.stdout.on("data", (data: Buffer) => {
        if (generation !== this.processGeneration) {
          return;
        }
        this.stdoutBuffer += data.toString();
        this.checkForSentinel();
      });

      proc.stderr.on("data", (data: Buffer) => {
        if (generation !== this.processGeneration) {
          return;
        }
        this.stderrBuffer += data.toString();
        this.checkForSentinel();
      });

      proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        // Ignore stale exit events from a previous generation
        if (generation !== this.processGeneration) {
          return;
        }

        this.process = null;

        if (this.commandTimer) {
          clearTimeout(this.commandTimer);
          this.commandTimer = null;
        }

        if (this.currentQuery) {
          this.currentQuery.reject(
            new Error(`sqlite3 process exited (code=${code}, signal=${signal})`)
          );
          this.currentQuery = null;
        }

        // If restart() is driving the respawn, let it handle everything
        if (this.isRestarting || this.isClosing) {
          return;
        }

        if (this.restartCount < this.maxRestarts) {
          this.restartCount++;
          this.log.warn(
            `[SqliteCli:${this.label}] sqlite3 subprocess exited (code=${code}, signal=${signal}) — rebuilding IPC channel (attempt ${this.restartCount}/${this.maxRestarts})`
          );
          this.spawnProcess()
            .then(() => void this.processNextCommand())
            .catch((err: unknown) => {
              this.drainQueueWithError(err instanceof Error ? err : new Error(String(err)));
            });
        } else {
          this.log.error(`[SqliteCli:${this.label}] Max restarts exceeded, draining queue`);
          this.isStarted = false;
          this.drainQueueWithError(new Error("sqlite3 crashed and max restarts exceeded"));
        }
      });

      proc.on("error", (err: Error) => {
        if (generation !== this.processGeneration) {
          return;
        }
        this.log.error(
          `[SqliteCli:${this.label}] sqlite3 spawn/process error (generation=${generation})`,
          err
        );
        reject(err);
      });

      const initCommands = [
        ".mode json",
        ".headers on",
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=30000;",
        "PRAGMA cache_size=-8000;",
        "PRAGMA temp_store=MEMORY;",
        "PRAGMA mmap_size=16777216;",
      ].join("\n");

      const initSentinel = this.generateSentinelId();
      const initSql = `${initCommands}\nSELECT '${initSentinel}' as _s;\n`;

      this.currentQuery = {
        sentinelId: initSentinel,
        resolve: () => {
          this.currentQuery = null;
          this.restartCount = 0;
          this.lastSuccessTime = Date.now();
          if (this.commandTimer) {
            clearTimeout(this.commandTimer);
            this.commandTimer = null;
          }
          this.isStarted = true;
          this.log.info(
            `[SqliteCli:${this.label}] IPC channel established — sentinel handshake OK (generation=${generation}, pid=${proc.pid ?? "?"})`
          );
          resolve();
        },
        reject: err => {
          this.currentQuery = null;
          if (this.commandTimer) {
            clearTimeout(this.commandTimer);
            this.commandTimer = null;
          }
          reject(err);
        },
        isExec: true,
      };

      this.commandTimer = setTimeout(() => {
        void this.handleError(new Error("sqlite3 initialization timed out"));
        reject(new Error("sqlite3 initialization timed out"));
      }, this.commandTimeoutMs);

      this.writeToStdin(initSql);
    });
  }

  private generateSentinelId(): string {
    return `__SENTINEL_${Date.now()}_${Math.random().toString(36).substring(2, 8)}__`;
  }

  private checkForSentinel(): void {
    if (!this.currentQuery) {
      return;
    }

    const sentinel = this.currentQuery.sentinelId;
    const sentinelIdIndex = this.stdoutBuffer.indexOf(sentinel);
    if (sentinelIdIndex === -1) {
      return;
    }

    const sentinelPrefix = `[{"_s":"`;
    const sentinelSuffix = `"}]`;

    const prefixIndex = this.stdoutBuffer.lastIndexOf(sentinelPrefix, sentinelIdIndex);
    if (prefixIndex === -1) {
      return;
    }

    const suffixIndex = this.stdoutBuffer.indexOf(sentinelSuffix, sentinelIdIndex);
    if (suffixIndex === -1) {
      return;
    }

    const sentinelEndIndex = suffixIndex + sentinelSuffix.length;
    const resultText = this.stdoutBuffer.substring(0, prefixIndex).trim();
    this.stdoutBuffer = this.stdoutBuffer.substring(sentinelEndIndex).trimStart();

    const stderrContent = this.stderrBuffer.trim();
    if (stderrContent) {
      this.log.warn(`[SqliteCli:${this.label}] stderr during successful command: ${stderrContent}`);
    }
    this.stderrBuffer = "";

    if (this.commandTimer) {
      clearTimeout(this.commandTimer);
      this.commandTimer = null;
    }

    // Decay restart count after sustained healthy operation (>60s since last success)
    if (this.restartCount > 0 && Date.now() - this.lastSuccessTime > 60_000) {
      this.restartCount = Math.max(0, this.restartCount - 1);
    }
    this.lastSuccessTime = Date.now();

    if (this.currentQuery.isExec || !resultText) {
      this.currentQuery.resolve([]);
      this.currentQuery = null;
      void this.processNextCommand();
      return;
    }

    try {
      const rows = this.parseJsonOutput(resultText);
      this.currentQuery.resolve(rows);
    } catch (err) {
      void this.handleError(
        new Error(`Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`)
      );
      return;
    }

    this.currentQuery = null;
    void this.processNextCommand();
  }

  private async handleError(error: Error): Promise<void> {
    const stderrPreview = this.stderrBuffer.trim();
    const stderrSuffix =
      stderrPreview.length > 0
        ? ` | stderr: ${stderrPreview.slice(0, 400)}${stderrPreview.length > 400 ? "…" : ""}`
        : "";
    this.log.warn(
      `[SqliteCli:${this.label}] IPC channel fault — ${error.message}${stderrSuffix}; scheduling subprocess rebuild`
    );

    this.needsRestart = true;
    this.stderrBuffer = "";
    this.stdoutBuffer = "";

    if (this.commandTimer) {
      clearTimeout(this.commandTimer);
      this.commandTimer = null;
    }

    if (this.currentQuery) {
      this.currentQuery.reject(error);
      this.currentQuery = null;
    }

    await this.processNextCommand();
  }

  private parseJsonOutput(text: string): Record<string, unknown>[] {
    const trimmed = text.trim();
    if (!trimmed) {
      return [];
    }

    const results: Record<string, unknown>[] = [];
    let currentArray = "";
    let bracketDepth = 0;
    let inArray = false;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];

      if (char === "[") {
        if (bracketDepth === 0) {
          inArray = true;
          currentArray = "";
        }
        bracketDepth++;
        currentArray += char;
      } else if (char === "]") {
        bracketDepth--;
        currentArray += char;
        if (bracketDepth === 0 && inArray) {
          try {
            const parsed = JSON.parse(currentArray.trim()) as unknown[];
            const objects = parsed.filter(
              (item): item is Record<string, unknown> =>
                typeof item === "object" && item !== null && !Array.isArray(item)
            );
            results.push(...objects);
          } catch {
            this.log.warn(
              `[SqliteCli:${this.label}] Skipped malformed JSON array chunk: ${currentArray.trim()}`
            );
          }
          inArray = false;
          currentArray = "";
        }
      } else if (inArray) {
        currentArray += char;
      }
    }

    return results;
  }

  /**
   * Write data to stdin with backpressure awareness.
   * The command timer still guards against a total hang if the pipe stays full.
   */
  private writeToStdin(data: string): void {
    if (!this.process?.stdin || this.process.stdin.destroyed) {
      return;
    }
    const ok = this.process.stdin.write(data);
    if (!ok) {
      this.process.stdin.once("drain", () => {
        // Pipe drained — sentinel callback will drive the next step
      });
    }
  }

  private sendCommand(sql: string, isExec: boolean): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const task = () => {
        if (!this.process || !this.process.stdin) {
          reject(new Error("sqlite3 process is not running"));
          void this.processNextCommand();
          return;
        }

        const sentinelId = this.generateSentinelId();

        this.currentQuery = {
          sentinelId,
          resolve,
          reject,
          isExec,
        };

        this.stderrBuffer = "";

        const trimmedSql = sql.trim();
        const finalSql = trimmedSql.endsWith(";") ? trimmedSql : `${trimmedSql};`;
        const command = `${finalSql}\nSELECT '${sentinelId}' as _s;\n`;
        const safeCommand = this.validateAndSanitize(command);

        this.writeToStdin(safeCommand);
      };

      this.commandQueue.push(task);

      if (!this.isProcessingCommand) {
        void this.processNextCommand();
      }
    });
  }

  private async processNextCommand(): Promise<void> {
    if (this.needsRestart) {
      await this.restart();
    }

    if (this.commandQueue.length === 0) {
      this.isProcessingCommand = false;
      return;
    }

    this.isProcessingCommand = true;

    if (this.commandTimer) {
      clearTimeout(this.commandTimer);
    }
    this.commandTimer = setTimeout(() => {
      const stderrInfo = this.stderrBuffer.trim();
      void this.handleError(
        new Error(
          `Command timed out after ${this.commandTimeoutMs}ms${stderrInfo ? `: ${stderrInfo}` : ""}`
        )
      );
    }, this.commandTimeoutMs);

    const next = this.commandQueue.shift()!;
    next();
  }

  private validateAndSanitize(command: string): string {
    if (command.includes("\u0000")) {
      return command.replace(/\u0000/g, "");
    }
    return command;
  }

  private drainQueueWithError(_err: Error): void {
    const pending = this.commandQueue.splice(0);
    this.isProcessingCommand = false;
    for (const task of pending) {
      try {
        task();
      } catch {
        // task's reject will fire with "process not running"
      }
    }
  }

  /**
   * Kill the current process safely and respawn.
   * Uses isRestarting flag + processGeneration counter to prevent the
   * exit handler from spawning a duplicate process.
   */
  private async restart(): Promise<void> {
    if (!this.needsRestart) {
      return;
    }
    this.needsRestart = false;
    this.isRestarting = true;

    this.log.warn(
      `[SqliteCli:${this.label}] Rebuilding IPC channel (replacing subprocess, generation=${this.processGeneration})`
    );

    if (this.process) {
      const oldProc = this.process;
      this.process = null;

      // Detach all listeners so the old process's exit event
      // does not interfere with the new process.
      oldProc.removeAllListeners("exit");
      oldProc.removeAllListeners("error");
      oldProc.stdout?.removeAllListeners("data");
      oldProc.stderr?.removeAllListeners("data");

      try {
        oldProc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }

    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.currentQuery = null;

    try {
      await this.spawnProcess();
    } catch (err) {
      this.log.error(`[SqliteCli:${this.label}] Restart failed:`, err);
      this.isStarted = false;
    } finally {
      this.isRestarting = false;
    }
  }
}

// ---------------------------------------------------------------------------
// WriteQueue — async batching with retry and failure persistence
// ---------------------------------------------------------------------------

class WriteQueue {
  private queue: RequestLog[] = [];
  private conn: CliConnection | null = null;
  private failedWritesPath: string | null = null;
  private isProcessing = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly batchSize = 50;
  private readonly flushInterval = 1000;
  private isEnabled = false;

  setConnection(conn: CliConnection, failedWritesPath: string): void {
    this.conn = conn;
    this.failedWritesPath = failedWritesPath;
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  add(log: RequestLog): void {
    if (!this.isEnabled || !this.conn) {
      return;
    }
    this.queue.push(log);

    if (this.queue.length >= this.batchSize) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flush();
      }, this.flushInterval);
    }
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.isProcessing || this.queue.length === 0 || !this.conn) {
      return;
    }

    this.isProcessing = true;
    const itemsToWrite = this.queue.splice(0);

    void this.flushWithRetry(itemsToWrite).finally(() => {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        this.flush();
      }
    });
  }

  private async flushWithRetry(items: RequestLog[]): Promise<void> {
    const maxRetries = 3;
    const delays = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.writeBatch(items);
        return;
      } catch (err) {
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, delays[attempt]));
        } else {
          this.persistFailedWrites(items);
          console.error("[WriteQueue] Failed to write logs after retries, saved to disk:", err);
        }
      }
    }
  }

  private async writeBatch(logs: RequestLog[]): Promise<void> {
    if (!this.conn) {
      return;
    }
    const stmts = logs.map(log => {
      const { sql, params } = buildInsertSql(log);
      return interpolateSql(sql, params);
    });
    await this.conn.transaction(stmts);
  }

  private persistFailedWrites(items: RequestLog[]): void {
    if (!this.failedWritesPath) {
      return;
    }
    try {
      const lines = items.map(log => JSON.stringify(log)).join("\n") + "\n";
      fsSync.appendFileSync(this.failedWritesPath, lines);
    } catch (err) {
      console.error("[WriteQueue] Failed to persist writes to disk:", err);
    }
  }

  async replayFailedWrites(): Promise<void> {
    if (!this.failedWritesPath || !this.conn) {
      return;
    }
    if (!fsSync.existsSync(this.failedWritesPath)) {
      return;
    }

    const content = fsSync.readFileSync(this.failedWritesPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      return;
    }

    const logs: RequestLog[] = lines.map(line => JSON.parse(line) as RequestLog);
    try {
      await this.writeBatch(logs);
      fsSync.unlinkSync(this.failedWritesPath);
    } catch {
      console.error("[WriteQueue] Failed to replay persisted writes");
    }
  }

  clear(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.queue = [];
  }

  get size(): number {
    return this.queue.length;
  }

  forceFlush(): void {
    this.flush();
  }
}

// ---------------------------------------------------------------------------
// SqliteCliDriver — DatabaseDriver implementation using two CLI processes
// ---------------------------------------------------------------------------

export class SqliteCliDriver implements DatabaseDriver {
  private readonly config: SqliteDriverConfig;
  private readonly log = Logger.getInstance();
  private sqlite3Path: string | null = null;

  private writeConn: CliConnection | null = null;
  private readConn: CliConnection | null = null;

  private readonly writeQueue: WriteQueue = new WriteQueue();
  private isEnabled = false;

  constructor(config: SqliteDriverConfig) {
    this.config = config;
  }

  /**
   * Initialize the database with dual read/write connections
   */
  async initialize(): Promise<void> {
    const dbPath = this.config.path;
    const dir = path.dirname(dbPath);

    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }

    this.sqlite3Path = this.findSqlite3();
    if (!this.sqlite3Path) {
      throw new Error("sqlite3 CLI not found. Please install SQLite3.");
    }

    this.log.info(`[SqliteCli] Database path: ${dbPath}`);

    this.writeConn = new CliConnection(this.config, this.sqlite3Path, this.log, "write");
    await this.writeConn.start();
    await this.createSchema();

    this.readConn = new CliConnection(this.config, this.sqlite3Path, this.log, "read");
    try {
      await this.readConn.start();
      this.readConn.startHealthCheck();
    } catch (err) {
      this.log.warn(
        `[SqliteCli] Read connection failed to start, operating in write-only mode: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const failedWritesPath = path.join(path.dirname(dbPath), "failed-writes.jsonl");
    this.writeQueue.setConnection(this.writeConn, failedWritesPath);
    await this.writeQueue.replayFailedWrites();

    this.isEnabled = true;
    this.writeQueue.setEnabled(true);

    this.writeConn.startHealthCheck();

    setTimeout(() => {
      this.cleanOldLogs().catch(err => {
        this.log.error("[SqliteCli] Background cleanup failed:", err);
      });
    }, 0);
  }

  private findSqlite3(): string | null {
    try {
      const result = execSync("which sqlite3", { encoding: "utf-8" }).trim();
      if (result) {
        return result;
      }
    } catch {
      // which may fail in sandboxed / packaged environments with limited PATH
    }
    const fallbacks =
      process.platform === "win32"
        ? ["C:\\Windows\\System32\\sqlite3.exe"]
        : ["/usr/bin/sqlite3", "/opt/homebrew/bin/sqlite3", "/usr/local/bin/sqlite3"];
    for (const p of fallbacks) {
      if (fsSync.existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  async close(): Promise<void> {
    this.isEnabled = false;
    this.writeQueue.setEnabled(false);
    this.writeQueue.forceFlush();

    if (this.readConn) {
      await this.readConn.close();
      this.readConn = null;
    }
    if (this.writeConn) {
      await this.writeConn.close();
      this.writeConn = null;
    }
  }

  private async createSchema(): Promise<void> {
    if (!this.writeConn) {
      return;
    }

    await this.writeConn.exec(`
      CREATE TABLE IF NOT EXISTS request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        provider_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        target_url TEXT,
        request_body TEXT,
        response_body TEXT,
        original_request_body TEXT,
        original_response_body TEXT,
        status_code INTEGER,
        duration INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error_message TEXT,
        client_id TEXT,
        status TEXT DEFAULT 'completed',
        route_type TEXT
      )
    `);

    const indexes = [
      "CREATE INDEX IF NOT EXISTS idx_timestamp ON request_logs(timestamp)",
      "CREATE INDEX IF NOT EXISTS idx_provider_id ON request_logs(provider_id)",
      "CREATE INDEX IF NOT EXISTS idx_path ON request_logs(path)",
      "CREATE INDEX IF NOT EXISTS idx_success ON request_logs(success)",
      "CREATE INDEX IF NOT EXISTS idx_client_id ON request_logs(client_id)",
      "CREATE INDEX IF NOT EXISTS idx_status ON request_logs(status)",
    ];

    for (const sql of indexes) {
      await this.writeConn.exec(sql);
    }

    try {
      const columns = await this.writeConn.query("PRAGMA table_info(request_logs)");
      const columnNames = columns.map(c => c.name as string);

      const migrations: Array<{ column: string; sql: string }> = [
        { column: "target_url", sql: "ALTER TABLE request_logs ADD COLUMN target_url TEXT" },
        {
          column: "original_request_body",
          sql: "ALTER TABLE request_logs ADD COLUMN original_request_body TEXT",
        },
        {
          column: "original_response_body",
          sql: "ALTER TABLE request_logs ADD COLUMN original_response_body TEXT",
        },
        { column: "client_id", sql: "ALTER TABLE request_logs ADD COLUMN client_id TEXT" },
        {
          column: "status",
          sql: "ALTER TABLE request_logs ADD COLUMN status TEXT DEFAULT 'completed'",
        },
        { column: "route_type", sql: "ALTER TABLE request_logs ADD COLUMN route_type TEXT" },
      ];

      for (const migration of migrations) {
        if (!columnNames.includes(migration.column)) {
          await this.writeConn.exec(migration.sql);
        }
      }
    } catch {
      // Table might not exist yet
    }
  }

  // ---- Write operations (writeConn) --------------------------------------

  insertLog(log: RequestLog): void {
    if (!this.isEnabled) {
      return;
    }
    this.writeQueue.add(log);
  }

  insertLogPending(log: RequestLog): void {
    if (!this.isEnabled || !this.writeConn?.started) {
      return;
    }

    const { sql, params } = buildInsertSql(log, "pending");
    this.writeConn.exec(sql, params).catch(err => {
      this.log.error("[SqliteCli] Failed to insert pending log:", err);
    });
  }

  updateLogCompleted(
    clientId: string,
    statusCode: number,
    responseBody: string | undefined,
    duration: number,
    success: boolean,
    errorMessage: string | undefined,
    originalResponseBody?: string
  ): void {
    if (!this.isEnabled || !this.writeConn?.started) {
      return;
    }

    this.writeConn
      .exec(
        `UPDATE request_logs
       SET status_code = ?,
           response_body = ?,
           original_response_body = ?,
           duration = ?,
           success = ?,
           error_message = ?,
           status = 'completed'
       WHERE client_id = ?`,
        [
          statusCode,
          encodeForStorage(responseBody),
          encodeForStorage(originalResponseBody),
          duration,
          success ? 1 : 0,
          encodeForStorage(errorMessage),
          clientId,
        ]
      )
      .catch(err => {
        this.log.error("[SqliteCli] Failed to update log:", err);
      });
  }

  updateLogStatus(
    clientId: string,
    status: RequestStatus,
    statusCode: number,
    duration: number,
    errorMessage: string | undefined
  ): void {
    if (!this.isEnabled || !this.writeConn?.started) {
      return;
    }

    this.writeConn
      .exec(
        `UPDATE request_logs
       SET status_code = ?,
           duration = ?,
           success = ?,
           error_message = ?,
           status = ?
       WHERE client_id = ?`,
        [statusCode, duration, 0, encodeForStorage(errorMessage), status, clientId]
      )
      .catch(err => {
        this.log.error("[SqliteCli] Failed to update log status:", err);
      });
  }

  async writeBatch(logs: RequestLog[]): Promise<void> {
    if (!this.writeConn?.started || logs.length === 0) {
      return;
    }

    const stmts: string[] = [];
    for (const log of logs) {
      const { sql, params } = buildInsertSql(log);
      stmts.push(interpolateSql(sql, params));
    }

    await this.writeConn.transaction(stmts);
  }

  async deleteLogs(ids: number[]): Promise<void> {
    if (!this.writeConn?.started || ids.length === 0) {
      return;
    }

    const placeholders = ids.map(() => "?").join(",");
    await this.writeConn.exec(`DELETE FROM request_logs WHERE id IN (${placeholders})`, ids);
  }

  async clearAllLogs(): Promise<void> {
    if (!this.writeConn?.started) {
      return;
    }
    await this.writeConn.exec("DELETE FROM request_logs");
    await this.writeConn.exec("VACUUM");
  }

  async cleanOldLogs(): Promise<void> {
    if (!this.isEnabled || !this.writeConn?.started) {
      return;
    }

    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000;
    await this.writeConn.exec("DELETE FROM request_logs WHERE timestamp < ?", [cutoff]);

    await this.writeConn.exec(`
      DELETE FROM request_logs
      WHERE id NOT IN (
        SELECT id FROM request_logs ORDER BY timestamp DESC LIMIT ${MAX_LOG_ROWS}
      )
    `);
  }

  // ---- Read operations (readConn) ----------------------------------------

  async queryLogs(filter: LogFilter = {}): Promise<LogQueryResult> {
    if (!this.readConn?.started) {
      return { logs: [], total: 0 };
    }

    const conditions: string[] = [];
    const params: (string | number | boolean | null | undefined)[] = [];

    if (filter.providerId) {
      conditions.push("provider_id = ?");
      params.push(filter.providerId);
    }

    if (filter.method) {
      conditions.push("method = ?");
      params.push(filter.method);
    }

    if (filter.pathPattern) {
      conditions.push("path LIKE ?");
      params.push(`%${filter.pathPattern}%`);
    }

    if (filter.minDuration !== undefined) {
      conditions.push("duration >= ?");
      params.push(filter.minDuration);
    }

    if (filter.maxDuration !== undefined) {
      conditions.push("duration <= ?");
      params.push(filter.maxDuration);
    }

    if (filter.hasError !== undefined) {
      conditions.push("success = ?");
      params.push(filter.hasError ? 0 : 1);
    }

    if (filter.startTime !== undefined) {
      conditions.push("timestamp >= ?");
      params.push(filter.startTime);
    }

    if (filter.endTime !== undefined) {
      conditions.push("timestamp <= ?");
      params.push(filter.endTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const total =
      (await this.readConn.queryScalar<number>(
        `SELECT COUNT(*) as count FROM request_logs ${whereClause}`,
        params
      )) ?? 0;

    const limit = filter.limit || 100;
    const offset = filter.offset || 0;

    const rows = await this.readConn.query(
      `SELECT id, timestamp, provider_id, provider_name, method, path,
              status_code, duration, success, error_message, client_id,
              status, route_type, SUBSTR(request_body, 1, 500) as request_body
       FROM request_logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const logs = rows.map(dbRowToLogWithoutBody);

    return { logs, total };
  }

  async getLogById(id: number): Promise<RequestLog | null> {
    if (!this.readConn?.started) {
      return null;
    }

    const rows = await this.readConn.query("SELECT * FROM request_logs WHERE id = ?", [id]);

    if (rows.length === 0) {
      return null;
    }

    return dbRowToLog(rows[0]);
  }

  async getStats(): Promise<DatabaseStats> {
    if (!this.readConn?.started) {
      return {
        totalLogs: 0,
        successCount: 0,
        errorCount: 0,
        avgDuration: 0,
        byProvider: {},
      };
    }

    const rows = await this.readConn.query(
      `SELECT COUNT(*) as totalLogs,
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successCount,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errorCount,
              AVG(duration) as avgDuration
       FROM request_logs`
    );

    const row = rows[0] ?? {};
    const byProviderRows = await this.readConn.query(
      "SELECT provider_id, COUNT(*) as count FROM request_logs GROUP BY provider_id"
    );

    const byProvider: Record<string, number> = {};
    for (const r of byProviderRows) {
      byProvider[r.provider_id as string] = r.count as number;
    }

    return {
      totalLogs: (row.totalLogs as number) ?? 0,
      successCount: (row.successCount as number) ?? 0,
      errorCount: (row.errorCount as number) ?? 0,
      avgDuration: Math.round((row.avgDuration as number) ?? 0),
      byProvider,
    };
  }

  // ---- Properties ---------------------------------------------------------

  get enabled(): boolean {
    return this.isEnabled && this.writeConn?.started === true;
  }

  forceFlush(): void {
    this.writeQueue.forceFlush();
  }
}
