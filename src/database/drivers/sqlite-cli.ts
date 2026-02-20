/**
 * SQLite CLI Driver
 * Manages a long-lived sqlite3 CLI process via stdin/stdout pipes.
 * Eliminates WASM memory overhead by delegating all DB operations to a native subprocess.
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

// Maximum database file size (50MB)
const MAX_DB_FILE_SIZE = 50 * 1024 * 1024;

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
  // String: wrap in single quotes, escape internal single quotes
  const escaped = value.replace(/\u0000/g, "").replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * Interpolate parameters into a SQL template.
 */
function interpolateSql(sql: string, params?: (string | number | boolean | null | undefined)[]): string {
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

/**
 * Async write queue for database operations
 */
class WriteQueue {
  private queue: RequestLog[] = [];
  private driver: SqliteCliDriver | null = null;
  private isProcessing: boolean = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly batchSize = 50;
  private readonly flushInterval = 1000;
  private isEnabled: boolean = false;

  setDriver(driver: SqliteCliDriver | null): void {
    this.driver = driver;
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  add(log: RequestLog): void {
    if (!this.isEnabled || !this.driver) {
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

    if (this.isProcessing || this.queue.length === 0 || !this.driver) {
      return;
    }

    this.isProcessing = true;
    const itemsToWrite = this.queue.splice(0);

    this.driver
      .writeBatch(itemsToWrite)
      .catch(err => {
        console.error("[WriteQueue] Failed to write logs:", err);
      })
      .finally(() => {
        this.isProcessing = false;
        if (this.queue.length > 0) {
          this.flush();
        }
      });
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

/**
 * SqliteCliDriver: SQLite driver implementation using CLI subprocess
 */
export class SqliteCliDriver implements DatabaseDriver {
  private process: ChildProcess | null = null;
  private readonly config: SqliteDriverConfig;
  private readonly log = Logger.getInstance();
  private sqlite3Path: string | null = null;

  private readonly commandQueue: Array<() => void> = [];
  private isProcessingCommand = false;
  private currentQuery: PendingQuery | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";

  private isClosing = false;
  private restartCount = 0;
  private readonly maxRestarts = 3;
  private isStarted = false;
  private needsRestart = false;
  private readonly commandTimeoutMs = 10000;
  private commandTimer: NodeJS.Timeout | null = null;

  private readonly writeQueue: WriteQueue = new WriteQueue();
  private isEnabled = false;

  constructor(config: SqliteDriverConfig) {
    this.config = config;
  }

  /**
   * Initialize the database
   */
  async initialize(): Promise<void> {
    const dbPath = this.config.path;
    const dir = path.dirname(dbPath);

    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }

    // Find sqlite3 binary
    this.sqlite3Path = this.findSqlite3();
    if (!this.sqlite3Path) {
      throw new Error("sqlite3 CLI not found. Please install SQLite3.");
    }

    this.log.info(`[SqliteCli] Database path: ${dbPath}`);

    await this.spawnProcess();
    await this.createSchema();

    this.writeQueue.setDriver(this);
    this.isEnabled = true;
    this.writeQueue.setEnabled(true);

    // Clean old logs in background
    setTimeout(() => {
      this.cleanOldLogs().catch(err => {
        this.log.error("[SqliteCli] Background cleanup failed:", err);
      });
    }, 0);
  }

  private findSqlite3(): string | null {
    try {
      const result = execSync("which sqlite3", { encoding: "utf-8" }).trim();
      return result || null;
    } catch {
      return null;
    }
  }

  private spawnProcess(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.sqlite3Path) {
        reject(new Error("sqlite3 path not set"));
        return;
      }

      this.process = spawn(this.sqlite3Path, [this.config.path], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.stdoutBuffer = "";
      this.stderrBuffer = "";

      this.process.stdout!.on("data", (data: Buffer) => {
        this.stdoutBuffer += data.toString();
        this.checkForSentinel();
      });

      this.process.stderr!.on("data", (data: Buffer) => {
        this.stderrBuffer += data.toString();
        this.checkForSentinel();
      });

      this.process.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
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

        if (!this.isClosing && this.restartCount < this.maxRestarts) {
          this.restartCount++;
          this.spawnProcess()
            .then(() => void this.processNextCommand())
            .catch((err: unknown) => {
              this.drainQueueWithError(err instanceof Error ? err : new Error(String(err)));
            });
        } else if (!this.isClosing) {
          this.drainQueueWithError(new Error("sqlite3 crashed and max restarts exceeded"));
        }
      });

      this.process.on("error", (err: Error) => {
        reject(err);
      });

      const initCommands = [
        ".mode json",
        ".headers on",
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
      ].join("\n");

      const initSentinel = this.generateSentinelId();
      const initSql = `${initCommands}\nSELECT '${initSentinel}' as _s;\n`;

      this.currentQuery = {
        sentinelId: initSentinel,
        resolve: () => {
          this.currentQuery = null;
          this.restartCount = 0;
          if (this.commandTimer) {
            clearTimeout(this.commandTimer);
            this.commandTimer = null;
          }
          this.isStarted = true;
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
        this.handleError(new Error("sqlite3 initialization timed out"));
        reject(new Error("sqlite3 initialization timed out"));
      }, this.commandTimeoutMs);

      this.process.stdin!.write(initSql);
    });
  }

  private generateSentinelId(): string {
    return `__SENTINEL_${Date.now()}_${Math.random().toString(36).substring(2, 8)}__`;
  }

  private checkForSentinel(): void {
    if (!this.currentQuery) { return; }

    const sentinel = this.currentQuery.sentinelId;
    const stderrContent = this.stderrBuffer.trim();

    if (stderrContent) {
      this.handleError(new Error(`sqlite3 error: ${stderrContent}`));
      return;
    }

    const sentinelIdIndex = this.stdoutBuffer.indexOf(sentinel);
    if (sentinelIdIndex === -1) { return; }

    const sentinelPrefix = `[{"_s":"`;
    const sentinelSuffix = `"}]`;

    const prefixIndex = this.stdoutBuffer.lastIndexOf(sentinelPrefix, sentinelIdIndex);
    if (prefixIndex === -1) { return; }

    const suffixIndex = this.stdoutBuffer.indexOf(sentinelSuffix, sentinelIdIndex);
    if (suffixIndex === -1) { return; }

    const sentinelEndIndex = suffixIndex + sentinelSuffix.length;
    const resultText = this.stdoutBuffer.substring(0, prefixIndex).trim();
    this.stdoutBuffer = this.stdoutBuffer.substring(sentinelEndIndex).trimStart();

    if (this.commandTimer) {
      clearTimeout(this.commandTimer);
      this.commandTimer = null;
    }

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
      this.handleError(
        new Error(`Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`)
      );
      return;
    }

    this.currentQuery = null;
    void this.processNextCommand();
  }

  private handleError(error: Error): void {
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

    void this.processNextCommand();
  }

  private parseJsonOutput(text: string): Record<string, unknown>[] {
    const trimmed = text.trim();
    if (!trimmed) { return []; }

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
            // Warn about malformed array to avoid silent failures
            this.log.warn(`[SqliteCli] Skipped malformed JSON array chunk: ${currentArray.trim()}`);
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

  private async exec(sql: string, params?: (string | number | boolean | null | undefined)[]): Promise<void> {
    const interpolated = interpolateSql(sql, params);
    await this.sendCommand(interpolated, true);
  }

  private async query(sql: string, params?: (string | number | boolean | null | undefined)[]): Promise<Record<string, unknown>[]> {
    const interpolated = interpolateSql(sql, params);
    return this.sendCommand(interpolated, false);
  }

  private async queryScalar<T = number>(sql: string, params?: (string | number | boolean | null | undefined)[]): Promise<T | null> {
    const rows = await this.query(sql, params);
    if (rows.length === 0) { return null; }
    const firstRow = rows[0];
    const keys = Object.keys(firstRow);
    if (keys.length === 0) { return null; }
    return firstRow[keys[0]] as T;
  }

  private async transaction(sqls: string[]): Promise<void> {
    const combined = ["BEGIN TRANSACTION", ...sqls, "COMMIT"]
      .map(s => (s.trim().endsWith(";") ? s : s + ";"))
      .join("\n");
    await this.sendCommand(combined, true);
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

        this.process.stdin.write(safeCommand);
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
      this.handleError(new Error(`Command timed out after ${this.commandTimeoutMs}ms`));
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
    while (this.commandQueue.length > 0) {
      const task = this.commandQueue.shift()!;
      try {
        task();
      } catch {
        // ignore
      }
    }
    this.isProcessingCommand = false;
  }

  private async restart(): Promise<void> {
    if (this.needsRestart) {
      this.needsRestart = false;

      if (this.process) {
        try {
          this.process.kill("SIGKILL");
        } catch {
          // ignore
        }
        this.process = null;
      }

      this.stdoutBuffer = "";
      this.stderrBuffer = "";
      this.currentQuery = null;

      await this.spawnProcess();
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    this.isClosing = true;
    this.isStarted = false;
    this.isEnabled = false;
    this.writeQueue.setEnabled(false);
    this.writeQueue.forceFlush();

    if (!this.process) { return; }

    const proc = this.process;
    return new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        if (this.process) {
          this.process.kill("SIGKILL");
          this.process = null;
        }
        resolve();
      }, 5000);

      proc.once("exit", () => {
        clearTimeout(timeout);
        this.process = null;
        resolve();
      });

      try {
        proc.stdin?.write(".quit\n");
        proc.stdin?.end();
      } catch {
        clearTimeout(timeout);
        this.process = null;
        resolve();
      }
    });
  }

  private async createSchema(): Promise<void> {
    await this.exec(`
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
      await this.exec(sql);
    }

    // Run migrations
    try {
      const columns = await this.query("PRAGMA table_info(request_logs)");
      const columnNames = columns.map(c => c.name as string);

      const migrations: Array<{ column: string; sql: string }> = [
        { column: "target_url", sql: "ALTER TABLE request_logs ADD COLUMN target_url TEXT" },
        { column: "original_request_body", sql: "ALTER TABLE request_logs ADD COLUMN original_request_body TEXT" },
        { column: "original_response_body", sql: "ALTER TABLE request_logs ADD COLUMN original_response_body TEXT" },
        { column: "client_id", sql: "ALTER TABLE request_logs ADD COLUMN client_id TEXT" },
        { column: "status", sql: "ALTER TABLE request_logs ADD COLUMN status TEXT DEFAULT 'completed'" },
        { column: "route_type", sql: "ALTER TABLE request_logs ADD COLUMN route_type TEXT" },
      ];

      for (const migration of migrations) {
        if (!columnNames.includes(migration.column)) {
          await this.exec(migration.sql);
        }
      }
    } catch {
      // Table might not exist yet
    }
  }

  /**
   * Insert a log entry (async via write queue)
   */
  insertLog(log: RequestLog): void {
    if (!this.isEnabled) { return; }
    this.writeQueue.add(log);
  }

  /**
   * Insert a log entry with "pending" status immediately
   */
  insertLogPending(log: RequestLog): void {
    if (!this.isEnabled) { return; }

    const { sql, params } = buildInsertSql(log, "pending");
    this.exec(sql, params).catch(err => {
      this.log.error("[SqliteCli] Failed to insert pending log:", err);
    });
  }

  /**
   * Update a log entry by clientId
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
    if (!this.isEnabled) { return; }

    this.exec(
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
    ).catch(err => {
      this.log.error("[SqliteCli] Failed to update log:", err);
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
    if (!this.isEnabled) { return; }

    this.exec(
      `UPDATE request_logs
       SET status_code = ?,
           duration = ?,
           success = ?,
           error_message = ?,
           status = ?
       WHERE client_id = ?`,
      [
        statusCode,
        duration,
        0, // success is always false for cancelled/timeout
        encodeForStorage(errorMessage),
        status,
        clientId,
      ]
    ).catch(err => {
      this.log.error("[SqliteCli] Failed to update log status:", err);
    });
  }

  /**
   * Batch insert logs
   */
  async writeBatch(logs: RequestLog[]): Promise<void> {
    if (logs.length === 0) { return; }

    const stmts: string[] = [];
    for (const log of logs) {
      const { sql, params } = buildInsertSql(log);
      stmts.push(interpolateSql(sql, params));
    }

    await this.transaction(stmts);
  }

  /**
   * Query logs with filter
   */
  async queryLogs(filter: LogFilter = {}): Promise<LogQueryResult> {
    if (!this.isStarted) {
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

    const total = (await this.queryScalar<number>(
      `SELECT COUNT(*) as count FROM request_logs ${whereClause}`,
      params
    )) ?? 0;

    const limit = filter.limit || 100;
    const offset = filter.offset || 0;

    const rows = await this.query(
      `SELECT * FROM request_logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const logs = rows.map(dbRowToLogWithoutBody);

    return { logs, total };
  }

  /**
   * Get a single log by ID
   */
  async getLogById(id: number): Promise<RequestLog | null> {
    if (!this.isStarted) { return null; }

    const rows = await this.query("SELECT * FROM request_logs WHERE id = ?", [id]);

    if (rows.length === 0) { return null; }

    return dbRowToLog(rows[0]);
  }

  /**
   * Delete logs by IDs
   */
  async deleteLogs(ids: number[]): Promise<void> {
    if (!this.isStarted || ids.length === 0) { return; }

    const placeholders = ids.map(() => "?").join(",");
    await this.exec(`DELETE FROM request_logs WHERE id IN (${placeholders})`, ids);
  }

  /**
   * Clear all logs
   */
  async clearAllLogs(): Promise<void> {
    if (!this.isStarted) { return; }
    await this.exec("DELETE FROM request_logs");
  }

  /**
   * Clean old logs
   */
  async cleanOldLogs(): Promise<void> {
    if (!this.isStarted) { return; }

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await this.exec("DELETE FROM request_logs WHERE timestamp < ?", [thirtyDaysAgo]);

    // Size-based cleanup
    try {
      if (fsSync.existsSync(this.config.path)) {
        const stats = fsSync.statSync(this.config.path);
        if (stats.size > MAX_DB_FILE_SIZE) {
          this.log.warn(`[SqliteCli] Database size exceeds limit, trimming...`);
          await this.exec(`
            DELETE FROM request_logs
            WHERE id NOT IN (
              SELECT id FROM request_logs ORDER BY timestamp DESC LIMIT 1000
            )
          `);
          await this.exec("VACUUM");
        }
      }
    } catch (err) {
      this.log.error("[SqliteCli] Size-based cleanup failed:", err);
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<DatabaseStats> {
    if (!this.isStarted) {
      return {
        totalLogs: 0,
        successCount: 0,
        errorCount: 0,
        avgDuration: 0,
        byProvider: {},
      };
    }

    const total = (await this.queryScalar<number>("SELECT COUNT(*) as count FROM request_logs")) ?? 0;
    const success = (await this.queryScalar<number>("SELECT COUNT(*) as count FROM request_logs WHERE success = 1")) ?? 0;
    const error = (await this.queryScalar<number>("SELECT COUNT(*) as count FROM request_logs WHERE success = 0")) ?? 0;
    const avgDuration = (await this.queryScalar<number>("SELECT AVG(duration) as avg FROM request_logs")) ?? 0;


    const byProviderRows = await this.query(
      "SELECT provider_id, COUNT(*) as count FROM request_logs GROUP BY provider_id"
    );


    const byProvider: Record<string, number> = {};
    for (const row of byProviderRows) {
      byProvider[row.provider_id as string] = row.count as number;
    }

    return {
      totalLogs: total,
      successCount: success,
      errorCount: error,
      avgDuration: Math.round(avgDuration),
      byProvider,
    };
  }

  /**
   * Check if driver is enabled
   */
  get enabled(): boolean {
    return this.isEnabled && this.isStarted;
  }

  /**
   * Force flush pending writes
   */
  forceFlush(): void {
    this.writeQueue.forceFlush();
  }
}
