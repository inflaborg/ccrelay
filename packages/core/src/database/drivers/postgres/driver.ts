/**
 * PostgreSQL Driver
 * Pure Node.js implementation using node-postgres (pg)
 * Implements DatabaseDriver interface with business-level methods.
 */

import { Pool, PoolClient } from "pg";
import { Logger } from "../../../utils/logger";
import { TABLE, METRICS_TABLE } from "../../schema";
import { runPostgresMigrations } from "../../migration";
import {
  shouldTrackMetrics,
  POSTGRES_UPDATE_METRICS_COMPLETED,
  POSTGRES_UPDATE_METRICS_STATUS,
} from "../../metrics-sql";
import type {
  DatabaseDriver,
  PostgresDriverConfig,
  RequestLog,
  LogFilter,
  LogQueryResult,
  DatabaseStats,
  ProviderStatRow,
  RequestStatus,
  StatsQuery,
  DatabaseInitializeOptions,
} from "../../types";
import {
  utf8StringToBlob,
  dbRowToLog,
  dbRowToLogWithoutBody,
  filterProviderBreakdownByTokenUsage,
} from "../../shared-utils";
import { STREAM_PERF_SQL_COND } from "../../stream-metrics";

/**
 * PostgreSQL driver implementation
 */
export class PostgresDriver implements DatabaseDriver {
  private pool: Pool | null = null;
  private readonly config: PostgresDriverConfig;
  private readonly log = Logger.getInstance();
  private isInitialized = false;
  private _logsEnabled = false;

  constructor(config: PostgresDriverConfig) {
    this.config = config;
  }

  /**
   * Initialize the database
   */
  async initialize(options?: DatabaseInitializeOptions): Promise<void> {
    if (this.pool) {
      return;
    }

    this.log.info(
      `[PostgresDriver] Connecting to ${this.config.host}:${this.config.port}/${this.config.database}`
    );

    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    const client = await this.pool.connect();
    client.release();

    const choice = options?.migrationChoice ?? "migrate";
    this.log.info("[PostgresDriver] Running database migrations...");
    await runPostgresMigrations({
      query: (sql, params) => this.pool!.query(sql, params),
      migrationChoice: choice,
      dbLabel: `${this.config.host}:${this.config.port}/${this.config.database}`,
    });
    this.isInitialized = true;
    this._logsEnabled = options?.logsEnabled ?? false;

    this.log.info("[PostgresDriver] Connected successfully");

    // Clean old logs in background
    setTimeout(() => {
      this.cleanOldLogs().catch(err => {
        this.log.error("[PostgresDriver] Background cleanup failed:", err);
      });
    }, 0);
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isInitialized = false;
      this.log.info("[PostgresDriver] Connection closed");
    }
  }

  /**
   * Insert a log entry (immediate insert for PostgreSQL)
   */
  insertLog(log: RequestLog): void {
    if (!this.isEnabled) {
      return;
    }

    this.insertLogAsync(log).catch(err => {
      this.log.error("[PostgresDriver] Failed to insert log:", err);
    });
  }

  private async insertLogAsync(log: RequestLog): Promise<void> {
    if (!this.pool) {
      return;
    }

    if (this._logsEnabled) {
      await this.pool.query(
        `INSERT INTO ${TABLE} (
        timestamp, provider_id, provider_name, method, path, target_url,
        request_body, response_body, original_request_body, original_response_body,
        status_code, duration, success, error_message, client_id, status, route_type,
        request_headers, response_headers
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          log.timestamp,
          log.providerId,
          log.providerName,
          log.method,
          log.path,
          log.targetUrl ?? null,
          utf8StringToBlob(log.requestBody),
          utf8StringToBlob(log.responseBody),
          utf8StringToBlob(log.originalRequestBody),
          utf8StringToBlob(log.originalResponseBody),
          log.statusCode ?? null,
          log.duration,
          log.success,
          utf8StringToBlob(log.errorMessage),
          log.clientId ?? null,
          "completed",
          log.routeType ?? null,
          log.requestHeaders ?? null,
          null,
        ]
      );
    }
    if (shouldTrackMetrics(log)) {
      await this.insertMetricsCompleted(log);
    }
  }

  private async insertMetricsPending(log: RequestLog): Promise<void> {
    if (!this.pool) {
      return;
    }
    await this.pool.query(
      `INSERT INTO ${METRICS_TABLE} (
        timestamp, provider_id, provider_name, model, client_id,
        input_tokens, output_tokens, cache_tokens, ttfb, duration, success, status_code
      ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      [log.timestamp, log.providerId, log.providerName, log.model ?? null, log.clientId ?? null]
    );
  }

  private async insertMetricsCompleted(log: RequestLog): Promise<void> {
    if (!this.pool) {
      return;
    }
    await this.pool.query(
      `INSERT INTO ${METRICS_TABLE} (
        timestamp, provider_id, provider_name, model, client_id,
        input_tokens, output_tokens, cache_tokens, ttfb, duration, success, status_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (client_id) DO UPDATE SET
        input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        cache_tokens = EXCLUDED.cache_tokens,
        ttfb = EXCLUDED.ttfb,
        duration = EXCLUDED.duration,
        success = EXCLUDED.success,
        status_code = EXCLUDED.status_code`,
      [
        log.timestamp,
        log.providerId,
        log.providerName,
        log.model ?? null,
        log.clientId ?? null,
        log.inputTokens ?? null,
        log.outputTokens ?? null,
        log.cacheTokens ?? null,
        log.ttfb ?? null,
        log.duration,
        log.success,
        log.statusCode ?? null,
      ]
    );
  }

  /**
   * Insert a log entry with "pending" status
   */
  insertLogPending(log: RequestLog): void {
    if (!this.isEnabled) {
      return;
    }

    this.insertLogPendingAsync(log).catch(err => {
      this.log.error("[PostgresDriver] Failed to insert pending log:", err);
    });
  }

  private async insertLogPendingAsync(log: RequestLog): Promise<void> {
    if (!this.pool) {
      return;
    }

    if (this._logsEnabled) {
      await this.pool.query(
        `INSERT INTO ${TABLE} (
        timestamp, provider_id, provider_name, method, path, target_url,
        request_body, response_body, original_request_body, original_response_body,
        status_code, duration, success, error_message, client_id, status, route_type,
        request_headers, response_headers
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          log.timestamp,
          log.providerId,
          log.providerName,
          log.method,
          log.path,
          log.targetUrl ?? null,
          utf8StringToBlob(log.requestBody),
          utf8StringToBlob(log.responseBody),
          utf8StringToBlob(log.originalRequestBody),
          utf8StringToBlob(log.originalResponseBody),
          log.statusCode ?? null,
          log.duration,
          log.success,
          utf8StringToBlob(log.errorMessage),
          log.clientId ?? null,
          "pending",
          log.routeType ?? null,
          log.requestHeaders ?? null,
          null,
        ]
      );
    }
    if (shouldTrackMetrics(log)) {
      await this.insertMetricsPending(log);
    }
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
    originalResponseBody?: string,
    inputTokens?: number,
    outputTokens?: number,
    cacheTokens?: number,
    ttfb?: number,
    responseHeadersMasked?: string
  ): void {
    if (!this.isEnabled) {
      return;
    }

    Promise.all([
      ...(this._logsEnabled
        ? [
            this.pool!.query(
              `UPDATE ${TABLE}
         SET status_code = $1,
             response_body = $2,
             original_response_body = $3,
             duration = $4,
             success = $5,
             error_message = $6,
             response_headers = $7,
             status = 'completed'
         WHERE client_id = $8`,
              [
                statusCode,
                utf8StringToBlob(responseBody),
                utf8StringToBlob(originalResponseBody),
                duration,
                success,
                utf8StringToBlob(errorMessage),
                responseHeadersMasked ?? null,
                clientId,
              ]
            ),
          ]
        : []),
      this.pool!.query(POSTGRES_UPDATE_METRICS_COMPLETED, [
        inputTokens ?? null,
        outputTokens ?? null,
        cacheTokens ?? null,
        ttfb ?? null,
        duration,
        success,
        statusCode,
        clientId,
      ]),
    ]).catch(err => {
      this.log.error("[PostgresDriver] Failed to update log:", err);
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
    if (!this.pool) {
      return;
    }

    Promise.all([
      ...(this._logsEnabled
        ? [
            this.pool.query(
              `UPDATE ${TABLE}
         SET status_code = $1,
             duration = $2,
             success = $3,
             error_message = $4,
             status = $5
         WHERE client_id = $6`,
              [statusCode, duration, false, utf8StringToBlob(errorMessage), status, clientId]
            ),
          ]
        : []),
      this.pool.query(POSTGRES_UPDATE_METRICS_STATUS, [duration, false, statusCode, clientId]),
    ]).catch(err => {
      this.log.error("[PostgresDriver] Failed to update log status:", err);
    });
  }

  /**
   * Batch insert logs
   */
  async writeBatch(logs: RequestLog[]): Promise<void> {
    if (!this.pool || logs.length === 0) {
      return;
    }

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (const log of logs) {
        if (this._logsEnabled) {
          await client.query(
            `INSERT INTO ${TABLE} (
            timestamp, provider_id, provider_name, method, path, target_url,
            request_body, response_body, original_request_body, original_response_body,
            status_code, duration, success, error_message, client_id, status, route_type,
            request_headers, response_headers
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
            [
              log.timestamp,
              log.providerId,
              log.providerName,
              log.method,
              log.path,
              log.targetUrl ?? null,
              utf8StringToBlob(log.requestBody),
              utf8StringToBlob(log.responseBody),
              utf8StringToBlob(log.originalRequestBody),
              utf8StringToBlob(log.originalResponseBody),
              log.statusCode ?? null,
              log.duration,
              log.success,
              utf8StringToBlob(log.errorMessage),
              log.clientId ?? null,
              "completed",
              log.routeType ?? null,
              log.requestHeaders ?? null,
              null,
            ]
          );
        }
        if (shouldTrackMetrics(log)) {
          await this.insertMetricsCompleted(log);
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Query logs with filter
   */
  async queryLogs(filter: LogFilter = {}): Promise<LogQueryResult> {
    if (!this.pool) {
      return { logs: [], total: 0 };
    }

    const conditions: string[] = [];
    const params: (string | number | boolean | null)[] = [];
    let paramIndex = 1;

    if (filter.providerId) {
      conditions.push(`v.provider_id = $${paramIndex++}`);
      params.push(filter.providerId);
    }

    if (filter.method) {
      conditions.push(`v.method = $${paramIndex++}`);
      params.push(filter.method);
    }

    if (filter.pathPattern) {
      conditions.push(`v.path LIKE $${paramIndex++}`);
      params.push(`%${filter.pathPattern}%`);
    }

    if (filter.minDuration !== undefined) {
      conditions.push(`v.duration >= $${paramIndex++}`);
      params.push(filter.minDuration);
    }

    if (filter.maxDuration !== undefined) {
      conditions.push(`v.duration <= $${paramIndex++}`);
      params.push(filter.maxDuration);
    }

    if (filter.hasError !== undefined) {
      conditions.push(`v.success = $${paramIndex++}`);
      params.push(!filter.hasError);
    }

    if (filter.startTime !== undefined) {
      conditions.push(`v.timestamp >= $${paramIndex++}`);
      params.push(filter.startTime);
    }

    if (filter.endTime !== undefined) {
      conditions.push(`v.timestamp <= $${paramIndex++}`);
      params.push(filter.endTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${TABLE} v ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10) || 0;

    const limit = filter.limit || 100;
    const offset = filter.offset || 0;

    const rowsResult = await this.pool.query(
      `SELECT v.*, m.input_tokens, m.output_tokens, m.cache_tokens, m.ttfb, m.model as metrics_model
       FROM ${TABLE} v
       LEFT JOIN ${METRICS_TABLE} m ON m.client_id = v.client_id
       ${whereClause} ORDER BY v.timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );

    const logs = rowsResult.rows.map(dbRowToLogWithoutBody);

    return { logs, total };
  }

  /**
   * Get a single log by ID
   */
  async getLogById(id: number): Promise<RequestLog | null> {
    if (!this.pool) {
      return null;
    }

    const result = await this.pool.query(
      `SELECT v.*, m.input_tokens, m.output_tokens, m.cache_tokens, m.ttfb
       FROM ${TABLE} v
       LEFT JOIN ${METRICS_TABLE} m ON m.client_id = v.client_id
       WHERE v.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return dbRowToLog(result.rows[0] as Record<string, unknown>);
  }

  /**
   * Delete logs by IDs
   */
  async deleteLogs(ids: number[]): Promise<void> {
    if (!this.pool || ids.length === 0) {
      return;
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    await this.pool.query(`DELETE FROM ${TABLE} WHERE id IN (${placeholders})`, ids);
  }

  /**
   * Clear all logs
   */
  async clearAllLogs(): Promise<void> {
    if (!this.pool) {
      return;
    }
    await this.pool.query(`DELETE FROM ${TABLE}`);
  }

  async clearAllMetrics(): Promise<void> {
    if (!this.pool) {
      return;
    }
    await this.pool.query(`DELETE FROM ${METRICS_TABLE}`);
  }

  /**
   * Clean old logs
   */
  async cleanOldLogs(): Promise<void> {
    if (!this.pool) {
      return;
    }

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await this.pool.query(`DELETE FROM ${TABLE} WHERE timestamp < $1`, [thirtyDaysAgo]);
    await this.pool.query(`DELETE FROM ${METRICS_TABLE} WHERE timestamp < $1`, [thirtyDaysAgo]);

    // PostgreSQL doesn't need VACUUM like SQLite, but we can run VACUUM ANALYZE
    // Note: VACUUM cannot run inside a transaction block
  }

  /**
   * Get database statistics
   */
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

    if (!this.pool) {
      return empty;
    }

    const since = query?.since ?? null;
    const timeFilter = since ? "timestamp >= $1" : "1=1";
    const timeParams = since ? [since] : [];

    // 1. Base stats + tokens + percentiles (single scan with percentile_cont)
    const baseResult = await this.pool.query(
      `SELECT COUNT(*) as "totalLogs",
              SUM(CASE WHEN success = true THEN 1 ELSE 0 END) as "successCount",
              SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as "errorCount",
              AVG(duration) as "avgDuration",
              COALESCE(SUM(input_tokens), 0) as "totalInputTokens",
              COALESCE(SUM(output_tokens), 0) as "totalOutputTokens",
              COALESCE(SUM(cache_tokens), 0) as "totalCacheTokens",
              AVG(CASE WHEN ${STREAM_PERF_SQL_COND} THEN ttfb END) as "avgTtfb",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY duration) as "p50Duration",
              percentile_cont(0.9) WITHIN GROUP (ORDER BY duration) as "p90Duration"
       FROM ${METRICS_TABLE}
       WHERE ${timeFilter}`,
      timeParams
    );
    const base = (baseResult.rows[0] as Record<string, string | number | null> | undefined) ?? {};
    const num = (v: string | number | null | undefined): number =>
      parseInt(String(v ?? "0"), 10) || 0;
    const fnum = (v: string | number | null | undefined): number =>
      parseFloat(String(v ?? "0")) || 0;
    const totalInput = num(base.totalInputTokens);
    const totalOutput = num(base.totalOutputTokens);
    const totalCache = num(base.totalCacheTokens);
    const denominator = totalInput + totalCache;
    const totalLogs = num(base.totalLogs);

    // 2. Filtered TPS
    const tpsResult = await this.pool.query(
      `SELECT COALESCE(SUM(output_tokens), 0) as "filteredTokens",
              COALESCE(SUM(duration - ttfb), 0) as "filteredGenTime",
              COUNT(*) as "filteredCount"
       FROM ${METRICS_TABLE}
       WHERE ${timeFilter}
         AND ${STREAM_PERF_SQL_COND}
         AND output_tokens IS NOT NULL
         AND output_tokens > 0`,
      timeParams
    );
    const tps = (tpsResult.rows[0] as Record<string, string | number | null> | undefined) ?? {};
    const filteredTokens = num(tps.filteredTokens);
    const filteredGenTime = num(tps.filteredGenTime);
    const filteredCount = num(tps.filteredCount);
    const outputTps = filteredGenTime > 0 ? (filteredTokens / filteredGenTime) * 1000 : 0;

    // 3. Provider breakdown
    const providerResult = await this.pool.query(
      `SELECT provider_id, MAX(provider_name) as provider_name, COUNT(*) as count,
              COALESCE(SUM(input_tokens), 0) as "totalInputTokens",
              COALESCE(SUM(output_tokens), 0) as "totalOutputTokens",
              COALESCE(SUM(cache_tokens), 0) as "totalCacheTokens"
       FROM ${METRICS_TABLE}
       WHERE ${timeFilter}
       GROUP BY provider_id`,
      timeParams
    );

    const byProvider: Record<string, number> = {};
    const providerBreakdown: ProviderStatRow[] = [];
    for (const raw of providerResult.rows) {
      const row = raw as Record<string, string | number | null>;
      const pid = String(row.provider_id);
      const count = num(row.count);
      byProvider[pid] = count;
      const inputTokens = num(row.totalInputTokens);
      const cacheTokens = num(row.totalCacheTokens);
      const denom = inputTokens + cacheTokens;
      providerBreakdown.push({
        providerId: pid,
        providerName: String(row.provider_name ?? pid),
        count,
        totalInputTokens: inputTokens,
        totalOutputTokens: num(row.totalOutputTokens),
        totalCacheTokens: cacheTokens,
        cacheHitRate: denom > 0 ? Math.round((cacheTokens / denom) * 100) : 0,
      });
    }

    return {
      totalLogs,
      successCount: num(base.successCount),
      errorCount: num(base.errorCount),
      avgDuration: Math.round(fnum(base.avgDuration)),
      byProvider,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheTokens: totalCache,
      cacheHitRate: denominator > 0 ? Math.round((totalCache / denominator) * 100) : 0,
      avgTtfb: Math.round(fnum(base.avgTtfb)),
      outputTps: Math.round(outputTps * 10) / 10,
      outputTpsSampleCount: filteredCount,
      p50Duration: Math.round(fnum(base.p50Duration)),
      p90Duration: Math.round(fnum(base.p90Duration)),
      providerBreakdown: filterProviderBreakdownByTokenUsage(providerBreakdown),
    };
  }

  /**
   * Check if driver is enabled
   */
  get enabled(): boolean {
    return this.isEnabled;
  }

  get logsEnabled(): boolean {
    return this._logsEnabled;
  }

  setLogsEnabled(enabled: boolean): void {
    this._logsEnabled = enabled;
  }

  private get isEnabled(): boolean {
    return this.isInitialized && this.pool !== null;
  }

  /**
   * Force flush (no-op for PostgreSQL as inserts are immediate)
   */
  forceFlush(): void {
    // PostgreSQL inserts are immediate, no queue to flush
  }
}
