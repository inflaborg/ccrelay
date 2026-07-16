/* eslint-disable @typescript-eslint/require-await -- Interface requires Promise returns but native driver is synchronous */
/**
 * SQLite Native Driver
 * Uses better-sqlite3 for in-process SQLite access (no IPC overhead).
 * Designed for Electron Desktop; falls back to SqliteCliDriver elsewhere.
 */

import * as path from "path";
import * as fsSync from "fs";
import type Database from "better-sqlite3";
import { Logger } from "../../../utils/logger";
import { TABLE, METRICS_TABLE } from "../../schema";
import { runSqliteStartupMigration, SQLITE_INSERT_V2 } from "../../migration";
import {
  shouldTrackMetrics,
  buildMetricsPendingInsertSql,
  buildMetricsCompletedInsertSql,
  SQLITE_UPDATE_METRICS_COMPLETED,
  SQLITE_UPDATE_METRICS_STATUS,
  STREAM_GEN_SQL_COND,
  UPSTREAM_TTFB_SQL_COND,
  TOTAL_MS_SQL_COND,
} from "../../metrics-sql";
import { SQLITE_UPDATE_LOG_COMPLETED } from "../../logs-sql";
import { SQLITE_MIN_VERSION, isSqliteVersionAtLeast } from "../../sqlite-version";
import { SQLITE_CLI_NOT_FOUND_MESSAGE } from "./cli";
import type {
  DatabaseDriver,
  SqliteDriverConfig,
  RequestLog,
  LogFilter,
  LogQueryResult,
  DatabaseStats,
  LogResponseTiming,
  ProviderStatRow,
  RequestStatus,
  StatsQuery,
  DatabaseInitializeOptions,
} from "../../types";
import {
  MAX_LOG_ROWS,
  MAX_LOG_AGE_DAYS,
  utf8StringToBlob,
  dbRowToLogWithoutBody,
  sqliteListBodyPreviewColumns,
  dbRowToLog,
  filterProviderBreakdownByTokenUsage,
} from "../../shared-utils";
import { buildInsertSql } from "./utils";

export class SqliteNativeDriver implements DatabaseDriver {
  private readonly config: SqliteDriverConfig;
  private readonly log = Logger.getInstance();
  private db: Database.Database | null = null;
  private isEnabled = false;
  private _logsEnabled = false;

  constructor(config: SqliteDriverConfig) {
    this.config = config;
  }

  /** Returns db with non-null assertion; safe because all callers check isEnabled first. */
  private get d(): Database.Database {
    return this.db!;
  }

  async initialize(options?: DatabaseInitializeOptions): Promise<void> {
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

    const versionRow = this.d.prepare("SELECT sqlite_version() as v").get() as { v?: string };
    const sqliteVersion = versionRow?.v ?? "0.0.0";
    if (!isSqliteVersionAtLeast(sqliteVersion, SQLITE_MIN_VERSION)) {
      this.db.close();
      this.db = null;
      throw new Error(
        `${SQLITE_CLI_NOT_FOUND_MESSAGE} (SQLite ${sqliteVersion} < ${SQLITE_MIN_VERSION})`
      );
    }

    const choice = options?.migrationChoice ?? "migrate";
    this.log.info("[SqliteNative] Running database migrations...");
    runSqliteStartupMigration(
      dbPath,
      sql => {
        const row = this.d.prepare(sql).get() as { c?: number } | undefined;
        return row?.c;
      },
      sql => this.d.prepare(sql).all() as Array<Record<string, unknown>>,
      sql => {
        this.d.exec(sql);
      },
      params => {
        this.d.prepare(SQLITE_INSERT_V2).run(...params);
      },
      choice
    );

    this.isEnabled = true;
    this._logsEnabled = options?.logsEnabled ?? false;

    setTimeout(() => {
      this.cleanOldLogs().catch(err => {
        this.log.error("[SqliteNative] Background cleanup failed:", err);
      });
    }, 0);
  }

  get enabled(): boolean {
    return this.isEnabled;
  }

  get logsEnabled(): boolean {
    return this._logsEnabled;
  }

  setLogsEnabled(enabled: boolean): void {
    this._logsEnabled = enabled;
  }

  forceFlush(): void {
    // Native driver writes synchronously; nothing to flush.
  }

  // ---- Write operations ----------------------------------------------------

  insertLog(log: RequestLog): void {
    if (!this.isEnabled) {
      return;
    }
    try {
      if (this._logsEnabled) {
        const { sql, params } = buildInsertSql(log);
        this.d.prepare(sql).run(...params);
      }
      if (shouldTrackMetrics(log)) {
        const metrics = buildMetricsCompletedInsertSql(log);
        this.d.prepare(metrics.sql).run(...metrics.params);
      }
    } catch (err) {
      this.log.error("[SqliteNative] Failed to insert log:", err);
    }
  }

  insertLogPending(log: RequestLog): void {
    if (!this.isEnabled) {
      return;
    }
    try {
      if (this._logsEnabled) {
        const { sql, params } = buildInsertSql(log, "pending");
        this.d.prepare(sql).run(...params);
      }
      if (shouldTrackMetrics(log)) {
        const metrics = buildMetricsPendingInsertSql(log);
        this.d.prepare(metrics.sql).run(...metrics.params);
      }
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
    ttfb?: number,
    responseHeadersMasked?: string,
    timing?: LogResponseTiming
  ): void {
    if (!this.isEnabled) {
      return;
    }
    try {
      if (this._logsEnabled) {
        this.d
          .prepare(SQLITE_UPDATE_LOG_COMPLETED)
          .run(
            statusCode,
            utf8StringToBlob(responseBody),
            utf8StringToBlob(originalResponseBody),
            duration,
            success ? 1 : 0,
            errorMessage ?? null,
            responseHeadersMasked ?? null,
            inputTokens ?? null,
            outputTokens ?? null,
            cacheTokens ?? null,
            ttfb ?? null,
            timing?.queueWaitMs ?? null,
            timing?.upstreamTtfbMs ?? null,
            timing?.genMs ?? null,
            timing?.totalMs ?? null,
            clientId
          );
      }
      this.d
        .prepare(SQLITE_UPDATE_METRICS_COMPLETED)
        .run(
          inputTokens ?? null,
          outputTokens ?? null,
          cacheTokens ?? null,
          ttfb ?? null,
          duration,
          timing?.queueWaitMs ?? null,
          timing?.upstreamTtfbMs ?? null,
          timing?.genMs ?? null,
          timing?.totalMs ?? null,
          success ? 1 : 0,
          statusCode,
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
      if (this._logsEnabled) {
        const stmt = this.d.prepare(`
        UPDATE ${TABLE}
        SET status_code = ?,
            duration = ?,
            success = ?,
            error_message = ?,
            status = ?
        WHERE client_id = ?
      `);
        stmt.run(statusCode, duration, 0, errorMessage ?? null, status, clientId);
      }
      this.d.prepare(SQLITE_UPDATE_METRICS_STATUS).run(duration, 0, statusCode, clientId);
    } catch (err) {
      this.log.error("[SqliteNative] Failed to update log status:", err);
    }
  }

  async writeBatch(logs: RequestLog[]): Promise<void> {
    if (!this.isEnabled || logs.length === 0) {
      return;
    }

    const stmt = this._logsEnabled ? this.d.prepare(buildInsertSql(logs[0]).sql) : null;
    const insertMany = this.d.transaction((items: RequestLog[]) => {
      for (const log of items) {
        if (this._logsEnabled && stmt) {
          const { params } = buildInsertSql(log);
          stmt.run(...params);
        }
        if (shouldTrackMetrics(log)) {
          const metrics = buildMetricsCompletedInsertSql(log);
          this.d.prepare(metrics.sql).run(...metrics.params);
        }
      }
    });
    insertMany(logs);
  }

  async deleteLogs(ids: number[]): Promise<void> {
    if (!this.isEnabled || ids.length === 0) {
      return;
    }
    const placeholders = ids.map(() => "?").join(",");
    this.d.prepare(`DELETE FROM ${TABLE} WHERE id IN (${placeholders})`).run(...ids);
  }

  async clearAllLogs(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    this.d.exec(`DELETE FROM ${TABLE}`);
    this.d.exec("VACUUM");
  }

  async clearAllMetrics(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    this.d.exec(`DELETE FROM ${METRICS_TABLE}`);
    this.d.exec("VACUUM");
  }

  async cleanOldLogs(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000;
    this.d.prepare(`DELETE FROM ${TABLE} WHERE timestamp < ?`).run(cutoff);
    this.d
      .prepare(
        `DELETE FROM ${TABLE} WHERE id NOT IN (SELECT id FROM ${TABLE} ORDER BY timestamp DESC LIMIT ?)`
      )
      .run(MAX_LOG_ROWS);
    this.d.prepare(`DELETE FROM ${METRICS_TABLE} WHERE timestamp < ?`).run(cutoff);
  }

  // ---- Read operations -----------------------------------------------------

  async queryLogs(filter: LogFilter = {}): Promise<LogQueryResult> {
    if (!this.isEnabled) {
      return { logs: [], total: 0 };
    }

    const conditions: string[] = [];
    const params: (string | number | boolean | null | undefined)[] = [];

    if (filter.providerId) {
      conditions.push("v.provider_id = ?");
      params.push(filter.providerId);
    }
    if (filter.method) {
      conditions.push("v.method = ?");
      params.push(filter.method);
    }
    if (filter.pathPattern) {
      conditions.push("v.path LIKE ?");
      params.push(`%${filter.pathPattern}%`);
    }
    if (filter.minDuration !== undefined) {
      conditions.push("v.duration >= ?");
      params.push(filter.minDuration);
    }
    if (filter.maxDuration !== undefined) {
      conditions.push("v.duration <= ?");
      params.push(filter.maxDuration);
    }
    if (filter.hasError !== undefined) {
      conditions.push("v.success = ?");
      params.push(filter.hasError ? 0 : 1);
    }
    if (filter.startTime !== undefined) {
      conditions.push("v.timestamp >= ?");
      params.push(filter.startTime);
    }
    if (filter.endTime !== undefined) {
      conditions.push("v.timestamp <= ?");
      params.push(filter.endTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRow = this.d
      .prepare(`SELECT COUNT(*) as count FROM ${TABLE} v ${whereClause}`)
      .get(...params) as Record<string, unknown> | undefined;
    const total = (countRow?.count as number) ?? 0;

    const limit = filter.limit || 100;
    const offset = filter.offset || 0;

    const rows = this.d
      .prepare(
        `SELECT v.id, v.timestamp, v.provider_id, v.provider_name, v.method, v.path,
                v.status_code, v.duration, v.success, v.error_message, v.client_id,
                v.status, v.route_type, v.service_handler, v.service_meta,
                v.input_tokens, v.output_tokens, v.cache_tokens, v.ttfb,
                v.queue_wait_ms, v.upstream_ttfb_ms, v.gen_ms, v.total_ms,
                m.model as metrics_model,
                ${sqliteListBodyPreviewColumns("v")}
         FROM ${TABLE} v
         LEFT JOIN ${METRICS_TABLE} m ON m.client_id = v.client_id
         ${whereClause} ORDER BY v.timestamp DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Record<string, unknown>[];

    return { logs: rows.map(dbRowToLogWithoutBody), total };
  }

  async getLogById(id: number): Promise<RequestLog | null> {
    if (!this.isEnabled) {
      return null;
    }
    const row = this.d
      .prepare(
        `SELECT v.*, m.model as metrics_model
         FROM ${TABLE} v
         LEFT JOIN ${METRICS_TABLE} m ON m.client_id = v.client_id
         WHERE v.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
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
      avgQueueWaitMs: 0,
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

    const base = this.d
      .prepare(
        `SELECT COUNT(*) as totalLogs,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successCount,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errorCount,
                AVG(duration) as avgDuration,
                COALESCE(SUM(input_tokens), 0) as totalInputTokens,
                COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
                COALESCE(SUM(cache_tokens), 0) as totalCacheTokens,
                AVG(CASE WHEN ${UPSTREAM_TTFB_SQL_COND} THEN upstream_ttfb_ms END) as avgTtfb,
                AVG(CASE WHEN queue_wait_ms IS NOT NULL THEN queue_wait_ms END) as avgQueueWaitMs
         FROM ${METRICS_TABLE}
         WHERE ${timeFilter}`
      )
      .get(...timeParams) as Record<string, unknown>;

    const totalInput = (base.totalInputTokens as number) ?? 0;
    const totalOutput = (base.totalOutputTokens as number) ?? 0;
    const totalCache = (base.totalCacheTokens as number) ?? 0;

    const tps = this.d
      .prepare(
        `SELECT COALESCE(SUM(output_tokens), 0) as filteredTokens,
                COALESCE(SUM(gen_ms), 0) as filteredGenTime,
                COUNT(*) as filteredCount
         FROM ${METRICS_TABLE}
         WHERE ${timeFilter}
           AND ${STREAM_GEN_SQL_COND}
           AND output_tokens IS NOT NULL
           AND output_tokens > 0`
      )
      .get(...timeParams) as Record<string, unknown>;

    const filteredTokens = (tps.filteredTokens as number) ?? 0;
    const filteredGenTime = (tps.filteredGenTime as number) ?? 0;
    const filteredCount = (tps.filteredCount as number) ?? 0;
    const outputTps = filteredGenTime > 0 ? (filteredTokens / filteredGenTime) * 1000 : 0;

    let p50Duration = 0;
    let p90Duration = 0;
    const totalMsCount = this.d
      .prepare(
        `SELECT COUNT(*) as c FROM ${METRICS_TABLE} WHERE ${timeFilter} AND ${TOTAL_MS_SQL_COND}`
      )
      .get(...timeParams) as Record<string, unknown>;
    const totalMsRows = (totalMsCount?.c as number) ?? 0;
    if (totalMsRows > 0) {
      const p50Offset = Math.floor(0.5 * (totalMsRows - 1));
      const p90Offset = Math.floor(0.9 * (totalMsRows - 1));
      const p50Row = this.d
        .prepare(
          `SELECT total_ms FROM ${METRICS_TABLE} WHERE ${timeFilter} AND ${TOTAL_MS_SQL_COND} ORDER BY total_ms ASC LIMIT 1 OFFSET ?`
        )
        .get(...timeParams, p50Offset) as Record<string, unknown> | undefined;
      const p90Row = this.d
        .prepare(
          `SELECT total_ms FROM ${METRICS_TABLE} WHERE ${timeFilter} AND ${TOTAL_MS_SQL_COND} ORDER BY total_ms ASC LIMIT 1 OFFSET ?`
        )
        .get(...timeParams, p90Offset) as Record<string, unknown> | undefined;
      p50Duration = Math.round((p50Row?.total_ms as number) ?? 0);
      p90Duration = Math.round((p90Row?.total_ms as number) ?? 0);
    }

    const providerRows = this.d
      .prepare(
        `SELECT provider_id, provider_name, COUNT(*) as count,
                COALESCE(SUM(input_tokens), 0) as totalInputTokens,
                COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
                COALESCE(SUM(cache_tokens), 0) as totalCacheTokens
         FROM ${METRICS_TABLE}
         WHERE ${timeFilter}
         GROUP BY provider_id, provider_name`
      )
      .all(...timeParams) as Record<string, unknown>[];

    const byProvider: Record<string, number> = {};
    const providerBreakdown: ProviderStatRow[] = [];
    for (const r of providerRows) {
      byProvider[r.provider_id as string] = r.count as number;
      const inputTokens = (r.totalInputTokens as number) ?? 0;
      const cacheTokens = (r.totalCacheTokens as number) ?? 0;
      providerBreakdown.push({
        providerId: r.provider_id as string,
        providerName: (r.provider_name as string) || (r.provider_id as string),
        count: r.count as number,
        totalInputTokens: inputTokens,
        totalOutputTokens: (r.totalOutputTokens as number) ?? 0,
        totalCacheTokens: cacheTokens,
        cacheHitRate: inputTokens > 0 ? Math.round((cacheTokens / inputTokens) * 100) : 0,
      });
    }

    return {
      totalLogs: (base.totalLogs as number) ?? 0,
      successCount: (base.successCount as number) ?? 0,
      errorCount: (base.errorCount as number) ?? 0,
      avgDuration: Math.round((base.avgDuration as number) ?? 0),
      byProvider,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheTokens: totalCache,
      cacheHitRate: totalInput > 0 ? Math.round((totalCache / totalInput) * 100) : 0,
      avgTtfb: Math.round((base.avgTtfb as number) ?? 0),
      outputTps: Math.round(outputTps * 10) / 10,
      outputTpsSampleCount: filteredCount,
      avgQueueWaitMs: Math.round((base.avgQueueWaitMs as number) ?? 0),
      p50Duration,
      p90Duration,
      providerBreakdown: filterProviderBreakdownByTokenUsage(providerBreakdown),
    };
  }

  async close(): Promise<void> {
    this.isEnabled = false;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
