/**
 * PostgreSQL Driver
 * Pure Node.js implementation using node-postgres (pg)
 * Implements DatabaseDriver interface with business-level methods.
 */

import { Pool, PoolClient } from "pg";
import { Logger } from "../../utils/logger";
import type {
  DatabaseDriver,
  PostgresDriverConfig,
  RequestLog,
  LogFilter,
  LogQueryResult,
  DatabaseStats,
} from "../types";

/**
 * Base64 encoding helpers for storage
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
      return value;
    }
  }
  return value;
}

/**
 * Convert a database row to RequestLog (without body fields)
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
    success: row.success === true || row.success === 1,
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
 * Convert database row to RequestLog (with body fields)
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
    success: row.success === true || row.success === 1,
    errorMessage: decodeFromStorage(row.error_message as string | undefined),
    clientId: row.client_id as string | undefined,
    status: row.status as RequestLog["status"],
    routeType: row.route_type as RequestLog["routeType"],
  };
}

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
  async initialize(): Promise<void> {
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

    // Test connection
    const client = await this.pool.connect();
    client.release();

    await this.createSchema();
    this.isInitialized = true;

    this.log.info("[PostgresDriver] Connected successfully");

    // Clean old logs in background
    setTimeout(() => {
      this.cleanOldLogs().catch(err => {
        this.log.error("[PostgresDriver] Background cleanup failed:", err);
      });
    }, 0);
  }

  private async createSchema(): Promise<void> {
    if (!this.pool) {return;}

    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS request_logs (
          id SERIAL PRIMARY KEY,
          timestamp BIGINT NOT NULL,
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
          success BOOLEAN NOT NULL,
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
        await client.query(sql);
      }
    } finally {
      client.release();
    }
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
    if (!this.isEnabled) {return;}

    this.insertLogAsync(log).catch(err => {
      this.log.error("[PostgresDriver] Failed to insert log:", err);
    });
  }

  private async insertLogAsync(log: RequestLog): Promise<void> {
    if (!this.pool) {return;}

    await this.pool.query(
      `INSERT INTO request_logs (
        timestamp, provider_id, provider_name, method, path, target_url,
        request_body, response_body, original_request_body, original_response_body,
        status_code, duration, success, error_message, client_id, status, route_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
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
        log.success,
        encodeForStorage(log.errorMessage),
        log.clientId ?? null,
        "completed",
        log.routeType ?? null,
      ]
    );
  }

  /**
   * Insert a log entry with "pending" status
   */
  insertLogPending(log: RequestLog): void {
    if (!this.isEnabled) {return;}

    this.insertLogPendingAsync(log).catch(err => {
      this.log.error("[PostgresDriver] Failed to insert pending log:", err);
    });
  }

  private async insertLogPendingAsync(log: RequestLog): Promise<void> {
    if (!this.pool) {return;}

    await this.pool.query(
      `INSERT INTO request_logs (
        timestamp, provider_id, provider_name, method, path, target_url,
        request_body, response_body, original_request_body, original_response_body,
        status_code, duration, success, error_message, client_id, status, route_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
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
        log.success,
        encodeForStorage(log.errorMessage),
        log.clientId ?? null,
        "pending",
        log.routeType ?? null,
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
    originalResponseBody?: string
  ): void {
    if (!this.isEnabled) {return;}

    this.pool!
      .query(
        `UPDATE request_logs
         SET status_code = $1,
             response_body = $2,
             original_response_body = $3,
             duration = $4,
             success = $5,
             error_message = $6,
             status = 'completed'
         WHERE client_id = $7`,
        [
          statusCode,
          encodeForStorage(responseBody),
          encodeForStorage(originalResponseBody),
          duration,
          success,
          encodeForStorage(errorMessage),
          clientId,
        ]
      )
      .catch(err => {
        this.log.error("[PostgresDriver] Failed to update log:", err);
      });
  }

  /**
   * Batch insert logs
   */
  async writeBatch(logs: RequestLog[]): Promise<void> {
    if (!this.pool || logs.length === 0) {return;}

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (const log of logs) {
        await client.query(
          `INSERT INTO request_logs (
            timestamp, provider_id, provider_name, method, path, target_url,
            request_body, response_body, original_request_body, original_response_body,
            status_code, duration, success, error_message, client_id, status, route_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
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
            log.success,
            encodeForStorage(log.errorMessage),
            log.clientId ?? null,
            "completed",
            log.routeType ?? null,
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
      `SELECT COUNT(*) as count FROM request_logs ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10) || 0;

    // Get paginated logs
    const limit = filter.limit || 100;
    const offset = filter.offset || 0;

    const rowsResult = await this.pool.query(
      `SELECT * FROM request_logs ${whereClause} ORDER BY timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );

    const logs = rowsResult.rows.map(dbRowToLogWithoutBody);

    return { logs, total };
  }

  /**
   * Get a single log by ID
   */
  async getLogById(id: number): Promise<RequestLog | null> {
    if (!this.pool) {return null;}

    const result = await this.pool.query("SELECT * FROM request_logs WHERE id = $1", [id]);

    if (result.rows.length === 0) {return null;}

    return dbRowToLog(result.rows[0] as Record<string, unknown>);
  }

  /**
   * Delete logs by IDs
   */
  async deleteLogs(ids: number[]): Promise<void> {
    if (!this.pool || ids.length === 0) {return;}

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    await this.pool.query(`DELETE FROM request_logs WHERE id IN (${placeholders})`, ids);
  }

  /**
   * Clear all logs
   */
  async clearAllLogs(): Promise<void> {
    if (!this.pool) {return;}
    await this.pool.query("DELETE FROM request_logs");
  }

  /**
   * Clean old logs
   */
  async cleanOldLogs(): Promise<void> {
    if (!this.pool) {return;}

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await this.pool.query("DELETE FROM request_logs WHERE timestamp < $1", [thirtyDaysAgo]);

    // PostgreSQL doesn't need VACUUM like SQLite, but we can run VACUUM ANALYZE
    // Note: VACUUM cannot run inside a transaction block
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<DatabaseStats> {
    if (!this.pool) {
      return {
        totalLogs: 0,
        successCount: 0,
        errorCount: 0,
        avgDuration: 0,
        byProvider: {},
      };
    }

    const totalResult = await this.pool.query<{ count: string }>("SELECT COUNT(*) as count FROM request_logs");
    const total = parseInt(totalResult.rows[0]?.count ?? "0", 10) || 0;

    const successResult = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM request_logs WHERE success = true"
    );
    const successCount = parseInt(successResult.rows[0]?.count ?? "0", 10) || 0;

    const errorResult = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM request_logs WHERE success = false"
    );
    const errorCount = parseInt(errorResult.rows[0]?.count ?? "0", 10) || 0;

    const avgResult = await this.pool.query<{ avg: string | null }>("SELECT AVG(duration) as avg FROM request_logs");
    const avgDuration = parseFloat(avgResult.rows[0]?.avg ?? "0") || 0;

    /* eslint-disable @typescript-eslint/naming-convention */
    const byProviderResult = await this.pool.query<{
      provider_id: string;
      count: string;
    }>("SELECT provider_id, COUNT(*) as count FROM request_logs GROUP BY provider_id");
    /* eslint-enable @typescript-eslint/naming-convention */

    const byProvider: Record<string, number> = {};
    for (const row of byProviderResult.rows) {
      byProvider[row.provider_id] = parseInt(row.count, 10);
    }

    return {
      totalLogs: total,
      successCount,
      errorCount,
      avgDuration: Math.round(avgDuration),
      byProvider,
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
