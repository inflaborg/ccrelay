import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";
import { handleStats, handleProviderStats, parseStatsRangeSince } from "@/api/stats";
import { resetDatabase, getDatabase } from "@/database";
import { setProxyServerForApi, resetProxyServerForApi } from "@/api/serverRef";

class MockServerResponse {
  statusCode = 200;
  ended = false;
  body = "";

  writeHead(code: number): void {
    this.statusCode = code;
  }

  end(data?: string): void {
    this.ended = true;
    if (data) {
      this.body = data;
    }
  }
}

describe("parseStatsRangeSince", () => {
  const now = 1_700_000_000_000;

  it("maps 1d/7d/30d to epoch lower bounds", () => {
    expect(parseStatsRangeSince("1d", now)).toBe(now - 24 * 60 * 60 * 1000);
    expect(parseStatsRangeSince("7d", now)).toBe(now - 7 * 24 * 60 * 60 * 1000);
    expect(parseStatsRangeSince("30d", now)).toBe(now - 30 * 24 * 60 * 60 * 1000);
  });

  it("returns undefined for all / unknown ranges", () => {
    expect(parseStatsRangeSince("all", now)).toBeUndefined();
    expect(parseStatsRangeSince(null, now)).toBeUndefined();
  });
});

describe("handleStats", () => {
  beforeEach(() => {
    resetProxyServerForApi();
    setProxyServerForApi({
      getRole: () => "leader",
    } as never);
    resetDatabase();
  });

  afterEach(() => {
    resetDatabase();
    resetProxyServerForApi();
  });

  it("returns dbAvailable false when database driver is not ready", async () => {
    const db = getDatabase();
    expect(db.enabled).toBe(false);

    const res = new MockServerResponse();
    await handleStats(
      { url: "/ccrelay/api/stats" } as IncomingMessage,
      res as unknown as ServerResponse,
      {}
    );

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as { dbAvailable: boolean; totalInputTokens: number };
    expect(payload.dbAvailable).toBe(false);
    expect(payload.totalInputTokens).toBe(0);
  });
});

describe("handleProviderStats", () => {
  beforeEach(() => {
    resetProxyServerForApi();
    setProxyServerForApi({
      getRole: () => "leader",
    } as never);
    resetDatabase();
  });

  afterEach(() => {
    resetDatabase();
    resetProxyServerForApi();
  });

  it("returns 400 when providerId is missing", async () => {
    const res = new MockServerResponse();
    await handleProviderStats(
      { url: "/ccrelay/api/stats/providers/" } as IncomingMessage,
      res as unknown as ServerResponse,
      { providerId: "  " }
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns empty detail with dbAvailable false when database is not ready", async () => {
    const res = new MockServerResponse();
    await handleProviderStats(
      { url: "/ccrelay/api/stats/providers/openai?range=7d" } as IncomingMessage,
      res as unknown as ServerResponse,
      { providerId: "openai" }
    );

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as {
      dbAvailable: boolean;
      providerId: string;
      count: number;
      modelBreakdown: unknown[];
    };
    expect(payload.dbAvailable).toBe(false);
    expect(payload.providerId).toBe("openai");
    expect(payload.count).toBe(0);
    expect(payload.modelBreakdown).toEqual([]);
  });
});
