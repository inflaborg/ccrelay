import { describe, it, expect, beforeEach, afterEach } from "vitest";

/** Skips when better-sqlite3 was rebuilt for Electron (e.g. after desktop postinstall). */
function isBetterSqlite3AvailableForNode(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/naming-convention
    const BetterSqlite3Ctor = require("better-sqlite3") as new (path: string) => { close(): void };
    const db = new BetterSqlite3Ctor(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
}

const nativeForNode = isBetterSqlite3AvailableForNode();
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { runSqliteStartupMigration, sqlitePrecheckMigration } from "@/database/migration";
import { LEGACY_TABLE, TABLE } from "@/database/schema";
function encodeForStorageLegacy(value: string): string {
  return "B64:" + Buffer.from(value, "utf-8").toString("base64");
}

describe.skipIf(!nativeForNode)("log-db-migration", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccrelay-mig-"));
    dbPath = path.join(tmpDir, "logs.db");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function openDb() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/naming-convention
    const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
    return new BetterSqlite3(dbPath);
  }

  function createLegacyWithRows(): void {
    const db = openDb();
    db.exec(`
      CREATE TABLE ${LEGACY_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
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
    `);
    db.prepare(
      `INSERT INTO ${LEGACY_TABLE} (
        timestamp, provider_id, provider_name, method, path,
        request_body, duration, success
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      Date.now(),
      "p1",
      "Provider",
      "POST",
      "/v1/messages",
      encodeForStorageLegacy('{"model":"claude-3"}'),
      100,
      1
    );
    db.close();
  }

  it("precheck reports row count when legacy table has data", () => {
    createLegacyWithRows();
    const pre = sqlitePrecheckMigration(dbPath);
    expect(pre.oldRowCount).toBe(1);
  });

  it("migrate copies legacy rows into v2 BLOB table", () => {
    createLegacyWithRows();
    const db = openDb();
    runSqliteStartupMigration(
      dbPath,
      sql => (db.prepare(sql).get() as { c?: number } | undefined)?.c,
      sql => db.prepare(sql).all() as Array<Record<string, unknown>>,
      sql => {
        db.exec(sql);
      },
      params => {
        db.prepare(
          `INSERT INTO ${TABLE} (
            timestamp, provider_id, provider_name, method, path, target_url,
            request_body, response_body, original_request_body, original_response_body,
            status_code, duration, success, error_message, client_id, status, route_type,
            input_tokens, output_tokens, cache_tokens, ttfb
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(...params);
      },
      "migrate"
    );

    const legacyExists = db
      .prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name=?`)
      .get(LEGACY_TABLE) as { c: number };
    expect(legacyExists.c).toBe(0);

    const row = db.prepare(`SELECT request_body FROM ${TABLE}`).get() as {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- SQL column
      request_body: Buffer;
    };
    expect(row.request_body.toString("utf-8")).toContain("claude-3");
    db.close();
  });

  it("discard drops legacy without copying to v2", () => {
    createLegacyWithRows();
    const db = openDb();
    runSqliteStartupMigration(
      dbPath,
      sql => (db.prepare(sql).get() as { c?: number } | undefined)?.c,
      sql => db.prepare(sql).all() as Array<Record<string, unknown>>,
      sql => {
        db.exec(sql);
      },
      () => {
        /* no inserts */
      },
      "discard"
    );

    const count = db.prepare(`SELECT COUNT(*) as c FROM ${TABLE}`).get() as { c: number };
    expect(count.c).toBe(0);
    db.close();
  });
});
