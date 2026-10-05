/**
 * Historical provider model-alias bindings.
 * Catalog refreshes append rows. They are removed only when metrics are cleared.
 */

import { looksLikeAliasWireId, looksLikeLegacyAliasPattern } from "../shared/aliasHash";
import { ALIAS_REGISTRY_TABLE, TABLE } from "./schema";
import {
  LIST_LOG_MODEL_BODY_HEAD_BYTES,
  LIST_LOG_MODEL_BODY_TAIL_BYTES,
  extractModelsFromBodies,
} from "./shared-utils";
import type { ModelAliasRecord, ModelAliasUpsert, ProviderModelStatRow, RequestLog } from "./types";

export interface AliasCatalogSource {
  providerId: string;
  aliasHash: string;
  legacyAlias?: string;
  upstreamModelId: string;
  protocol?: string;
  displayName?: string;
}

const BACKFILL_BATCH = 200;

export function isHistoricalModelAlias(model: string, aliasPrefix = "claude-"): boolean {
  return (
    looksLikeAliasWireId(model, aliasPrefix) || looksLikeLegacyAliasPattern(model, aliasPrefix)
  );
}

export function catalogSourcesToAliasUpserts(
  entries: AliasCatalogSource[],
  seenAt: number
): ModelAliasUpsert[] {
  const grouped = new Map<string, ModelAliasUpsert>();
  for (const entry of entries) {
    const candidates = [entry.aliasHash, entry.legacyAlias];
    for (const alias of candidates) {
      if (
        !alias ||
        alias === entry.upstreamModelId ||
        !entry.providerId ||
        !entry.upstreamModelId
      ) {
        continue;
      }
      const key = `${entry.providerId}\0${alias}\0${entry.upstreamModelId}`;
      const existing = grouped.get(key);
      if (existing) {
        if (!existing.displayName && entry.displayName) {
          existing.displayName = entry.displayName;
        }
        if (!existing.protocol && entry.protocol) {
          existing.protocol = entry.protocol;
        }
        continue;
      }
      grouped.set(key, {
        providerId: entry.providerId,
        alias,
        upstreamModelId: entry.upstreamModelId,
        ...(entry.protocol ? { protocol: entry.protocol } : {}),
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
        firstSeen: seenAt,
        lastSeen: seenAt,
      });
    }
  }
  return [...grouped.values()];
}

/**
 * Alias that was already in use at `timestamp`.
 * A single later recording still applies, because a canonical hash does not change
 * for the same provider, protocol, and upstream id.
 */
export function resolveAliasUpstream(
  records: ModelAliasRecord[],
  providerId: string,
  alias: string,
  timestamp: number
): string | undefined {
  const matches = records.filter(row => row.providerId === providerId && row.alias === alias);
  if (matches.length === 0) {
    return undefined;
  }
  const started = matches.filter(row => row.firstSeen <= timestamp);
  if (started.length > 0) {
    started.sort((a, b) => b.firstSeen - a.firstSeen);
    return started[0]?.upstreamModelId;
  }
  if (matches.length === 1) {
    return matches[0]?.upstreamModelId;
  }
  return undefined;
}

export function applyAliasRegistryToLog(log: RequestLog, records: ModelAliasRecord[]): RequestLog {
  if (!log.model || !log.providerId || records.length === 0) {
    return log;
  }
  if (log.mappedModel && log.mappedModel !== log.model) {
    return log;
  }
  const upstream = resolveAliasUpstream(records, log.providerId, log.model, log.timestamp);
  if (!upstream || upstream === log.model) {
    return log;
  }
  return { ...log, mappedModel: upstream };
}

/** Label a stats bucket without changing which rows were grouped together. */
export function labelAliasedStatModel(
  providerId: string,
  model: string,
  records: ModelAliasRecord[]
): string {
  const matches = records.filter(row => row.providerId === providerId && row.alias === model);
  if (matches.length === 0) {
    return model;
  }
  const latest = matches.reduce((best, row) => (row.lastSeen >= best.lastSeen ? row : best));
  if (!latest.upstreamModelId || latest.upstreamModelId === model) {
    return model;
  }
  return `${model} → ${latest.upstreamModelId}`;
}

export function labelProviderModelStats(
  providerId: string,
  rows: ProviderModelStatRow[],
  records: ModelAliasRecord[]
): ProviderModelStatRow[] {
  if (records.length === 0) {
    return rows;
  }
  return rows.map(row => ({
    ...row,
    model: labelAliasedStatModel(providerId, row.model, records),
  }));
}

function textColumn(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function mapAliasRegistryRow(row: Record<string, unknown>): ModelAliasRecord {
  const protocol = typeof row.protocol === "string" && row.protocol ? row.protocol : undefined;
  const displayName =
    typeof row.display_name === "string" && row.display_name ? row.display_name : undefined;
  return {
    providerId: textColumn(row.provider_id),
    alias: textColumn(row.alias),
    upstreamModelId: textColumn(row.upstream_model_id),
    ...(protocol ? { protocol } : {}),
    ...(displayName ? { displayName } : {}),
    firstSeen: Number(row.first_seen ?? 0),
    lastSeen: Number(row.last_seen ?? 0),
  };
}

function bodyPreviewText(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return value.length > 0 ? Buffer.from(value).toString("utf-8") : undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    const decoded = Buffer.from(value, "hex").toString("utf-8");
    if (decoded.includes('"model"') || decoded.includes("{")) {
      return decoded;
    }
  }
  return value;
}

/** Pull alias → upstream pairs out of stored request bodies (one-time migration backfill). */
export function collectAliasUpsertsFromLogRows(
  rows: Array<Record<string, unknown>>
): ModelAliasUpsert[] {
  const grouped = new Map<string, ModelAliasUpsert>();
  for (const row of rows) {
    const providerId = typeof row.provider_id === "string" ? row.provider_id : "";
    const timestamp = Number(row.timestamp ?? 0);
    if (!providerId || !Number.isFinite(timestamp)) {
      continue;
    }
    /* eslint-disable @typescript-eslint/naming-convention -- DB column wire names */
    const models = extractModelsFromBodies({
      original_request_body: bodyPreviewText(row.original_request_body),
      original_request_body_tail: bodyPreviewText(row.original_request_body_tail),
      request_body: bodyPreviewText(row.request_body),
      request_body_tail: bodyPreviewText(row.request_body_tail),
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    const alias = models.model;
    const upstream = models.mappedModel;
    if (!alias || !upstream || alias === upstream || !isHistoricalModelAlias(alias)) {
      continue;
    }
    const key = `${providerId}\0${alias}\0${upstream}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        providerId,
        alias,
        upstreamModelId: upstream,
        firstSeen: timestamp,
        lastSeen: timestamp,
      });
      continue;
    }
    existing.firstSeen = Math.min(existing.firstSeen, timestamp);
    existing.lastSeen = Math.max(existing.lastSeen, timestamp);
  }
  return [...grouped.values()];
}

export function sqliteAliasBackfillSelect(afterId: number, limit = BACKFILL_BATCH): string {
  const head = LIST_LOG_MODEL_BODY_HEAD_BYTES;
  const tail = LIST_LOG_MODEL_BODY_TAIL_BYTES;
  return `SELECT id, provider_id, timestamp,
    hex(SUBSTR(original_request_body, 1, ${head})) as original_request_body,
    hex(CASE WHEN length(original_request_body) > ${head}
      THEN SUBSTR(original_request_body, -${tail}) ELSE NULL END) as original_request_body_tail,
    hex(SUBSTR(request_body, 1, ${head})) as request_body,
    hex(CASE WHEN length(request_body) > ${head}
      THEN SUBSTR(request_body, -${tail}) ELSE NULL END) as request_body_tail
  FROM ${TABLE}
  WHERE id > ${Math.floor(afterId)}
  ORDER BY id
  LIMIT ${Math.floor(limit)}`;
}

export function postgresAliasBackfillSelect(afterId: number, limit = BACKFILL_BATCH): string {
  const head = LIST_LOG_MODEL_BODY_HEAD_BYTES;
  const tail = LIST_LOG_MODEL_BODY_TAIL_BYTES;
  return `SELECT id, provider_id, timestamp,
    encode(substring(original_request_body from 1 for ${head}), 'hex') as original_request_body,
    encode(CASE WHEN octet_length(original_request_body) > ${head}
      THEN substring(original_request_body from octet_length(original_request_body) - ${tail - 1} for ${tail})
      ELSE NULL END, 'hex') as original_request_body_tail,
    encode(substring(request_body from 1 for ${head}), 'hex') as request_body,
    encode(CASE WHEN octet_length(request_body) > ${head}
      THEN substring(request_body from octet_length(request_body) - ${tail - 1} for ${tail})
      ELSE NULL END, 'hex') as request_body_tail
  FROM ${TABLE}
  WHERE id > ${Math.floor(afterId)}
  ORDER BY id
  LIMIT ${Math.floor(limit)}`;
}

function sqlStringLiteral(value: string | undefined): string {
  if (value === undefined) {
    return "NULL";
  }
  return `'${value.replace(/\u0000/g, "").replace(/'/g, "''")}'`;
}

export function sqliteAliasUpsertStatements(rows: ModelAliasUpsert[]): string[] {
  return rows.map(
    row => `INSERT INTO ${ALIAS_REGISTRY_TABLE} (
      provider_id, alias, upstream_model_id, protocol, display_name, first_seen, last_seen
    ) VALUES (
      ${sqlStringLiteral(row.providerId)},
      ${sqlStringLiteral(row.alias)},
      ${sqlStringLiteral(row.upstreamModelId)},
      ${sqlStringLiteral(row.protocol)},
      ${sqlStringLiteral(row.displayName)},
      ${Math.floor(row.firstSeen)},
      ${Math.floor(row.lastSeen)}
    )
    ON CONFLICT(provider_id, alias, upstream_model_id) DO UPDATE SET
      first_seen = MIN(${ALIAS_REGISTRY_TABLE}.first_seen, excluded.first_seen),
      last_seen = MAX(${ALIAS_REGISTRY_TABLE}.last_seen, excluded.last_seen),
      protocol = COALESCE(excluded.protocol, ${ALIAS_REGISTRY_TABLE}.protocol),
      display_name = COALESCE(excluded.display_name, ${ALIAS_REGISTRY_TABLE}.display_name)`
  );
}

async function scanAliasBackfill(
  selectSql: (afterId: number) => string,
  queryAll: (
    sql: string
  ) => Promise<Array<Record<string, unknown>>> | Array<Record<string, unknown>>
): Promise<ModelAliasUpsert[]> {
  const grouped = new Map<string, ModelAliasUpsert>();
  let afterId = 0;
  for (;;) {
    const batch = await Promise.resolve(queryAll(selectSql(afterId)));
    if (batch.length === 0) {
      break;
    }
    for (const row of collectAliasUpsertsFromLogRows(batch)) {
      const key = `${row.providerId}\0${row.alias}\0${row.upstreamModelId}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { ...row });
        continue;
      }
      existing.firstSeen = Math.min(existing.firstSeen, row.firstSeen);
      existing.lastSeen = Math.max(existing.lastSeen, row.lastSeen);
    }
    const lastId = Number(batch[batch.length - 1]?.id ?? 0);
    if (!Number.isFinite(lastId) || lastId <= afterId) {
      break;
    }
    afterId = lastId;
  }
  return [...grouped.values()];
}

export function backfillSqliteModelAliasesSync(
  queryAll: (sql: string) => Array<Record<string, unknown>>,
  exec: (sql: string) => void
): void {
  const grouped = new Map<string, ModelAliasUpsert>();
  let afterId = 0;
  for (;;) {
    const batch = queryAll(sqliteAliasBackfillSelect(afterId));
    if (batch.length === 0) {
      break;
    }
    for (const row of collectAliasUpsertsFromLogRows(batch)) {
      const key = `${row.providerId}\0${row.alias}\0${row.upstreamModelId}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { ...row });
        continue;
      }
      existing.firstSeen = Math.min(existing.firstSeen, row.firstSeen);
      existing.lastSeen = Math.max(existing.lastSeen, row.lastSeen);
    }
    const lastId = Number(batch[batch.length - 1]?.id ?? 0);
    if (!Number.isFinite(lastId) || lastId <= afterId) {
      break;
    }
    afterId = lastId;
  }
  const rows = [...grouped.values()];
  if (rows.length === 0) {
    return;
  }
  const statements = sqliteAliasUpsertStatements(rows);
  exec("BEGIN");
  try {
    for (const sql of statements) {
      exec(sql);
    }
    exec("COMMIT");
  } catch (err) {
    exec("ROLLBACK");
    throw err;
  }
}

export async function backfillSqliteModelAliases(
  queryAll: (
    sql: string
  ) => Promise<Array<Record<string, unknown>>> | Array<Record<string, unknown>>,
  exec: (sql: string) => Promise<void> | void
): Promise<void> {
  const rows = await scanAliasBackfill(sqliteAliasBackfillSelect, queryAll);
  if (rows.length === 0) {
    return;
  }
  const statements = sqliteAliasUpsertStatements(rows);
  await Promise.resolve(exec("BEGIN"));
  try {
    for (const sql of statements) {
      await Promise.resolve(exec(sql));
    }
    await Promise.resolve(exec("COMMIT"));
  } catch (err) {
    await Promise.resolve(exec("ROLLBACK"));
    throw err;
  }
}

export async function backfillPostgresModelAliases(
  query: (sql: string, params?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }>
): Promise<void> {
  const rows = await scanAliasBackfill(postgresAliasBackfillSelect, async sql => {
    const result = await query(sql);
    return result.rows ?? [];
  });
  for (const row of rows) {
    await query(
      `INSERT INTO ${ALIAS_REGISTRY_TABLE} (
        provider_id, alias, upstream_model_id, protocol, display_name, first_seen, last_seen
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (provider_id, alias, upstream_model_id) DO UPDATE SET
        first_seen = LEAST(${ALIAS_REGISTRY_TABLE}.first_seen, EXCLUDED.first_seen),
        last_seen = GREATEST(${ALIAS_REGISTRY_TABLE}.last_seen, EXCLUDED.last_seen)`,
      [
        row.providerId,
        row.alias,
        row.upstreamModelId,
        row.protocol ?? null,
        row.displayName ?? null,
        row.firstSeen,
        row.lastSeen,
      ]
    );
  }
}
