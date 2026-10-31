/**
 * SQLite log-store maintenance shared by the native and CLI drivers: retention deletes in
 * small batches, an on-disk size cap, WAL truncation, and free-page reclamation.
 */

import { TABLE, METRICS_TABLE } from "../../schema";
import { retentionCutoffMs } from "../../shared-utils";
import type { LogRetentionPolicy } from "../../types";
import type { Logger } from "../../../utils/logger";

/** WAL pages before SQLite auto-checkpoints (SQLite default, set explicitly). */
export const SQLITE_WAL_AUTOCHECKPOINT_PAGES = 1000;
/** Truncate the `-wal` file back to this size after checkpoints (64 MB). */
export const SQLITE_JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

/** Minimal connection surface; every value inlined into SQL here is a number. */
export interface SqliteMaintenanceConn {
  query(sql: string): Promise<Record<string, unknown>[]>;
  exec(sql: string): Promise<void>;
}

export interface SqliteMaintenanceOptions {
  /**
   * Allow a one-off full `VACUUM` (switching the file to incremental auto-vacuum) when free
   * pages exceed {@link FULL_VACUUM_FREE_RATIO}. Off for the CLI driver: it has a per-command timeout.
   */
  allowFullVacuum: boolean;
  /** Upper bound of pages released per `incremental_vacuum` call; 0 = all free pages. */
  maxIncrementalVacuumPages?: number;
}

export interface SqliteMaintenanceReport {
  deletedByAge: number;
  deletedByRows: number;
  deletedBySize: number;
  vacuum: "none" | "incremental" | "full";
  fileBytesBefore: number;
  fileBytesAfter: number;
}

export const MAINTENANCE_DELETE_BATCH = 500;
/** Size-cap deletes stop after this many batches per run so one pass stays bounded. */
const MAX_SIZE_CAP_BATCHES = 200;
export const FULL_VACUUM_FREE_RATIO = 0.3;

const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

async function scalar(conn: SqliteMaintenanceConn, sql: string): Promise<number> {
  const rows = await conn.query(sql);
  const first = rows[0];
  if (!first) {
    return 0;
  }
  const value = Number(Object.values(first)[0]);
  return Number.isFinite(value) ? value : 0;
}

interface PageStats {
  pageSize: number;
  pageCount: number;
  freePages: number;
}

async function pageStats(conn: SqliteMaintenanceConn): Promise<PageStats> {
  return {
    pageSize: await scalar(conn, "PRAGMA page_size"),
    pageCount: await scalar(conn, "PRAGMA page_count"),
    freePages: await scalar(conn, "PRAGMA freelist_count"),
  };
}

/** Delete request-log rows matching `where`, oldest first, in fixed-size batches. */
async function deleteLogsInBatches(
  conn: SqliteMaintenanceConn,
  where: string,
  maxBatches = Number.POSITIVE_INFINITY
): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await conn.query(
      `SELECT id FROM ${TABLE} WHERE ${where} ORDER BY timestamp ASC LIMIT ${MAINTENANCE_DELETE_BATCH}`
    );
    const ids = rows.map(r => Number(r.id)).filter(id => Number.isInteger(id));
    if (ids.length === 0) {
      break;
    }
    await conn.exec(`DELETE FROM ${TABLE} WHERE id IN (${ids.join(",")})`);
    deleted += ids.length;
    if (ids.length < MAINTENANCE_DELETE_BATCH) {
      break;
    }
    await yieldToEventLoop();
  }
  return deleted;
}

export async function runSqliteLogMaintenance(
  conn: SqliteMaintenanceConn,
  policy: LogRetentionPolicy,
  options: SqliteMaintenanceOptions
): Promise<SqliteMaintenanceReport> {
  const before = await pageStats(conn);
  const report: SqliteMaintenanceReport = {
    deletedByAge: 0,
    deletedByRows: 0,
    deletedBySize: 0,
    vacuum: "none",
    fileBytesBefore: before.pageCount * before.pageSize,
    fileBytesAfter: 0,
  };

  const cutoff = retentionCutoffMs(policy.maxAgeDays);
  if (cutoff !== undefined) {
    const ts = Math.floor(cutoff);
    report.deletedByAge = await deleteLogsInBatches(conn, `timestamp < ${ts}`);
    await conn.exec(`DELETE FROM ${METRICS_TABLE} WHERE timestamp < ${ts}`);
  }

  if (policy.maxRows > 0) {
    const total = await scalar(conn, `SELECT COUNT(*) AS c FROM ${TABLE}`);
    const excess = total - policy.maxRows;
    if (excess > 0) {
      const rows = await conn.query(
        `SELECT timestamp FROM ${TABLE} ORDER BY timestamp DESC LIMIT 1 OFFSET ${policy.maxRows - 1}`
      );
      const oldestKept = Number(rows[0]?.timestamp);
      if (Number.isFinite(oldestKept)) {
        report.deletedByRows = await deleteLogsInBatches(conn, `timestamp < ${oldestKept}`);
      }
    }
  }

  if (policy.maxSizeMB > 0) {
    const capBytes = policy.maxSizeMB * 1024 * 1024;
    let batches = 0;
    let stats = await pageStats(conn);
    while (
      (stats.pageCount - stats.freePages) * stats.pageSize > capBytes &&
      batches < MAX_SIZE_CAP_BATCHES
    ) {
      const n = await deleteLogsInBatches(conn, "1=1", 1);
      if (n === 0) {
        break;
      }
      report.deletedBySize += n;
      batches++;
      stats = await pageStats(conn);
    }
  }

  await conn.query("PRAGMA wal_checkpoint(TRUNCATE)");

  const stats = await pageStats(conn);
  if (stats.freePages > 0) {
    const autoVacuum = await scalar(conn, "PRAGMA auto_vacuum");
    if (autoVacuum === 2) {
      const limit = options.maxIncrementalVacuumPages ?? 0;
      await conn.exec(`PRAGMA incremental_vacuum(${limit > 0 ? limit : stats.freePages})`);
      report.vacuum = "incremental";
    } else if (
      options.allowFullVacuum &&
      stats.pageCount > 0 &&
      stats.freePages / stats.pageCount > FULL_VACUUM_FREE_RATIO
    ) {
      // VACUUM rewrites the file and applies the pending auto_vacuum mode for later runs.
      await conn.exec("PRAGMA auto_vacuum = INCREMENTAL");
      await conn.exec("VACUUM");
      report.vacuum = "full";
    }
    if (report.vacuum !== "none") {
      await conn.query("PRAGMA wal_checkpoint(TRUNCATE)");
    }
  }

  const after = await pageStats(conn);
  report.fileBytesAfter = after.pageCount * after.pageSize;
  return report;
}

const toMB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

export function logMaintenanceReport(
  log: Logger,
  label: string,
  report: SqliteMaintenanceReport
): void {
  const deleted = report.deletedByAge + report.deletedByRows + report.deletedBySize;
  const message =
    `[${label}] Maintenance: deleted ${deleted} log rows ` +
    `(age=${report.deletedByAge}, rows=${report.deletedByRows}, size=${report.deletedBySize}), ` +
    `vacuum=${report.vacuum}, file ${toMB(report.fileBytesBefore)}MB -> ${toMB(report.fileBytesAfter)}MB`;
  if (deleted > 0 || report.vacuum !== "none") {
    log.info(message);
  } else {
    log.debug(message);
  }
}
