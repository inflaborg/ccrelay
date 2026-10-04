/* eslint-disable @typescript-eslint/naming-convention -- DB column wire names */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteNativeDriver } from "@/database/drivers/sqlite/native";
import {
  applyAliasRegistryToLog,
  backfillSqliteModelAliasesSync,
  catalogSourcesToAliasUpserts,
  collectAliasUpsertsFromLogRows,
  labelAliasedStatModel,
  resolveAliasUpstream,
} from "@/database/model-alias-registry";
import { ALIAS_REGISTRY_TABLE } from "@/database/schema";
import type { ModelAliasRecord, RequestLog } from "@/database/types";

function record(overrides: Partial<ModelAliasRecord> = {}): ModelAliasRecord {
  return {
    providerId: "p1",
    alias: "claude-abcd1234",
    upstreamModelId: "glm-5.1",
    firstSeen: 100,
    lastSeen: 200,
    ...overrides,
  };
}

function log(overrides: Partial<RequestLog> = {}): RequestLog {
  return {
    timestamp: 150,
    providerId: "p1",
    providerName: "P",
    method: "POST",
    path: "/v1/messages",
    duration: 1,
    success: true,
    model: "claude-abcd1234",
    ...overrides,
  };
}

describe("model alias registry", () => {
  it("keeps an older alias when the catalog hash changes", () => {
    const rows = catalogSourcesToAliasUpserts(
      [
        {
          providerId: "p1",
          aliasHash: "claude-aaaa1111",
          legacyAlias: "claude-oldhash1",
          upstreamModelId: "glm-5.1",
          protocol: "anthropic",
          displayName: "GLM",
        },
      ],
      50
    );
    expect(rows.map(row => row.alias).sort()).toEqual(["claude-aaaa1111", "claude-oldhash1"]);
    expect(rows.every(row => row.upstreamModelId === "glm-5.1" && row.firstSeen === 50)).toBe(true);
  });

  it("resolves the mapping that had started by the log timestamp", () => {
    const records = [
      record({ upstreamModelId: "glm-4.7", firstSeen: 10, lastSeen: 40 }),
      record({ upstreamModelId: "glm-5.1", firstSeen: 100, lastSeen: 200 }),
    ];
    expect(resolveAliasUpstream(records, "p1", "claude-abcd1234", 30)).toBe("glm-4.7");
    expect(resolveAliasUpstream(records, "p1", "claude-abcd1234", 150)).toBe("glm-5.1");
  });

  it("uses a single later recording for logs that predate it", () => {
    expect(resolveAliasUpstream([record({ firstSeen: 500 })], "p1", "claude-abcd1234", 10)).toBe(
      "glm-5.1"
    );
  });

  it("does not guess when several future mappings exist", () => {
    const records = [
      record({ upstreamModelId: "glm-4.7", firstSeen: 500, lastSeen: 600 }),
      record({ upstreamModelId: "glm-5.1", firstSeen: 700, lastSeen: 800 }),
    ];
    expect(resolveAliasUpstream(records, "p1", "claude-abcd1234", 10)).toBeUndefined();
  });

  it("fills mappedModel only when the log still shows the alias", () => {
    const records = [record()];
    expect(applyAliasRegistryToLog(log(), records).mappedModel).toBe("glm-5.1");
    expect(
      applyAliasRegistryToLog(log({ model: "claude-abcd1234", mappedModel: "glm-5.1" }), records)
        .mappedModel
    ).toBe("glm-5.1");
    expect(applyAliasRegistryToLog(log({ providerId: "other" }), records).mappedModel).toBe(
      undefined
    );
  });

  it("labels a stats bucket without dropping the alias key's identity in the string", () => {
    expect(labelAliasedStatModel("p1", "claude-abcd1234", [record()])).toBe(
      "claude-abcd1234 → glm-5.1"
    );
    expect(labelAliasedStatModel("p1", "glm-5.1", [record()])).toBe("glm-5.1");
  });

  it("backfills hash aliases from original and mapped request bodies", () => {
    const original = JSON.stringify({ model: "claude-abcd1234", messages: [] });
    const mapped = JSON.stringify({ model: "glm-5.1", messages: [] });
    const rows = collectAliasUpsertsFromLogRows([
      {
        provider_id: "p1",
        timestamp: 20,
        original_request_body: Buffer.from(original).toString("hex"),
        request_body: Buffer.from(mapped).toString("hex"),
      },
      {
        provider_id: "p1",
        timestamp: 40,
        original_request_body: original,
        request_body: mapped,
      },
      {
        provider_id: "p1",
        timestamp: 15,
        original_request_body: JSON.stringify({ model: "claude-sonnet-4-6" }),
        request_body: JSON.stringify({ model: "glm-5.1" }),
      },
    ]);
    expect(rows).toEqual([
      {
        providerId: "p1",
        alias: "claude-abcd1234",
        upstreamModelId: "glm-5.1",
        firstSeen: 20,
        lastSeen: 40,
      },
    ]);
  });
});

function nativeSqliteAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3Ctor = require("better-sqlite3") as new (file: string) => { close(): void };
    const db = new BetterSqlite3Ctor(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!nativeSqliteAvailable())("model alias registry (native driver)", () => {
  let dbPath = "";

  afterEach(() => {
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore missing file
    }
  });

  it("extends the seen window, keeps rows when logs are cleared, and drops them with metrics", async () => {
    dbPath = path.join(os.tmpdir(), `ccrelay-alias-${Date.now()}.db`);
    const driver = new SqliteNativeDriver({ type: "sqlite", path: dbPath });
    await driver.initialize({ logsEnabled: true });

    await driver.upsertModelAliases([
      {
        providerId: "p1",
        alias: "claude-11111111",
        upstreamModelId: "glm-4.7",
        firstSeen: 10,
        lastSeen: 10,
      },
    ]);
    await driver.upsertModelAliases([
      {
        providerId: "p1",
        alias: "claude-11111111",
        upstreamModelId: "glm-4.7",
        firstSeen: 5,
        lastSeen: 20,
      },
      {
        providerId: "p1",
        alias: "claude-22222222",
        upstreamModelId: "glm-5.1",
        firstSeen: 8,
        lastSeen: 8,
      },
    ]);

    const listed = await driver.listModelAliases();
    const glm47 = listed.find(row => row.alias === "claude-11111111");
    expect(glm47?.firstSeen).toBe(5);
    expect(glm47?.lastSeen).toBe(20);
    expect(listed).toHaveLength(2);

    await driver.clearAllLogs();
    expect(await driver.listModelAliases()).toHaveLength(2);

    await driver.clearAllMetrics();
    expect(await driver.listModelAliases()).toEqual([]);
    await driver.close();
  });

  it("backfills alias rows from logs written before the registry existed", async () => {
    dbPath = path.join(os.tmpdir(), `ccrelay-alias-backfill-${Date.now()}.db`);
    const driver = new SqliteNativeDriver({ type: "sqlite", path: dbPath });
    await driver.initialize({ logsEnabled: true });
    driver.insertLog({
      timestamp: 1_700_000_000_000,
      providerId: "p1",
      providerName: "P",
      method: "POST",
      path: "/v1/messages",
      duration: 5,
      success: true,
      clientId: "c-alias",
      originalRequestBody: JSON.stringify({ model: "claude-abcd1234", messages: [] }),
      requestBody: JSON.stringify({ model: "glm-5.1", messages: [] }),
    });
    await driver.close();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new BetterSqlite3(dbPath);
    backfillSqliteModelAliasesSync(
      sql => db.prepare(sql).all() as Array<Record<string, unknown>>,
      sql => {
        db.exec(sql);
      }
    );
    const saved = db
      .prepare(`SELECT alias, upstream_model_id as upstream FROM ${ALIAS_REGISTRY_TABLE}`)
      .all() as Array<{ alias: string; upstream: string }>;
    db.close();

    expect(saved).toEqual([{ alias: "claude-abcd1234", upstream: "glm-5.1" }]);
  });
});
