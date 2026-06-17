import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";
import { handleStats } from "@/api/stats";
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
