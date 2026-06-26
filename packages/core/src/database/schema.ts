/**
 * Request log table names and DDL for SQLite / Postgres.
 */

export const LEGACY_TABLE = "request_logs";
export const TABLE = "request_logs_v2";
export const MIGRATIONS_TABLE = "schema_migrations";
export const METRICS_TABLE = "request_metrics";

/** v1 baseline: request_logs_v2 with token columns (frozen for migration v1). */
export const SQLITE_CREATE_TABLE_V2 = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    target_url TEXT,
    request_body BLOB,
    response_body BLOB,
    original_request_body BLOB,
    original_response_body BLOB,
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
    ttfb INTEGER,
    request_headers TEXT,
    response_headers TEXT
  )
`;

export const SQLITE_INDEXES_V2 = [
  `CREATE INDEX IF NOT EXISTS idx_v2_timestamp ON ${TABLE}(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_provider_id ON ${TABLE}(provider_id)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_path ON ${TABLE}(path)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_success ON ${TABLE}(success)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_client_id ON ${TABLE}(client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_status ON ${TABLE}(status)`,
] as const;

/** Final-state v2 DDL (no token columns) for new databases after migration v2. */
export const SQLITE_CREATE_TABLE_V2_FINAL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    target_url TEXT,
    request_body BLOB,
    response_body BLOB,
    original_request_body BLOB,
    original_response_body BLOB,
    status_code INTEGER,
    duration INTEGER NOT NULL,
    success INTEGER NOT NULL,
    error_message TEXT,
    client_id TEXT,
    status TEXT DEFAULT 'completed',
    route_type TEXT,
    request_headers TEXT,
    response_headers TEXT
  )
`;

export const SQLITE_CREATE_SCHEMA_MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )
`;

export const SQLITE_CREATE_TABLE_METRICS = `
  CREATE TABLE IF NOT EXISTS ${METRICS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    model TEXT,
    client_id TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_tokens INTEGER,
    ttfb INTEGER,
    duration INTEGER,
    success INTEGER,
    status_code INTEGER
  )
`;

export const SQLITE_INDEXES_METRICS = [
  `CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON ${METRICS_TABLE}(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_metrics_provider_id ON ${METRICS_TABLE}(provider_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_client_id ON ${METRICS_TABLE}(client_id)`,
] as const;

export const V2_TOKEN_COLUMNS = ["input_tokens", "output_tokens", "cache_tokens", "ttfb"] as const;

export const POSTGRES_CREATE_TABLE_V2 = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id SERIAL PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    target_url TEXT,
    request_body BYTEA,
    response_body BYTEA,
    original_request_body BYTEA,
    original_response_body BYTEA,
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
    ttfb INTEGER,
    request_headers TEXT,
    response_headers TEXT
  )
`;

export const POSTGRES_INDEXES_V2 = [
  `CREATE INDEX IF NOT EXISTS idx_v2_timestamp ON ${TABLE}(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_provider_id ON ${TABLE}(provider_id)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_path ON ${TABLE}(path)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_success ON ${TABLE}(success)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_client_id ON ${TABLE}(client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_status ON ${TABLE}(status)`,
] as const;

export const POSTGRES_CREATE_TABLE_V2_FINAL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id SERIAL PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    target_url TEXT,
    request_body BYTEA,
    response_body BYTEA,
    original_request_body BYTEA,
    original_response_body BYTEA,
    status_code INTEGER,
    duration INTEGER NOT NULL,
    success INTEGER NOT NULL,
    error_message TEXT,
    client_id TEXT,
    status TEXT DEFAULT 'completed',
    route_type TEXT,
    request_headers TEXT,
    response_headers TEXT
  )
`;

export const POSTGRES_CREATE_SCHEMA_MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at BIGINT NOT NULL
  )
`;

export const POSTGRES_CREATE_TABLE_METRICS = `
  CREATE TABLE IF NOT EXISTS ${METRICS_TABLE} (
    id SERIAL PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    model TEXT,
    client_id TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_tokens INTEGER,
    ttfb INTEGER,
    duration INTEGER,
    success INTEGER,
    status_code INTEGER
  )
`;

export const POSTGRES_INDEXES_METRICS = [
  `CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON ${METRICS_TABLE}(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_metrics_provider_id ON ${METRICS_TABLE}(provider_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_client_id ON ${METRICS_TABLE}(client_id)`,
] as const;
