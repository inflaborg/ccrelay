import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SqliteNativeDriver } from "@/database/drivers/sqlite/native";
import { METRICS_TABLE, TABLE } from "@/database/schema";

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

describe.skipIf(!nativeForNode)("metrics split (native driver)", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `ccrelay-metrics-${Date.now()}.db`);
  });

  afterEach(() => {
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it("pending on inference path creates metrics row; models path does not", async () => {
    const driver = new SqliteNativeDriver({ type: "sqlite", path: dbPath });
    await driver.initialize();

    driver.insertLogPending({
      timestamp: Date.now(),
      providerId: "p1",
      providerName: "P",
      method: "POST",
      path: "/v1/messages",
      duration: 0,
      success: false,
      clientId: "c1",
      model: "claude-3",
    });

    driver.insertLogPending({
      timestamp: Date.now(),
      providerId: "p1",
      providerName: "P",
      method: "GET",
      path: "/v1/models",
      duration: 0,
      success: false,
      clientId: "c2",
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/naming-convention
    const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new BetterSqlite3(dbPath);
    const metricsCount = db.prepare(`SELECT COUNT(*) as c FROM ${METRICS_TABLE}`).get() as {
      c: number;
    };
    expect(metricsCount.c).toBe(1);
    db.close();
    await driver.close();
  });

  it("completion updates metrics tokens; clearAllLogs clears metrics too", async () => {
    const driver = new SqliteNativeDriver({ type: "sqlite", path: dbPath });
    await driver.initialize({ logsEnabled: true });

    const clientId = "c-complete";
    driver.insertLogPending({
      timestamp: Date.now(),
      providerId: "p1",
      providerName: "P",
      method: "POST",
      path: "/chat/completions",
      duration: 0,
      success: false,
      clientId,
      model: "gpt-4",
    });

    driver.updateLogCompleted(clientId, 200, "{}", 120, true, undefined, undefined, 10, 20, 5, 50);

    const { logs } = await driver.queryLogs({ limit: 10 });
    const row = logs.find(l => l.clientId === clientId);
    expect(row?.inputTokens).toBe(10);
    expect(row?.outputTokens).toBe(20);

    const statsBefore = await driver.getStats();
    expect(statsBefore.totalInputTokens).toBe(10);

    await driver.clearAllLogs();

    const statsAfter = await driver.getStats();
    expect(statsAfter.totalInputTokens).toBe(0);

    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/naming-convention
    const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new BetterSqlite3(dbPath);
    const v2Count = db.prepare(`SELECT COUNT(*) as c FROM ${TABLE}`).get() as { c: number };
    const mCount = db.prepare(`SELECT COUNT(*) as c FROM ${METRICS_TABLE}`).get() as { c: number };
    expect(v2Count.c).toBe(0);
    expect(mCount.c).toBe(0);
    db.close();

    await driver.close();
  });

  it("logsEnabled false writes metrics only (no request_logs_v2 rows)", async () => {
    const driver = new SqliteNativeDriver({ type: "sqlite", path: dbPath });
    await driver.initialize({ logsEnabled: false });

    const clientId = "metrics-only";
    driver.insertLogPending({
      timestamp: Date.now(),
      providerId: "p1",
      providerName: "P",
      method: "POST",
      path: "/v1/messages",
      duration: 0,
      success: false,
      clientId,
      model: "claude-3",
      requestBody: '{"model":"claude-3"}',
    });

    driver.updateLogCompleted(
      clientId,
      200,
      '{"usage":{"input_tokens":100,"output_tokens":50}}',
      80,
      true,
      undefined,
      undefined,
      100,
      50,
      0,
      30
    );

    const { logs, total } = await driver.queryLogs({ limit: 10 });
    expect(total).toBe(0);
    expect(logs).toHaveLength(0);

    const stats = await driver.getStats();
    expect(stats.totalInputTokens).toBe(100);
    expect(stats.totalOutputTokens).toBe(50);

    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/naming-convention
    const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new BetterSqlite3(dbPath);
    const v2Count = db.prepare(`SELECT COUNT(*) as c FROM ${TABLE}`).get() as { c: number };
    const mCount = db.prepare(`SELECT COUNT(*) as c FROM ${METRICS_TABLE}`).get() as { c: number };
    expect(v2Count.c).toBe(0);
    expect(mCount.c).toBe(1);
    db.close();

    await driver.close();
  });
});
