/**
 * Request log table names and DDL for SQLite / Postgres.
 */

export const LEGACY_TABLE = "request_logs";
export const TABLE = "request_logs_v2";

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
    ttfb INTEGER
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
    ttfb INTEGER
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
