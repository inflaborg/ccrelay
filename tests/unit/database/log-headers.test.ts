import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { SqliteNativeDriver } from "@/database/drivers/sqlite/native";
import { maskHeadersForLog } from "@/server/headerMask";

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

describe.skipIf(!nativeForNode)("request log header storage", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `ccrelay-headers-test-${Date.now()}.db`);
  });

  afterEach(() => {
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it("persists masked request headers at pending insert and response headers on completion", async () => {
    const driver = new SqliteNativeDriver({ type: "sqlite", path: dbPath });
    await driver.initialize({ logsEnabled: true });

    const clientId = "client-headers-1";
    const reqHeaders: Record<string, string> = { authorization: "Bearer tokensecret123456" };
    reqHeaders["content-type"] = "application/json";
    reqHeaders["x-api-key"] = "sk-secretkey123456";
    const requestHeaders = maskHeadersForLog(reqHeaders);

    driver.insertLogPending({
      timestamp: Date.now(),
      providerId: "p1",
      providerName: "Provider",
      method: "POST",
      path: "/v1/messages",
      clientId,
      duration: 0,
      success: false,
      status: "pending",
      requestHeaders,
    });

    const resHeaders: Record<string, string> = {};
    resHeaders["x-request-id"] = "req_abc";
    resHeaders["request-id"] = "req_abc";
    const responseHeaders = maskHeadersForLog(resHeaders);

    driver.updateLogCompleted(
      clientId,
      200,
      '{"ok":true}',
      42,
      true,
      undefined,
      undefined,
      10,
      20,
      0,
      undefined,
      responseHeaders
    );

    const { logs } = await driver.queryLogs({ limit: 10 });
    const id = logs[0]?.id;
    expect(id).toBeDefined();

    const detail = await driver.getLogById(id!);
    expect(detail).not.toBeNull();

    const parsedReqHeaders = JSON.parse(detail!.requestHeaders!) as Record<string, string>;
    // Non-sensitive header passes through.
    expect(parsedReqHeaders["content-type"]).toBe("application/json");
    // Sensitive headers are masked (never stored in the clear).
    expect(parsedReqHeaders["x-api-key"]).toBe("sk-s***3456");
    expect(parsedReqHeaders.authorization).toBe("Bearer toke***3456");
    expect(parsedReqHeaders["x-api-key"]).not.toContain("secretkey");

    const parsedResHeaders = JSON.parse(detail!.responseHeaders!) as Record<string, string>;
    expect(parsedResHeaders["x-request-id"]).toBe("req_abc");

    await driver.close();
  });

  it("runs the add_headers migration on a fresh database (columns nullable)", async () => {
    const driver = new SqliteNativeDriver({ type: "sqlite", path: dbPath });
    await driver.initialize({ logsEnabled: true });

    const clientId = "client-headers-2";
    driver.insertLogPending({
      timestamp: Date.now(),
      providerId: "p1",
      providerName: "Provider",
      method: "GET",
      path: "/v1/models",
      clientId,
      duration: 0,
      success: false,
      status: "pending",
    });

    const { logs } = await driver.queryLogs({ limit: 10 });
    const id = logs[0]?.id;
    expect(id).toBeDefined();
    const detail = await driver.getLogById(id!);
    // Headers are optional and absent when not captured.
    expect(detail!.requestHeaders).toBeUndefined();
    expect(detail!.responseHeaders).toBeUndefined();

    await driver.close();
  });
});
