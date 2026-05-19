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
  ProviderStatRow,
  RequestStatus,
  StatsQuery,
} from "../types";
import {
  MAX_LOG_ROWS,
  MAX_LOG_AGE_DAYS,
  encodeForStorage,
  buildInsertSql,
  dbRowToLogWithoutBody,
  dbRowToLog,
} from "./sqlite-utils";

/** Thrown when the `sqlite3` executable is absent; callers may degrade to disabled log storage. */
export const SQLITE_CLI_NOT_FOUND_MESSAGE = "sqlite3 CLI not found. Please install SQLite3.";

export function isSqliteCliUnavailableError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("sqlite3 CLI not found");
}

/** Resolve `sqlite3` on PATH only (no hardcoded install directories). */
export function resolveSqlite3ExecutableFromEnv(): string | null {
  try {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "where sqlite3" : "command -v sqlite3";
    const baseOpts = {
      encoding: "utf-8" as const,
      maxBuffer: 2048,
    };
    const result = isWin
      ? execSync(cmd, {
          ...baseOpts,
          shell: process.env.ComSpec || "cmd.exe",
        })
      : execSync(cmd, {
          ...baseOpts,
          shell: "/bin/sh",
        });
    const trimmed = result.trim();
    const first = trimmed
      .split(/\r?\n/)
      .find(line => line.trim().length > 0)
      ?.trim();
    return first ?? null;
  } catch {
    return null;
  }
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

    this.sqlite3Path = this.resolveSqlite3ExecutablePath();
    if (!this.sqlite3Path) {
      throw new Error(SQLITE_CLI_NOT_FOUND_MESSAGE);
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

  private resolveSqlite3ExecutablePath(): string | null {
    const custom = this.config.sqlite3Executable?.trim();
    if (custom) {
      return fsSync.existsSync(custom) ? custom : null;
    }
    return resolveSqlite3ExecutableFromEnv();
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
        route_type TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_tokens INTEGER,
        ttfb INTEGER
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
        { column: "input_tokens", sql: "ALTER TABLE request_logs ADD COLUMN input_tokens INTEGER" },
        {
          column: "output_tokens",
          sql: "ALTER TABLE request_logs ADD COLUMN output_tokens INTEGER",
        },
        { column: "cache_tokens", sql: "ALTER TABLE request_logs ADD COLUMN cache_tokens INTEGER" },
        { column: "ttfb", sql: "ALTER TABLE request_logs ADD COLUMN ttfb INTEGER" },
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
    originalResponseBody?: string,
    inputTokens?: number,
    outputTokens?: number,
    cacheTokens?: number,
    ttfb?: number
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
           status = 'completed',
           input_tokens = ?,
           output_tokens = ?,
           cache_tokens = ?,
           ttfb = ?
       WHERE client_id = ?`,
        [
          statusCode,
          encodeForStorage(responseBody),
          encodeForStorage(originalResponseBody),
          duration,
          success ? 1 : 0,
          encodeForStorage(errorMessage),
          inputTokens ?? null,
          outputTokens ?? null,
          cacheTokens ?? null,
          ttfb ?? null,
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
              status, route_type,
              input_tokens, output_tokens, cache_tokens, ttfb,
              SUBSTR(request_body, 1, 500) as request_body,
              SUBSTR(original_request_body, 1, 500) as original_request_body
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

  async getStats(query?: StatsQuery): Promise<DatabaseStats> {
    const empty: DatabaseStats = {
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

    if (!this.readConn?.started) {
      return empty;
    }

    const since = query?.since;
    const sinceParam = since ? since : null;
    const timeFilter = since ? "(? IS NULL OR timestamp >= ?)" : "1=1";
    const timeParams = since ? [sinceParam, sinceParam] : [];

    // 1. Base stats + token aggregation
    const baseRows = await this.readConn.query(
      `SELECT COUNT(*) as totalLogs,
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successCount,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errorCount,
              AVG(duration) as avgDuration,
              COALESCE(SUM(input_tokens), 0) as totalInputTokens,
              COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
              COALESCE(SUM(cache_tokens), 0) as totalCacheTokens,
              AVG(ttfb) as avgTtfb
       FROM request_logs
       WHERE ${timeFilter}`,
      timeParams
    );
    const base = baseRows[0] ?? {};
    const totalInput = (base.totalInputTokens as number) ?? 0;
    const totalOutput = (base.totalOutputTokens as number) ?? 0;
    const totalCache = (base.totalCacheTokens as number) ?? 0;
    const denominator = totalInput + totalCache;

    // 2. Filtered TPS (only genuinely streamed: genTime > 500ms)
    const tpsRows = await this.readConn.query(
      `SELECT COALESCE(SUM(output_tokens), 0) as filteredTokens,
              COALESCE(SUM(duration - ttfb), 0) as filteredGenTime,
              COUNT(*) as filteredCount
       FROM request_logs
       WHERE ${timeFilter}
         AND ttfb IS NOT NULL
         AND output_tokens IS NOT NULL
         AND output_tokens > 0
         AND (duration - ttfb) > 500`,
      timeParams
    );
    const tps = tpsRows[0] ?? {};
    const filteredTokens = (tps.filteredTokens as number) ?? 0;
    const filteredGenTime = (tps.filteredGenTime as number) ?? 0;
    const filteredCount = (tps.filteredCount as number) ?? 0;
    const outputTps = filteredGenTime > 0 ? (filteredTokens / filteredGenTime) * 1000 : 0;

    // 3. Percentiles via LIMIT/OFFSET
    let p50Duration = 0;
    let p90Duration = 0;
    const totalLogs = (base.totalLogs as number) ?? 0;
    if (totalLogs > 0) {
      const p50Offset = Math.floor(0.5 * (totalLogs - 1));
      const p90Offset = Math.floor(0.9 * (totalLogs - 1));
      const [p50Rows, p90Rows] = await Promise.all([
        this.readConn.query(
          `SELECT duration FROM request_logs WHERE ${timeFilter} ORDER BY duration ASC LIMIT 1 OFFSET ?`,
          [...timeParams, p50Offset]
        ),
        this.readConn.query(
          `SELECT duration FROM request_logs WHERE ${timeFilter} ORDER BY duration ASC LIMIT 1 OFFSET ?`,
          [...timeParams, p90Offset]
        ),
      ]);
      p50Duration = Math.round((p50Rows[0]?.duration as number) ?? 0);
      p90Duration = Math.round((p90Rows[0]?.duration as number) ?? 0);
    }

    // 4. Provider breakdown
    const providerRows = await this.readConn.query(
      `SELECT provider_id, provider_name, COUNT(*) as count,
              COALESCE(SUM(input_tokens), 0) as totalInputTokens,
              COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
              COALESCE(SUM(cache_tokens), 0) as totalCacheTokens
       FROM request_logs
       WHERE ${timeFilter}
       GROUP BY provider_id, provider_name`,
      timeParams
    );

    const byProvider: Record<string, number> = {};
    const providerBreakdown: ProviderStatRow[] = [];
    for (const r of providerRows) {
      byProvider[r.provider_id as string] = r.count as number;
      providerBreakdown.push({
        providerId: r.provider_id as string,
        providerName: (r.provider_name as string) || (r.provider_id as string),
        count: r.count as number,
        totalInputTokens: (r.totalInputTokens as number) ?? 0,
        totalOutputTokens: (r.totalOutputTokens as number) ?? 0,
        totalCacheTokens: (r.totalCacheTokens as number) ?? 0,
      });
    }

    return {
      totalLogs,
      successCount: (base.successCount as number) ?? 0,
      errorCount: (base.errorCount as number) ?? 0,
      avgDuration: Math.round((base.avgDuration as number) ?? 0),
      byProvider,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheTokens: totalCache,
      cacheHitRate: denominator > 0 ? Math.round((totalCache / denominator) * 100) : 0,
      avgTtfb: Math.round((base.avgTtfb as number) ?? 0),
      outputTps: Math.round(outputTps * 10) / 10,
      outputTpsSampleCount: filteredCount,
      p50Duration,
      p90Duration,
      providerBreakdown,
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
