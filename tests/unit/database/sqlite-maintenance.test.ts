import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "module";
import { TABLE, METRICS_TABLE } from "@/database/schema";
import {
  runSqliteLogMaintenance,
  type SqliteMaintenanceConn,
} from "@/database/drivers/sqlite/maintenance";
import { truncateLogBody } from "@/database/shared-utils";
import { resolveLogRetention, resolveLogMaxBodyBytes } from "@/config/logging";

interface SyncDb {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): unknown;
  };
  close(): void;
}

function loadNodeSqlite(): (new (file: string) => SyncDb) | null {
  try {
    const req = createRequire(__filename);
    // eslint-disable-next-line @typescript-eslint/naming-convention -- class export
    const { DatabaseSync } = req("node:sqlite") as { DatabaseSync: new (file: string) => SyncDb };
    return DatabaseSync;
  } catch {
    return null;
  }
}

const nodeSqlite = loadNodeSqlite();
const DAY = 24 * 60 * 60 * 1000;

function connFor(db: SyncDb): SqliteMaintenanceConn {
  return {
    query: sql => Promise.resolve(db.prepare(sql).all()),
    exec: sql => {
      db.exec(sql);
      return Promise.resolve();
    },
  };
}

describe.skipIf(!nodeSqlite)("runSqliteLogMaintenance", () => {
  let dbPath: string;
  let db: SyncDb;

  function open(autoVacuum: "INCREMENTAL" | "NONE"): void {
    db = new nodeSqlite!(dbPath);
    db.exec(`PRAGMA auto_vacuum = ${autoVacuum}`);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, request_body BLOB)`
    );
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ts ON ${TABLE}(timestamp)`);
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${METRICS_TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL)`
    );
  }

  function insertRows(count: number, opts: { start: number; step: number; bodyBytes?: number }) {
    const body = opts.bodyBytes ? Buffer.alloc(opts.bodyBytes, 0x61) : null;
    const logStmt = db.prepare(`INSERT INTO ${TABLE} (timestamp, request_body) VALUES (?, ?)`);
    const metricStmt = db.prepare(`INSERT INTO ${METRICS_TABLE} (timestamp) VALUES (?)`);
    db.exec("BEGIN");
    for (let i = 0; i < count; i++) {
      const ts = opts.start + i * opts.step;
      logStmt.run(ts, body);
      metricStmt.run(ts);
    }
    db.exec("COMMIT");
  }

  const count = (table: string) =>
    Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).all()[0].c);
  const pragma = (name: string) => Number(Object.values(db.prepare(`PRAGMA ${name}`).all()[0])[0]);

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `ccrelay-maint-${process.pid}-${Date.now()}.db`);
  });

  afterEach(() => {
    db?.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(dbPath + suffix, { force: true });
    }
  });

  it("drops rows and metrics older than maxAgeDays in batches", async () => {
    open("INCREMENTAL");
    const now = Date.now();
    insertRows(1200, { start: now - 40 * DAY, step: 1 });
    insertRows(10, { start: now - DAY, step: 1 });

    const report = await runSqliteLogMaintenance(
      connFor(db),
      { maxAgeDays: 30, maxRows: 0, maxSizeMB: 0 },
      { allowFullVacuum: true }
    );

    expect(report.deletedByAge).toBe(1200);
    expect(count(TABLE)).toBe(10);
    expect(count(METRICS_TABLE)).toBe(10);
  });

  it("keeps only the newest maxRows rows", async () => {
    open("INCREMENTAL");
    const now = Date.now();
    insertRows(50, { start: now - 1000, step: 10 });

    const report = await runSqliteLogMaintenance(
      connFor(db),
      { maxAgeDays: 0, maxRows: 20, maxSizeMB: 0 },
      { allowFullVacuum: true }
    );

    expect(report.deletedByRows).toBe(30);
    const oldest = Number(db.prepare(`SELECT MIN(timestamp) AS t FROM ${TABLE}`).all()[0].t);
    expect(oldest).toBe(now - 1000 + 30 * 10);
  });

  it("drops the oldest rows until live data fits maxSizeMB, then reclaims pages", async () => {
    open("INCREMENTAL");
    const now = Date.now();
    insertRows(1200, { start: now - 100_000, step: 10, bodyBytes: 8 * 1024 });
    const live = () => (pragma("page_count") - pragma("freelist_count")) * pragma("page_size");
    expect(live()).toBeGreaterThan(8 * 1024 * 1024);

    const report = await runSqliteLogMaintenance(
      connFor(db),
      { maxAgeDays: 0, maxRows: 0, maxSizeMB: 4 },
      { allowFullVacuum: true }
    );

    expect(report.deletedBySize).toBeGreaterThan(0);
    expect(live()).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(report.vacuum).toBe("incremental");
    expect(report.fileBytesAfter).toBeLessThan(report.fileBytesBefore);
    expect(pragma("freelist_count")).toBe(0);
    const newest = Number(db.prepare(`SELECT MAX(timestamp) AS t FROM ${TABLE}`).all()[0].t);
    expect(newest).toBe(now - 100_000 + 1199 * 10);
  });

  it("runs a one-off full VACUUM on legacy files with many free pages and enables incremental mode", async () => {
    open("NONE");
    const now = Date.now();
    insertRows(600, { start: now - 40 * DAY, step: 1, bodyBytes: 8 * 1024 });
    insertRows(10, { start: now - DAY, step: 1, bodyBytes: 8 * 1024 });
    expect(pragma("auto_vacuum")).toBe(0);

    const report = await runSqliteLogMaintenance(
      connFor(db),
      { maxAgeDays: 30, maxRows: 0, maxSizeMB: 0 },
      { allowFullVacuum: true }
    );

    expect(report.vacuum).toBe("full");
    expect(report.fileBytesAfter).toBeLessThan(report.fileBytesBefore / 4);
    expect(pragma("auto_vacuum")).toBe(2);
    expect(fs.statSync(`${dbPath}-wal`).size).toBe(0);
  });

  it("skips the full VACUUM when not allowed (CLI driver)", async () => {
    open("NONE");
    const now = Date.now();
    insertRows(300, { start: now - 40 * DAY, step: 1, bodyBytes: 8 * 1024 });

    const report = await runSqliteLogMaintenance(
      connFor(db),
      { maxAgeDays: 30, maxRows: 0, maxSizeMB: 0 },
      { allowFullVacuum: false }
    );

    expect(report.deletedByAge).toBe(300);
    expect(report.vacuum).toBe("none");
  });
});

describe("truncateLogBody", () => {
  it("keeps bodies within the cap and when the cap is 0", () => {
    expect(truncateLogBody("short", 10)).toBe("short");
    expect(truncateLogBody("x".repeat(100), 0)).toBe("x".repeat(100));
    expect(truncateLogBody(undefined, 10)).toBeUndefined();
  });

  it("cuts at the byte cap and records the dropped size", () => {
    const out = truncateLogBody("a".repeat(50), 20);
    expect(out).toBe(`${"a".repeat(20)}\n…[truncated 30 bytes]`);
  });

  it("does not leave a broken multi-byte character at the cut", () => {
    const out = truncateLogBody("你".repeat(10), 8)!;
    expect(out.startsWith("你你")).toBe(true);
    expect(out).not.toContain("\uFFFD");
    expect(out).toContain("[truncated 22 bytes]");
  });
});

describe("logging retention config", () => {
  it("defaults when unset", () => {
    expect(resolveLogRetention(undefined)).toEqual({
      maxAgeDays: 30,
      maxRows: 10000,
      maxSizeMB: 256,
    });
    expect(resolveLogMaxBodyBytes(undefined)).toBe(1_048_576);
  });

  it("accepts 0 as unlimited and ignores invalid values", () => {
    expect(
      resolveLogRetention({ retention: { maxAgeDays: 0, maxRows: -5, maxSizeMB: "big" } })
    ).toEqual({ maxAgeDays: 0, maxRows: 10000, maxSizeMB: 256 });
    expect(resolveLogMaxBodyBytes({ maxBodyBytes: 0 })).toBe(0);
  });
});
