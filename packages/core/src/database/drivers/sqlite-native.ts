/* eslint-disable @typescript-eslint/require-await -- Interface requires Promise returns but native driver is synchronous */
/**
 * SQLite Native Driver
 * Uses better-sqlite3 for in-process SQLite access (no IPC overhead).
 * Designed for Electron Desktop; falls back to SqliteCliDriver elsewhere.
 */

import * as path from "path";
import * as fsSync from "fs";
import type Database from "better-sqlite3";
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

export class SqliteNativeDriver implements DatabaseDriver {
  private readonly config: SqliteDriverConfig;
  private readonly log = Logger.getInstance();
  private db: Database.Database | null = null;
  private isEnabled = false;

  constructor(config: SqliteDriverConfig) {
    this.config = config;
  }

  /** Returns db with non-null assertion; safe because all callers check isEnabled first. */
  private get d(): Database.Database {
    return this.db!;
  }

  async initialize(): Promise<void> {
    const dbPath = this.config.path;
    const dir = path.dirname(dbPath);

    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }

    // Dynamic require — esbuild keeps this as require("better-sqlite3") for the desktop bundle
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/naming-convention
    const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
    this.db = new BetterSqlite3(dbPath);

    this.d.pragma("journal_mode = WAL");
    this.d.pragma("synchronous = NORMAL");
    this.d.pragma("busy_timeout = 30000");
    this.d.pragma("cache_size = -8000");
    this.d.pragma("temp_store = MEMORY");
    this.d.pragma("mmap_size = 16777216");

    this.log.info(`[SqliteNative] Database path: ${dbPath}`);

    this.createSchema();
    this.isEnabled = true;

    setTimeout(() => {
      this.cleanOldLogs().catch(err => {
        this.log.error("[SqliteNative] Background cleanup failed:", err);
      });
    }, 0);
  }

  private createSchema(): void {
    this.d.exec(`
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
      this.d.exec(sql);
    }

    try {
      const columns: Array<{ name: string }> = this.d.pragma("table_info(request_logs)") as Array<{
        name: string;
      }>;
      const columnNames = columns.map(c => c.name);

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
          this.d.exec(migration.sql);
        }
      }
    } catch {
      // Table might not exist yet
    }
  }

  // ---- Write operations ----------------------------------------------------

  insertLog(log: RequestLog): void {
    if (!this.isEnabled) {
      return;
    }
    const { sql, params } = buildInsertSql(log);
    try {
      this.d.prepare(sql).run(...params);
    } catch (err) {
      this.log.error("[SqliteNative] Failed to insert log:", err);
    }
  }

  insertLogPending(log: RequestLog): void {
    if (!this.isEnabled) {
      return;
    }
    const { sql, params } = buildInsertSql(log, "pending");
    try {
      this.d.prepare(sql).run(...params);
    } catch (err) {
      this.log.error("[SqliteNative] Failed to insert pending log:", err);
    }
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
    if (!this.isEnabled) {
      return;
    }
    try {
      const stmt = this.d.prepare(`
        UPDATE request_logs
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
        WHERE client_id = ?
      `);
      stmt.run(
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
        clientId
      );
    } catch (err) {
      this.log.error("[SqliteNative] Failed to update log:", err);
    }
  }

  updateLogStatus(
    clientId: string,
    status: RequestStatus,
    statusCode: number,
    duration: number,
    errorMessage: string | undefined
  ): void {
    if (!this.isEnabled) {
      return;
    }
    try {
      const stmt = this.d.prepare(`
        UPDATE request_logs
        SET status_code = ?,
            duration = ?,
            success = ?,
            error_message = ?,
            status = ?
        WHERE client_id = ?
      `);
      stmt.run(statusCode, duration, 0, encodeForStorage(errorMessage), status, clientId);
    } catch (err) {
      this.log.error("[SqliteNative] Failed to update log status:", err);
    }
  }

  async writeBatch(logs: RequestLog[]): Promise<void> {
    if (!this.isEnabled || logs.length === 0) {
      return;
    }

    const stmt = this.d.prepare(buildInsertSql(logs[0]).sql);
    const insertMany = this.d.transaction((items: RequestLog[]) => {
      for (const log of items) {
        const { params } = buildInsertSql(log);
        stmt.run(...params);
      }
    });
    insertMany(logs);
  }

  async deleteLogs(ids: number[]): Promise<void> {
    if (!this.isEnabled || ids.length === 0) {
      return;
    }
    const placeholders = ids.map(() => "?").join(",");
    this.d.prepare(`DELETE FROM request_logs WHERE id IN (${placeholders})`).run(...ids);
  }

  async clearAllLogs(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    this.d.exec("DELETE FROM request_logs");
    this.d.exec("VACUUM");
  }

  async cleanOldLogs(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000;
    this.d.prepare("DELETE FROM request_logs WHERE timestamp < ?").run(cutoff);
    this.d
      .prepare(
        `DELETE FROM request_logs WHERE id NOT IN (SELECT id FROM request_logs ORDER BY timestamp DESC LIMIT ?)`
      )
      .run(MAX_LOG_ROWS);
  }

  // ---- Read operations -----------------------------------------------------

  async queryLogs(filter: LogFilter = {}): Promise<LogQueryResult> {
    if (!this.isEnabled) {
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

    const countRow = this.d
      .prepare(`SELECT COUNT(*) as count FROM request_logs ${whereClause}`)
      .get(...params) as Record<string, unknown> | undefined;
    const total = (countRow?.count as number) ?? 0;

    const limit = filter.limit || 100;
    const offset = filter.offset || 0;

    const rows = this.d
      .prepare(
        `SELECT id, timestamp, provider_id, provider_name, method, path,
                status_code, duration, success, error_message, client_id,
                status, route_type,
                input_tokens, output_tokens, cache_tokens, ttfb,
                SUBSTR(request_body, 1, 500) as request_body,
                SUBSTR(original_request_body, 1, 500) as original_request_body
         FROM request_logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Record<string, unknown>[];

    return { logs: rows.map(dbRowToLogWithoutBody), total };
  }

  async getLogById(id: number): Promise<RequestLog | null> {
    if (!this.isEnabled) {
      return null;
    }
    const row = this.d.prepare("SELECT * FROM request_logs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? dbRowToLog(row) : null;
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

    if (!this.isEnabled) {
      return empty;
    }

    const since = query?.since;
    const sinceParam = since ? since : null;
    const timeFilter = since ? "(? IS NULL OR timestamp >= ?)" : "1=1";
    const timeParams = since ? [sinceParam, sinceParam] : [];

    // 1. Base stats + token aggregation
    const base = this.d
      .prepare(
        `SELECT COUNT(*) as totalLogs,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successCount,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errorCount,
                AVG(duration) as avgDuration,
                COALESCE(SUM(input_tokens), 0) as totalInputTokens,
                COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
                COALESCE(SUM(cache_tokens), 0) as totalCacheTokens,
                AVG(ttfb) as avgTtfb
         FROM request_logs
         WHERE ${timeFilter}`
      )
      .get(...timeParams) as Record<string, unknown>;

    const totalInput = (base.totalInputTokens as number) ?? 0;
    const totalOutput = (base.totalOutputTokens as number) ?? 0;
    const totalCache = (base.totalCacheTokens as number) ?? 0;
    const denominator = totalInput + totalCache;

    // 2. Filtered TPS (only genuinely streamed: genTime > 500ms)
    const tps = this.d
      .prepare(
        `SELECT COALESCE(SUM(output_tokens), 0) as filteredTokens,
                COALESCE(SUM(duration - ttfb), 0) as filteredGenTime,
                COUNT(*) as filteredCount
         FROM request_logs
         WHERE ${timeFilter}
           AND ttfb IS NOT NULL
           AND output_tokens IS NOT NULL
           AND output_tokens > 0
           AND (duration - ttfb) > 500`
      )
      .get(...timeParams) as Record<string, unknown>;

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
      const p50Row = this.d
        .prepare(
          `SELECT duration FROM request_logs WHERE ${timeFilter} ORDER BY duration ASC LIMIT 1 OFFSET ?`
        )
        .get(...timeParams, p50Offset) as Record<string, unknown> | undefined;
      const p90Row = this.d
        .prepare(
          `SELECT duration FROM request_logs WHERE ${timeFilter} ORDER BY duration ASC LIMIT 1 OFFSET ?`
        )
        .get(...timeParams, p90Offset) as Record<string, unknown> | undefined;
      p50Duration = Math.round((p50Row?.duration as number) ?? 0);
      p90Duration = Math.round((p90Row?.duration as number) ?? 0);
    }

    // 4. Provider breakdown
    const providerRows = this.d
      .prepare(
        `SELECT provider_id, provider_name, COUNT(*) as count,
                COALESCE(SUM(input_tokens), 0) as totalInputTokens,
                COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
                COALESCE(SUM(cache_tokens), 0) as totalCacheTokens
         FROM request_logs
         WHERE ${timeFilter}
         GROUP BY provider_id, provider_name`
      )
      .all(...timeParams) as Record<string, unknown>[];

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

  // ---- Properties ----------------------------------------------------------

  get enabled(): boolean {
    return this.isEnabled;
  }

  forceFlush(): void {
    // Native driver writes synchronously — nothing to flush
  }

  async close(): Promise<void> {
    this.isEnabled = false;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
