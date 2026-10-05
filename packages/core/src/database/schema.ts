/**
 * Request log table names and DDL for SQLite / Postgres.
 */

export const LEGACY_TABLE = "request_logs";
export const TABLE = "request_logs_v2";
export const MIGRATIONS_TABLE = "schema_migrations";
export const METRICS_TABLE = "request_metrics";
/** Historical provider model-alias wire ids. Rows stay until metrics are cleared. */
export const ALIAS_REGISTRY_TABLE = "model_alias_registry";

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
    service_handler TEXT,
    service_meta TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_tokens INTEGER,
    ttfb INTEGER,
    queue_wait_ms INTEGER,
    upstream_ttfb_ms INTEGER,
    gen_ms INTEGER,
    total_ms INTEGER,
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

/** Final-state v2 DDL (token columns redundant for per-log display; metrics table drives dashboard). */
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
    service_handler TEXT,
    service_meta TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_tokens INTEGER,
    ttfb INTEGER,
    queue_wait_ms INTEGER,
    upstream_ttfb_ms INTEGER,
    gen_ms INTEGER,
    total_ms INTEGER,
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
    queue_wait_ms INTEGER,
    upstream_ttfb_ms INTEGER,
    gen_ms INTEGER,
    total_ms INTEGER,
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

export const V2_TIMING_COLUMNS = [
  "queue_wait_ms",
  "upstream_ttfb_ms",
  "gen_ms",
  "total_ms",
] as const;

export const V2_SERVICE_COLUMNS = ["service_handler", "service_meta"] as const;

export const METRICS_TIMING_COLUMNS = [
  "queue_wait_ms",
  "upstream_ttfb_ms",
  "gen_ms",
  "total_ms",
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
    service_handler TEXT,
    service_meta TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_tokens INTEGER,
    ttfb INTEGER,
    queue_wait_ms INTEGER,
    upstream_ttfb_ms INTEGER,
    gen_ms INTEGER,
    total_ms INTEGER,
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
    service_handler TEXT,
    service_meta TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_tokens INTEGER,
    ttfb INTEGER,
    queue_wait_ms INTEGER,
    upstream_ttfb_ms INTEGER,
    gen_ms INTEGER,
    total_ms INTEGER,
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
    queue_wait_ms INTEGER,
    upstream_ttfb_ms INTEGER,
    gen_ms INTEGER,
    total_ms INTEGER,
    success INTEGER,
    status_code INTEGER
  )
`;

export const POSTGRES_INDEXES_METRICS = [
  `CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON ${METRICS_TABLE}(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_metrics_provider_id ON ${METRICS_TABLE}(provider_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_client_id ON ${METRICS_TABLE}(client_id)`,
] as const;

export const SQLITE_CREATE_TABLE_ALIAS_REGISTRY = `
  CREATE TABLE IF NOT EXISTS ${ALIAS_REGISTRY_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    upstream_model_id TEXT NOT NULL,
    protocol TEXT,
    display_name TEXT,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    UNIQUE (provider_id, alias, upstream_model_id)
  )
`;

export const POSTGRES_CREATE_TABLE_ALIAS_REGISTRY = `
  CREATE TABLE IF NOT EXISTS ${ALIAS_REGISTRY_TABLE} (
    id SERIAL PRIMARY KEY,
    provider_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    upstream_model_id TEXT NOT NULL,
    protocol TEXT,
    display_name TEXT,
    first_seen BIGINT NOT NULL,
    last_seen BIGINT NOT NULL,
    UNIQUE (provider_id, alias, upstream_model_id)
  )
`;

export const SQLITE_UPSERT_ALIAS_REGISTRY = `
  INSERT INTO ${ALIAS_REGISTRY_TABLE} (
    provider_id, alias, upstream_model_id, protocol, display_name, first_seen, last_seen
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(provider_id, alias, upstream_model_id) DO UPDATE SET
    first_seen = MIN(${ALIAS_REGISTRY_TABLE}.first_seen, excluded.first_seen),
    last_seen = MAX(${ALIAS_REGISTRY_TABLE}.last_seen, excluded.last_seen),
    protocol = COALESCE(excluded.protocol, ${ALIAS_REGISTRY_TABLE}.protocol),
    display_name = COALESCE(excluded.display_name, ${ALIAS_REGISTRY_TABLE}.display_name)
`;

export const POSTGRES_UPSERT_ALIAS_REGISTRY = `
  INSERT INTO ${ALIAS_REGISTRY_TABLE} (
    provider_id, alias, upstream_model_id, protocol, display_name, first_seen, last_seen
  ) VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (provider_id, alias, upstream_model_id) DO UPDATE SET
    first_seen = LEAST(${ALIAS_REGISTRY_TABLE}.first_seen, EXCLUDED.first_seen),
    last_seen = GREATEST(${ALIAS_REGISTRY_TABLE}.last_seen, EXCLUDED.last_seen),
    protocol = COALESCE(EXCLUDED.protocol, ${ALIAS_REGISTRY_TABLE}.protocol),
    display_name = COALESCE(EXCLUDED.display_name, ${ALIAS_REGISTRY_TABLE}.display_name)
`;
