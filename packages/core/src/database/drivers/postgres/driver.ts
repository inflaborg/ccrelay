/**
 * PostgreSQL Driver
 * Pure Node.js implementation using node-postgres (pg)
 * Implements DatabaseDriver interface with business-level methods.
 */

import { Pool, PoolClient } from "pg";
import { Logger } from "../../../utils/logger";
import { TABLE } from "../../schema";
import { runPostgresStartupMigration } from "../../migration";
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
import { utf8StringToBlob, dbRowToLog, dbRowToLogWithoutBody } from "../../shared-utils";

/**
 * PostgreSQL driver implementation
 */
export class PostgresDriver implements DatabaseDriver {
  private pool: Pool | null = null;
  private readonly config: PostgresDriverConfig;
  private readonly log = Logger.getInstance();
  private isInitialized = false;

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
    await runPostgresStartupMigration((sql, params) => this.pool!.query(sql, params), choice);
    this.isInitialized = true;

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

    await this.pool.query(
      `INSERT INTO ${TABLE} (
        timestamp, provider_id, provider_name, method, path, target_url,
        request_body, response_body, original_request_body, original_response_body,
        status_code, duration, success, error_message, client_id, status, route_type,
        input_tokens, output_tokens, cache_tokens, ttfb
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
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
        log.inputTokens ?? null,
        log.outputTokens ?? null,
        log.cacheTokens ?? null,
        log.ttfb ?? null,
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

    await this.pool.query(
      `INSERT INTO ${TABLE} (
        timestamp, provider_id, provider_name, method, path, target_url,
        request_body, response_body, original_request_body, original_response_body,
        status_code, duration, success, error_message, client_id, status, route_type,
        input_tokens, output_tokens, cache_tokens, ttfb
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
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
        log.inputTokens ?? null,
        log.outputTokens ?? null,
        log.cacheTokens ?? null,
        log.ttfb ?? null,
      ]
    );
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
    ttfb?: number
  ): void {
    if (!this.isEnabled) {
      return;
    }

    this.pool!.query(
      `UPDATE ${TABLE}
         SET status_code = $1,
             response_body = $2,
             original_response_body = $3,
             duration = $4,
             success = $5,
             error_message = $6,
             status = 'completed',
             input_tokens = $7,
             output_tokens = $8,
             cache_tokens = $9,
             ttfb = $10
         WHERE client_id = $11`,
      [
        statusCode,
        utf8StringToBlob(responseBody),
        utf8StringToBlob(originalResponseBody),
        duration,
        success,
        utf8StringToBlob(errorMessage),
        inputTokens ?? null,
        outputTokens ?? null,
        cacheTokens ?? null,
        ttfb ?? null,
        clientId,
      ]
    ).catch(err => {
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

    this.pool
      .query(
        `UPDATE ${TABLE}
         SET status_code = $1,
             duration = $2,
             success = $3,
             error_message = $4,
             status = $5
         WHERE client_id = $6`,
        [
          statusCode,
          duration,
          false, // success is always false for cancelled/timeout
          utf8StringToBlob(errorMessage),
          status,
          clientId,
        ]
      )
      .catch(err => {
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
        await client.query(
          `INSERT INTO ${TABLE} (
            timestamp, provider_id, provider_name, method, path, target_url,
            request_body, response_body, original_request_body, original_response_body,
            status_code, duration, success, error_message, client_id, status, route_type,
            input_tokens, output_tokens, cache_tokens, ttfb
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
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
            log.inputTokens ?? null,
            log.outputTokens ?? null,
            log.cacheTokens ?? null,
            log.ttfb ?? null,
          ]
        );
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
      conditions.push(`provider_id = $${paramIndex++}`);
      params.push(filter.providerId);
    }

    if (filter.method) {
      conditions.push(`method = $${paramIndex++}`);
      params.push(filter.method);
    }

    if (filter.pathPattern) {
      conditions.push(`path LIKE $${paramIndex++}`);
      params.push(`%${filter.pathPattern}%`);
    }

    if (filter.minDuration !== undefined) {
      conditions.push(`duration >= $${paramIndex++}`);
      params.push(filter.minDuration);
    }

    if (filter.maxDuration !== undefined) {
      conditions.push(`duration <= $${paramIndex++}`);
      params.push(filter.maxDuration);
    }

    if (filter.hasError !== undefined) {
      conditions.push(`success = $${paramIndex++}`);
      params.push(!filter.hasError);
    }

    if (filter.startTime !== undefined) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(filter.startTime);
    }

    if (filter.endTime !== undefined) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(filter.endTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get total count
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${TABLE} ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10) || 0;

    // Get paginated logs
    const limit = filter.limit || 100;
    const offset = filter.offset || 0;

    const rowsResult = await this.pool.query(
      `SELECT * FROM ${TABLE} ${whereClause} ORDER BY timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
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

    const result = await this.pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);

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

  /**
   * Clean old logs
   */
  async cleanOldLogs(): Promise<void> {
    if (!this.pool) {
      return;
    }

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await this.pool.query("DELETE FROM ${TABLE} WHERE timestamp < $1", [thirtyDaysAgo]);

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
              AVG(ttfb) as "avgTtfb",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY duration) as "p50Duration",
              percentile_cont(0.9) WITHIN GROUP (ORDER BY duration) as "p90Duration"
       FROM ${TABLE}
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
       FROM ${TABLE}
       WHERE ${timeFilter}
         AND ttfb IS NOT NULL
         AND output_tokens IS NOT NULL
         AND output_tokens > 0
         AND (duration - ttfb) > 500`,
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
       FROM ${TABLE}
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
      providerBreakdown.push({
        providerId: pid,
        providerName: String(row.provider_name ?? pid),
        count,
        totalInputTokens: num(row.totalInputTokens),
        totalOutputTokens: num(row.totalOutputTokens),
        totalCacheTokens: num(row.totalCacheTokens),
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
      providerBreakdown,
    };
  }

  /**
   * Check if driver is enabled
   */
  get enabled(): boolean {
    return this.isEnabled;
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
