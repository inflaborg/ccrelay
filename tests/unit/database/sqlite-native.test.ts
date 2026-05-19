import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { SqliteNativeDriver } from "@/database/drivers/sqlite/native";

function isBetterSqlite3AvailableForNode(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/naming-convention -- probe better-sqlite3 availability
    const BetterSqlite3Ctor = require("better-sqlite3") as new (path: string) => { close(): void };
    const db = new BetterSqlite3Ctor(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Skips when better-sqlite3 was rebuilt for Electron (e.g. after desktop postinstall). */
const nativeForNode = isBetterSqlite3AvailableForNode();

describe.skipIf(!nativeForNode)("SqliteNativeDriver", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `ccrelay-native-test-${Date.now()}.db`);
  });

  afterEach(() => {
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it("inserts and queries logs", async () => {
    const driver = new SqliteNativeDriver({ type: "sqlite", path: dbPath });
    await driver.initialize();

    driver.insertLog({
      timestamp: Date.now(),
      providerId: "p1",
      providerName: "Provider",
      method: "POST",
      path: "/v1/messages",
      duration: 100,
      success: true,
    });

    const { logs, total } = await driver.queryLogs({ limit: 10 });
    expect(total).toBe(1);
    expect(logs[0]?.providerId).toBe("p1");

    await driver.close();
  });
});
