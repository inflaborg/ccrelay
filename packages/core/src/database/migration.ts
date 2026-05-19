/**
 * TEMPORARY: One-time migration from legacy `request_logs` to `request_logs_v2`.
 * TODO: Remove this module and startup migration in a future release.
 */

import {
  LEGACY_TABLE,
  TABLE,
  SQLITE_CREATE_TABLE_V2,
  SQLITE_INDEXES_V2,
  POSTGRES_CREATE_TABLE_V2,
  POSTGRES_INDEXES_V2,
} from "./schema";
import { decodeFromStorage, utf8StringToBlob } from "./shared-utils";
import type { LogDbMigrationChoice } from "./types";

export interface MigrationPrecheckResult {
  dbPath: string;
  oldRowCount: number;
}

export function ensureSqliteV2Schema(exec: (sql: string) => void): void {
  exec(SQLITE_CREATE_TABLE_V2);
  for (const sql of SQLITE_INDEXES_V2) {
    exec(sql);
  }
}

export async function ensurePostgresV2Schema(query: (sql: string) => Promise<void>): Promise<void> {
  await query(POSTGRES_CREATE_TABLE_V2);
  for (const sql of POSTGRES_INDEXES_V2) {
    await query(sql);
  }
}

export function sqliteLegacyTableExists(
  queryScalar: (sql: string) => number | null | undefined
): boolean {
  const count =
    queryScalar(
      `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='${LEGACY_TABLE}'`
    ) ?? 0;
  return count > 0;
}

export function sqliteCountLegacyRows(
  queryScalar: (sql: string) => number | null | undefined
): number {
  if (!sqliteLegacyTableExists(queryScalar)) {
    return 0;
  }
  return queryScalar(`SELECT COUNT(*) as c FROM ${LEGACY_TABLE}`) ?? 0;
}

export function sqliteDropLegacy(exec: (sql: string) => void): void {
  exec(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
}

function legacyTextToBlob(value: unknown): Buffer | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === "string") {
    const decoded = decodeFromStorage(value);
    return utf8StringToBlob(decoded);
  }
  return null;
}

export function sqliteMigrateLegacyToV2(
  queryAll: (sql: string) => Array<Record<string, unknown>>,
  runInsert: (row: Record<string, unknown>) => void
): number {
  const rows = queryAll(`SELECT * FROM ${LEGACY_TABLE}`);
  for (const row of rows) {
    /* eslint-disable @typescript-eslint/naming-convention -- SQL column names */
    runInsert({
      timestamp: row.timestamp,
      provider_id: row.provider_id,
      provider_name: row.provider_name,
      method: row.method,
      path: row.path,
      target_url: row.target_url ?? null,
      request_body: legacyTextToBlob(row.request_body),
      response_body: legacyTextToBlob(row.response_body),
      original_request_body: legacyTextToBlob(row.original_request_body),
      original_response_body: legacyTextToBlob(row.original_response_body),
      status_code: row.status_code ?? null,
      duration: row.duration,
      success: row.success,
      error_message: row.error_message ?? null,
      client_id: row.client_id ?? null,
      status: row.status ?? "completed",
      route_type: row.route_type ?? null,
      input_tokens: row.input_tokens ?? null,
      output_tokens: row.output_tokens ?? null,
      cache_tokens: row.cache_tokens ?? null,
      ttfb: row.ttfb ?? null,
    });
    /* eslint-enable @typescript-eslint/naming-convention */
  }
  return rows.length;
}

export const SQLITE_INSERT_V2 = `INSERT INTO ${TABLE} (
  timestamp, provider_id, provider_name, method, path, target_url,
  request_body, response_body, original_request_body, original_response_body,
  status_code, duration, success, error_message, client_id, status, route_type,
  input_tokens, output_tokens, cache_tokens, ttfb
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function runSqliteStartupMigration(
  dbPath: string,
  queryScalar: (sql: string) => number | null | undefined,
  queryAll: (sql: string) => Array<Record<string, unknown>>,
  exec: (sql: string) => void,
  runInsert: (params: unknown[]) => void,
  choice: LogDbMigrationChoice
): void {
  ensureSqliteV2Schema(exec);
  const oldRowCount = sqliteCountLegacyRows(queryScalar);
  if (oldRowCount === 0) {
    sqliteDropLegacy(exec);
    return;
  }
  if (choice === "migrate") {
    sqliteMigrateLegacyToV2(queryAll, row => {
      runInsert([
        row.timestamp,
        row.provider_id,
        row.provider_name,
        row.method,
        row.path,
        row.target_url,
        row.request_body,
        row.response_body,
        row.original_request_body,
        row.original_response_body,
        row.status_code,
        row.duration,
        row.success,
        row.error_message,
        row.client_id,
        row.status,
        row.route_type,
        row.input_tokens,
        row.output_tokens,
        row.cache_tokens,
        row.ttfb,
      ]);
    });
  }
  sqliteDropLegacy(exec);
}

export async function postgresPrecheckMigration(
  pool: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  dbPath: string
): Promise<MigrationPrecheckResult> {
  const exists = await pool.query(
    `SELECT COUNT(*)::int as c FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [LEGACY_TABLE]
  );
  const tableCount = (exists.rows[0]?.c as number) ?? 0;
  if (tableCount === 0) {
    return { dbPath, oldRowCount: 0 };
  }
  const countRes = await pool.query(`SELECT COUNT(*)::int as c FROM ${LEGACY_TABLE}`);
  const oldRowCount = (countRes.rows[0]?.c as number) ?? 0;
  return { dbPath, oldRowCount };
}

export async function runPostgresStartupMigration(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  choice: LogDbMigrationChoice
): Promise<void> {
  await ensurePostgresV2Schema(sql => query(sql) as Promise<void>);

  const existsRes = (await query(
    `SELECT COUNT(*)::int as c FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [LEGACY_TABLE]
  )) as { rows: Array<{ c: number }> };
  if ((existsRes.rows[0]?.c ?? 0) === 0) {
    return;
  }

  const countRes = (await query(`SELECT COUNT(*)::int as c FROM ${LEGACY_TABLE}`)) as {
    rows: Array<{ c: number }>;
  };
  const oldRowCount = countRes.rows[0]?.c ?? 0;
  if (oldRowCount === 0) {
    await query(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
    return;
  }

  if (choice === "migrate") {
    const legacy = (await query(`SELECT * FROM ${LEGACY_TABLE}`)) as {
      rows: Array<Record<string, unknown>>;
    };
    for (const row of legacy.rows) {
      const toBuf = (v: unknown): Buffer | null => {
        if (v === null || v === undefined) {
          return null;
        }
        if (Buffer.isBuffer(v)) {
          return v;
        }
        if (typeof v === "string") {
          return utf8StringToBlob(decodeFromStorage(v));
        }
        return null;
      };
      await query(
        `INSERT INTO ${TABLE} (
          timestamp, provider_id, provider_name, method, path, target_url,
          request_body, response_body, original_request_body, original_response_body,
          status_code, duration, success, error_message, client_id, status, route_type,
          input_tokens, output_tokens, cache_tokens, ttfb
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          row.timestamp,
          row.provider_id,
          row.provider_name,
          row.method,
          row.path,
          row.target_url ?? null,
          toBuf(row.request_body),
          toBuf(row.response_body),
          toBuf(row.original_request_body),
          toBuf(row.original_response_body),
          row.status_code ?? null,
          row.duration,
          row.success,
          row.error_message ?? null,
          row.client_id ?? null,
          row.status ?? "completed",
          row.route_type ?? null,
          row.input_tokens ?? null,
          row.output_tokens ?? null,
          row.cache_tokens ?? null,
          row.ttfb ?? null,
        ]
      );
    }
  }

  await query(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
}

export function sqlitePrecheckMigration(dbPath: string): MigrationPrecheckResult {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/naming-convention
  const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
  const db = new BetterSqlite3(dbPath, { readonly: true });
  try {
    const queryScalar = (sql: string): number | null | undefined => {
      const row = db.prepare(sql).get() as { c?: number } | undefined;
      return row?.c;
    };
    const oldRowCount = sqliteCountLegacyRows(queryScalar);
    return {
      dbPath,
      oldRowCount,
    };
  } finally {
    db.close();
  }
}
