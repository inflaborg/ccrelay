/**
 * Versioned database migrations for request logs and metrics tables.
 */

import {
  LEGACY_TABLE,
  TABLE,
  MIGRATIONS_TABLE,
  METRICS_TABLE,
  SQLITE_CREATE_TABLE_V2,
  SQLITE_INDEXES_V2,
  SQLITE_CREATE_SCHEMA_MIGRATIONS,
  SQLITE_CREATE_TABLE_METRICS,
  SQLITE_INDEXES_METRICS,
  V2_TOKEN_COLUMNS,
  V2_TIMING_COLUMNS,
  METRICS_TIMING_COLUMNS,
  POSTGRES_CREATE_TABLE_V2,
  POSTGRES_INDEXES_V2,
  POSTGRES_CREATE_SCHEMA_MIGRATIONS,
  POSTGRES_CREATE_TABLE_METRICS,
  POSTGRES_INDEXES_METRICS,
} from "./schema";
import { decodeFromStorage, utf8StringToBlob } from "./shared-utils";
import type { LogDbMigrationChoice } from "./types";
import { Logger } from "../utils/logger";

const migrationLog = Logger.getInstance();

function logMigration(message: string): void {
  migrationLog.info(`[LogMigration] ${message}`);
}

export interface MigrationPrecheckResult {
  dbPath: string;
  oldRowCount: number;
}

export interface SqliteMigrationContext {
  queryScalar: (sql: string) => number | null | undefined;
  queryAll: (sql: string) => Array<Record<string, unknown>>;
  exec: (sql: string) => void;
  runInsertV2: (params: unknown[]) => void;
  migrationChoice: LogDbMigrationChoice;
  /** Optional path label for log messages */
  dbPath?: string;
}

export interface PostgresMigrationContext {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
  migrationChoice: LogDbMigrationChoice;
  /** Optional connection label for log messages */
  dbLabel?: string;
}

// --- Legacy v1 helpers (frozen) ------------------------------------------------

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

function sqliteDropLegacy(exec: (sql: string) => void): void {
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

function sqliteMigrateLegacyToV2(
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

function runMigrationV1BaselineSqlite(ctx: SqliteMigrationContext): void {
  ctx.exec(SQLITE_CREATE_TABLE_V2);
  for (const sql of SQLITE_INDEXES_V2) {
    ctx.exec(sql);
  }
  const oldRowCount = sqliteCountLegacyRows(ctx.queryScalar);
  if (oldRowCount === 0) {
    sqliteDropLegacy(ctx.exec);
    return;
  }
  if (ctx.migrationChoice === "migrate") {
    sqliteMigrateLegacyToV2(ctx.queryAll, row => {
      ctx.runInsertV2([
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
  sqliteDropLegacy(ctx.exec);
}

async function runMigrationV1BaselinePostgres(ctx: PostgresMigrationContext): Promise<void> {
  await ctx.query(POSTGRES_CREATE_TABLE_V2);
  for (const sql of POSTGRES_INDEXES_V2) {
    await ctx.query(sql);
  }

  const existsRes = (await ctx.query(
    `SELECT COUNT(*)::int as c FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [LEGACY_TABLE]
  )) as { rows: Array<{ c: number }> };
  if ((existsRes.rows[0]?.c ?? 0) === 0) {
    return;
  }

  const countRes = (await ctx.query(`SELECT COUNT(*)::int as c FROM ${LEGACY_TABLE}`)) as {
    rows: Array<{ c: number }>;
  };
  const oldRowCount = countRes.rows[0]?.c ?? 0;
  if (oldRowCount === 0) {
    await ctx.query(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
    return;
  }

  if (ctx.migrationChoice === "migrate") {
    const legacy = (await ctx.query(`SELECT * FROM ${LEGACY_TABLE}`)) as {
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
      await ctx.query(
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

  await ctx.query(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
}

function sqliteTableExists(
  queryScalar: (sql: string) => number | null | undefined,
  tableName: string
): boolean {
  const count =
    queryScalar(
      `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='${tableName}'`
    ) ?? 0;
  return count > 0;
}

function sqliteColumnExists(
  queryScalar: (sql: string) => number | null | undefined,
  tableName: string,
  columnName: string
): boolean {
  const count =
    queryScalar(
      `SELECT COUNT(*) as c FROM pragma_table_info('${tableName}') WHERE name='${columnName}'`
    ) ?? 0;
  return count > 0;
}

function runMigrationV2SplitMetricsSqlite(ctx: SqliteMigrationContext): string[] {
  ctx.exec(SQLITE_CREATE_TABLE_METRICS);
  for (const sql of SQLITE_INDEXES_METRICS) {
    ctx.exec(sql);
  }

  ctx.exec(`INSERT INTO ${METRICS_TABLE} (
    timestamp, provider_id, provider_name, model, client_id,
    input_tokens, output_tokens, cache_tokens, ttfb, duration, success, status_code
  )
  SELECT timestamp, provider_id, provider_name, NULL, client_id,
         input_tokens, output_tokens, cache_tokens, ttfb, duration, success, status_code
  FROM ${TABLE}
  WHERE status = 'completed'`);

  const dropped: string[] = [];
  for (const col of V2_TOKEN_COLUMNS) {
    if (sqliteColumnExists(ctx.queryScalar, TABLE, col)) {
      ctx.exec(`ALTER TABLE ${TABLE} DROP COLUMN ${col}`);
      dropped.push(col);
    }
  }
  return dropped;
}

async function runMigrationV2SplitMetricsPostgres(ctx: PostgresMigrationContext): Promise<void> {
  await ctx.query(POSTGRES_CREATE_TABLE_METRICS);
  for (const sql of POSTGRES_INDEXES_METRICS) {
    await ctx.query(sql);
  }

  await ctx.query(`INSERT INTO ${METRICS_TABLE} (
    timestamp, provider_id, provider_name, model, client_id,
    input_tokens, output_tokens, cache_tokens, ttfb, duration, success, status_code
  )
  SELECT timestamp, provider_id, provider_name, NULL, client_id,
         input_tokens, output_tokens, cache_tokens, ttfb, duration, success, status_code
  FROM ${TABLE}
  WHERE status = 'completed'`);

  for (const col of V2_TOKEN_COLUMNS) {
    await ctx.query(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS ${col}`);
  }
}

function runMigrationV4LogTokenRedundancySqlite(ctx: SqliteMigrationContext): void {
  for (const col of V2_TOKEN_COLUMNS) {
    if (!sqliteColumnExists(ctx.queryScalar, TABLE, col)) {
      ctx.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${col} INTEGER`);
    }
  }
}

async function runMigrationV4LogTokenRedundancySqliteAsync(ctx: {
  exec: (sql: string) => void | Promise<void>;
  queryScalar: (sql: string) => number | null | undefined | Promise<number | null | undefined>;
}): Promise<void> {
  for (const col of V2_TOKEN_COLUMNS) {
    const exists =
      (await Promise.resolve(
        ctx.queryScalar(
          `SELECT COUNT(*) as c FROM pragma_table_info('${TABLE}') WHERE name='${col}'`
        )
      )) ?? 0;
    if (exists === 0) {
      await ctx.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${col} INTEGER`);
    }
  }
}

async function runMigrationV4LogTokenRedundancyPostgres(
  query: (sql: string, params?: unknown[]) => Promise<unknown>
): Promise<void> {
  for (const col of V2_TOKEN_COLUMNS) {
    await query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS ${col} INTEGER`);
  }
}

function runMigrationV5TimingPhasesSqlite(ctx: SqliteMigrationContext): void {
  for (const col of V2_TIMING_COLUMNS) {
    if (!sqliteColumnExists(ctx.queryScalar, TABLE, col)) {
      ctx.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${col} INTEGER`);
    }
  }
  for (const col of METRICS_TIMING_COLUMNS) {
    if (!sqliteColumnExists(ctx.queryScalar, METRICS_TABLE, col)) {
      ctx.exec(`ALTER TABLE ${METRICS_TABLE} ADD COLUMN ${col} INTEGER`);
    }
  }
}

async function runMigrationV5TimingPhasesSqliteAsync(ctx: {
  exec: (sql: string) => void | Promise<void>;
  queryScalar: (sql: string) => number | null | undefined | Promise<number | null | undefined>;
}): Promise<void> {
  for (const col of V2_TIMING_COLUMNS) {
    const exists =
      (await Promise.resolve(
        ctx.queryScalar(
          `SELECT COUNT(*) as c FROM pragma_table_info('${TABLE}') WHERE name='${col}'`
        )
      )) ?? 0;
    if (exists === 0) {
      await ctx.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${col} INTEGER`);
    }
  }
  for (const col of METRICS_TIMING_COLUMNS) {
    const exists =
      (await Promise.resolve(
        ctx.queryScalar(
          `SELECT COUNT(*) as c FROM pragma_table_info('${METRICS_TABLE}') WHERE name='${col}'`
        )
      )) ?? 0;
    if (exists === 0) {
      await ctx.exec(`ALTER TABLE ${METRICS_TABLE} ADD COLUMN ${col} INTEGER`);
    }
  }
}

async function runMigrationV5TimingPhasesPostgres(
  query: (sql: string, params?: unknown[]) => Promise<unknown>
): Promise<void> {
  for (const col of V2_TIMING_COLUMNS) {
    await query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS ${col} INTEGER`);
  }
  for (const col of METRICS_TIMING_COLUMNS) {
    await query(`ALTER TABLE ${METRICS_TABLE} ADD COLUMN IF NOT EXISTS ${col} INTEGER`);
  }
}

function sqliteRecordMigration(exec: (sql: string) => void, version: number, name: string): void {
  exec(
    `INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (${version}, '${name}', ${Date.now()})`
  );
}

function sqliteMaxAppliedVersion(queryScalar: (sql: string) => number | null | undefined): number {
  if (!sqliteTableExists(queryScalar, MIGRATIONS_TABLE)) {
    return 0;
  }
  return queryScalar(`SELECT COALESCE(MAX(version), 0) as c FROM ${MIGRATIONS_TABLE}`) ?? 0;
}

async function runMigrationV1BaselineSqliteAsync(ctx: SqliteMigrationAsyncContext): Promise<void> {
  await ctx.exec(SQLITE_CREATE_TABLE_V2);
  for (const sql of SQLITE_INDEXES_V2) {
    await ctx.exec(sql);
  }
  const legacyCount =
    (await Promise.resolve(
      ctx.queryScalar(
        `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='${LEGACY_TABLE}'`
      )
    )) ?? 0;
  if (legacyCount === 0) {
    await ctx.exec(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
    return;
  }
  const rowCount =
    (await Promise.resolve(ctx.queryScalar(`SELECT COUNT(*) as c FROM ${LEGACY_TABLE}`))) ?? 0;
  if (rowCount === 0) {
    await ctx.exec(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
    return;
  }
  if (ctx.migrationChoice === "migrate") {
    const rows = await Promise.resolve(ctx.queryAll(`SELECT * FROM ${LEGACY_TABLE}`));
    for (const row of rows) {
      await Promise.resolve(
        ctx.runInsertV2([
          row.timestamp,
          row.provider_id,
          row.provider_name,
          row.method,
          row.path,
          row.target_url ?? null,
          legacyTextToBlob(row.request_body),
          legacyTextToBlob(row.response_body),
          legacyTextToBlob(row.original_request_body),
          legacyTextToBlob(row.original_response_body),
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
        ])
      );
    }
  }
  await ctx.exec(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
}

async function runMigrationV2SplitMetricsSqliteAsync(ctx: {
  exec: (sql: string) => void | Promise<void>;
  queryScalar: (sql: string) => number | null | undefined | Promise<number | null | undefined>;
}): Promise<string[]> {
  await ctx.exec(SQLITE_CREATE_TABLE_METRICS);
  for (const sql of SQLITE_INDEXES_METRICS) {
    await ctx.exec(sql);
  }
  await ctx.exec(`INSERT INTO ${METRICS_TABLE} (
    timestamp, provider_id, provider_name, model, client_id,
    input_tokens, output_tokens, cache_tokens, ttfb, duration, success, status_code
  )
  SELECT timestamp, provider_id, provider_name, NULL, client_id,
         input_tokens, output_tokens, cache_tokens, ttfb, duration, success, status_code
  FROM ${TABLE}
  WHERE status = 'completed'`);
  const dropped: string[] = [];
  for (const col of V2_TOKEN_COLUMNS) {
    const exists =
      (await Promise.resolve(
        ctx.queryScalar(
          `SELECT COUNT(*) as c FROM pragma_table_info('${TABLE}') WHERE name='${col}'`
        )
      )) ?? 0;
    if (exists > 0) {
      await ctx.exec(`ALTER TABLE ${TABLE} DROP COLUMN ${col}`);
      dropped.push(col);
    }
  }
  return dropped;
}

function migrationDbSuffix(dbPath?: string, dbLabel?: string): string {
  const label = dbPath ?? dbLabel;
  return label ? ` (${label})` : "";
}

/** Run all pending SQLite migrations (v1 baseline + v2 split metrics). */
export function runSqliteMigrations(ctx: SqliteMigrationContext): void {
  const suffix = migrationDbSuffix(ctx.dbPath);
  ctx.exec(SQLITE_CREATE_SCHEMA_MIGRATIONS);

  let maxVersion = sqliteMaxAppliedVersion(ctx.queryScalar);
  logMigration(`Checking migrations${suffix}, current version=${maxVersion}`);

  let applied = false;

  if (maxVersion === 0 && sqliteTableExists(ctx.queryScalar, TABLE)) {
    sqliteRecordMigration(ctx.exec, 1, "baseline_v2");
    maxVersion = 1;
    logMigration(
      `Existing ${TABLE} detected; recorded v1 baseline_v2 without data migration${suffix}`
    );
    applied = true;
  }

  if (maxVersion < 1) {
    const legacyRows = sqliteCountLegacyRows(ctx.queryScalar);
    logMigration(
      `Applying v1 baseline_v2 (legacy rows=${legacyRows}, choice=${ctx.migrationChoice})${suffix}`
    );
    runMigrationV1BaselineSqlite(ctx);
    sqliteRecordMigration(ctx.exec, 1, "baseline_v2");
    maxVersion = 1;
    logMigration(`v1 baseline_v2 applied${suffix}`);
    applied = true;
  }

  if (maxVersion < 2) {
    const backfillCandidates =
      ctx.queryScalar(`SELECT COUNT(*) as c FROM ${TABLE} WHERE status = 'completed'`) ?? 0;
    logMigration(
      `Applying v2 split_metrics (completed rows to backfill=${backfillCandidates})${suffix}`
    );
    const dropped = runMigrationV2SplitMetricsSqlite(ctx);
    sqliteRecordMigration(ctx.exec, 2, "split_metrics");
    if (dropped.length > 0) {
      logMigration(`Dropped token columns from ${TABLE}: ${dropped.join(", ")}${suffix}`);
    } else {
      logMigration(`Token columns already absent on ${TABLE}${suffix}`);
    }
    logMigration(`v2 split_metrics applied${suffix}`);
    applied = true;
  }

  if (maxVersion < 3) {
    logMigration(`Applying v3 add_headers${suffix}`);
    if (!sqliteColumnExists(ctx.queryScalar, TABLE, "request_headers")) {
      ctx.exec(`ALTER TABLE ${TABLE} ADD COLUMN request_headers TEXT`);
    }
    if (!sqliteColumnExists(ctx.queryScalar, TABLE, "response_headers")) {
      ctx.exec(`ALTER TABLE ${TABLE} ADD COLUMN response_headers TEXT`);
    }
    sqliteRecordMigration(ctx.exec, 3, "add_headers");
    logMigration(`v3 add_headers applied${suffix}`);
    applied = true;
  }

  if (maxVersion < 4) {
    logMigration(`Applying v4 log_token_redundancy${suffix}`);
    runMigrationV4LogTokenRedundancySqlite(ctx);
    sqliteRecordMigration(ctx.exec, 4, "log_token_redundancy");
    logMigration(`v4 log_token_redundancy applied${suffix}`);
    applied = true;
  }

  if (maxVersion < 5) {
    logMigration(`Applying v5 timing_phases${suffix}`);
    runMigrationV5TimingPhasesSqlite(ctx);
    sqliteRecordMigration(ctx.exec, 5, "timing_phases");
    logMigration(`v5 timing_phases applied${suffix}`);
    applied = true;
  }

  if (!applied) {
    logMigration(`Schema up to date (version ${maxVersion})${suffix}`);
  } else {
    const finalVersion = sqliteMaxAppliedVersion(ctx.queryScalar);
    logMigration(`Migrations complete, version=${finalVersion}${suffix}`);
  }
}

export interface SqliteMigrationAsyncContext {
  queryScalar: (sql: string) => Promise<number | null | undefined>;
  queryAll: (sql: string) => Promise<Array<Record<string, unknown>>>;
  exec: (sql: string) => Promise<void>;
  runInsertV2: (params: unknown[]) => Promise<void>;
  migrationChoice: LogDbMigrationChoice;
  dbPath?: string;
}

/** Async variant for SqliteCliDriver (IPC exec). */
export async function runSqliteMigrationsAsync(ctx: SqliteMigrationAsyncContext): Promise<void> {
  const suffix = migrationDbSuffix(ctx.dbPath);
  await ctx.exec(SQLITE_CREATE_SCHEMA_MIGRATIONS);

  const tableExists = async (name: string): Promise<boolean> =>
    ((await ctx.queryScalar(
      `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='${name}'`
    )) ?? 0) > 0;

  let maxVersion = (await tableExists(MIGRATIONS_TABLE))
    ? ((await ctx.queryScalar(`SELECT COALESCE(MAX(version), 0) as c FROM ${MIGRATIONS_TABLE}`)) ??
      0)
    : 0;

  logMigration(`Checking migrations${suffix}, current version=${maxVersion}`);

  let applied = false;

  if (maxVersion === 0 && (await tableExists(TABLE))) {
    await ctx.exec(
      `INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (1, 'baseline_v2', ${Date.now()})`
    );
    maxVersion = 1;
    logMigration(
      `Existing ${TABLE} detected; recorded v1 baseline_v2 without data migration${suffix}`
    );
    applied = true;
  }

  if (maxVersion < 1) {
    const legacyExists = await tableExists(LEGACY_TABLE);
    const legacyRows = legacyExists
      ? ((await ctx.queryScalar(`SELECT COUNT(*) as c FROM ${LEGACY_TABLE}`)) ?? 0)
      : 0;
    logMigration(
      `Applying v1 baseline_v2 (legacy rows=${legacyRows}, choice=${ctx.migrationChoice})${suffix}`
    );
    await runMigrationV1BaselineSqliteAsync(ctx);
    await ctx.exec(
      `INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (1, 'baseline_v2', ${Date.now()})`
    );
    maxVersion = 1;
    logMigration(`v1 baseline_v2 applied${suffix}`);
    applied = true;
  }

  if (maxVersion < 2) {
    const backfillCandidates =
      (await ctx.queryScalar(`SELECT COUNT(*) as c FROM ${TABLE} WHERE status = 'completed'`)) ?? 0;
    logMigration(
      `Applying v2 split_metrics (completed rows to backfill=${backfillCandidates})${suffix}`
    );
    const dropped = await runMigrationV2SplitMetricsSqliteAsync(ctx);
    await ctx.exec(
      `INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (2, 'split_metrics', ${Date.now()})`
    );
    if (dropped.length > 0) {
      logMigration(`Dropped token columns from ${TABLE}: ${dropped.join(", ")}${suffix}`);
    } else {
      logMigration(`Token columns already absent on ${TABLE}${suffix}`);
    }
    logMigration(`v2 split_metrics applied${suffix}`);
    applied = true;
  }

  if (maxVersion < 3) {
    logMigration(`Applying v3 add_headers${suffix}`);
    const headerColExists = async (col: string): Promise<boolean> =>
      ((await ctx.queryScalar(
        `SELECT COUNT(*) as c FROM pragma_table_info('${TABLE}') WHERE name='${col}'`
      )) ?? 0) > 0;
    if (!(await headerColExists("request_headers"))) {
      await ctx.exec(`ALTER TABLE ${TABLE} ADD COLUMN request_headers TEXT`);
    }
    if (!(await headerColExists("response_headers"))) {
      await ctx.exec(`ALTER TABLE ${TABLE} ADD COLUMN response_headers TEXT`);
    }
    await ctx.exec(
      `INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (3, 'add_headers', ${Date.now()})`
    );
    logMigration(`v3 add_headers applied${suffix}`);
    applied = true;
  }

  if (maxVersion < 4) {
    logMigration(`Applying v4 log_token_redundancy${suffix}`);
    await runMigrationV4LogTokenRedundancySqliteAsync(ctx);
    await ctx.exec(
      `INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (4, 'log_token_redundancy', ${Date.now()})`
    );
    logMigration(`v4 log_token_redundancy applied${suffix}`);
    applied = true;
  }

  if (maxVersion < 5) {
    logMigration(`Applying v5 timing_phases${suffix}`);
    await runMigrationV5TimingPhasesSqliteAsync(ctx);
    await ctx.exec(
      `INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (5, 'timing_phases', ${Date.now()})`
    );
    logMigration(`v5 timing_phases applied${suffix}`);
    applied = true;
  }

  if (!applied) {
    logMigration(`Schema up to date (version ${maxVersion})${suffix}`);
  } else {
    const finalVersion =
      (await ctx.queryScalar(`SELECT COALESCE(MAX(version), 0) as c FROM ${MIGRATIONS_TABLE}`)) ??
      maxVersion;
    logMigration(`Migrations complete, version=${finalVersion}${suffix}`);
  }
}

async function postgresMaxAppliedVersion(
  query: (sql: string, params?: unknown[]) => Promise<unknown>
): Promise<number> {
  const tableExists = (await query(
    `SELECT COUNT(*)::int as c FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [MIGRATIONS_TABLE]
  )) as { rows: Array<{ c: number }> };
  if ((tableExists.rows[0]?.c ?? 0) === 0) {
    return 0;
  }
  const res = (await query(
    `SELECT COALESCE(MAX(version), 0)::int as c FROM ${MIGRATIONS_TABLE}`
  )) as {
    rows: Array<{ c: number }>;
  };
  return res.rows[0]?.c ?? 0;
}

async function postgresTableExists(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  tableName: string
): Promise<boolean> {
  const res = (await query(
    `SELECT COUNT(*)::int as c FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  )) as { rows: Array<{ c: number }> };
  return (res.rows[0]?.c ?? 0) > 0;
}

async function postgresRecordMigration(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  version: number,
  name: string
): Promise<void> {
  await query(
    `INSERT INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES ($1, $2, $3)
     ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name, applied_at = EXCLUDED.applied_at`,
    [version, name, Date.now()]
  );
}

/** Run all pending Postgres migrations. */
export async function runPostgresMigrations(ctx: PostgresMigrationContext): Promise<void> {
  const suffix = migrationDbSuffix(undefined, ctx.dbLabel);
  await ctx.query(POSTGRES_CREATE_SCHEMA_MIGRATIONS);

  let maxVersion = await postgresMaxAppliedVersion(ctx.query);
  logMigration(`Checking migrations${suffix}, current version=${maxVersion}`);

  let applied = false;

  if (maxVersion === 0 && (await postgresTableExists(ctx.query, TABLE))) {
    await postgresRecordMigration(ctx.query, 1, "baseline_v2");
    maxVersion = 1;
    logMigration(
      `Existing ${TABLE} detected; recorded v1 baseline_v2 without data migration${suffix}`
    );
    applied = true;
  }

  if (maxVersion < 1) {
    const existsRes = (await ctx.query(
      `SELECT COUNT(*)::int as c FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [LEGACY_TABLE]
    )) as { rows: Array<{ c: number }> };
    let legacyRows = 0;
    if ((existsRes.rows[0]?.c ?? 0) > 0) {
      const countRes = (await ctx.query(`SELECT COUNT(*)::int as c FROM ${LEGACY_TABLE}`)) as {
        rows: Array<{ c: number }>;
      };
      legacyRows = countRes.rows[0]?.c ?? 0;
    }
    logMigration(
      `Applying v1 baseline_v2 (legacy rows=${legacyRows}, choice=${ctx.migrationChoice})${suffix}`
    );
    await runMigrationV1BaselinePostgres(ctx);
    await postgresRecordMigration(ctx.query, 1, "baseline_v2");
    maxVersion = 1;
    logMigration(`v1 baseline_v2 applied${suffix}`);
    applied = true;
  }

  if (maxVersion < 2) {
    const countRes = (await ctx.query(
      `SELECT COUNT(*)::int as c FROM ${TABLE} WHERE status = 'completed'`
    )) as { rows: Array<{ c: number }> };
    const backfillCandidates = countRes.rows[0]?.c ?? 0;
    logMigration(
      `Applying v2 split_metrics (completed rows to backfill=${backfillCandidates})${suffix}`
    );
    await runMigrationV2SplitMetricsPostgres(ctx);
    await postgresRecordMigration(ctx.query, 2, "split_metrics");
    logMigration(`v2 split_metrics applied (dropped token columns from ${TABLE})${suffix}`);
    applied = true;
  }

  if (maxVersion < 3) {
    logMigration(`Applying v3 add_headers${suffix}`);
    const headerColExists = async (col: string): Promise<boolean> => {
      const res = (await ctx.query(
        `SELECT COUNT(*)::int as c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [TABLE, col]
      )) as { rows: Array<{ c: number }> };
      return (res.rows[0]?.c ?? 0) > 0;
    };
    if (!(await headerColExists("request_headers"))) {
      await ctx.query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS request_headers TEXT`);
    }
    if (!(await headerColExists("response_headers"))) {
      await ctx.query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS response_headers TEXT`);
    }
    await postgresRecordMigration(ctx.query, 3, "add_headers");
    logMigration(`v3 add_headers applied${suffix}`);
    applied = true;
  }

  if (maxVersion < 4) {
    logMigration(`Applying v4 log_token_redundancy${suffix}`);
    await runMigrationV4LogTokenRedundancyPostgres(ctx.query);
    await postgresRecordMigration(ctx.query, 4, "log_token_redundancy");
    logMigration(`v4 log_token_redundancy applied${suffix}`);
    applied = true;
  }

  if (maxVersion < 5) {
    logMigration(`Applying v5 timing_phases${suffix}`);
    await runMigrationV5TimingPhasesPostgres(ctx.query);
    await postgresRecordMigration(ctx.query, 5, "timing_phases");
    logMigration(`v5 timing_phases applied${suffix}`);
    applied = true;
  }

  if (!applied) {
    logMigration(`Schema up to date (version ${maxVersion})${suffix}`);
  } else {
    const finalVersion = await postgresMaxAppliedVersion(ctx.query);
    logMigration(`Migrations complete, version=${finalVersion}${suffix}`);
  }
}

// --- Backward-compatible aliases used by drivers during transition ----------------

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

export function runSqliteStartupMigration(
  dbPath: string,
  queryScalar: (sql: string) => number | null | undefined,
  queryAll: (sql: string) => Array<Record<string, unknown>>,
  exec: (sql: string) => void,
  runInsert: (params: unknown[]) => void,
  choice: LogDbMigrationChoice
): void {
  runSqliteMigrations({
    queryScalar,
    queryAll,
    exec,
    runInsertV2: runInsert,
    migrationChoice: choice,
    dbPath,
  });
}

export async function runPostgresStartupMigration(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  choice: LogDbMigrationChoice
): Promise<void> {
  await runPostgresMigrations({ query, migrationChoice: choice });
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
