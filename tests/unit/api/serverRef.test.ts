/**
 * Leader-only guard for log storage HTTP APIs.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ServerResponse } from "node:http";
import {
  rejectLogStorageApiIfNotLeader,
  resetProxyServerForApi,
  setProxyServerForApi,
} from "@/api/serverRef";
import type { ProxyServer } from "@/server/handler";

class MockServerResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";
  ended = false;

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) {
      Object.assign(this.headers, headers);
    }
    return this;
  }

  end(data?: string): this {
    if (data !== undefined) {
      this.body += data;
    }
    this.ended = true;
    return this;
  }
}

describe("api: serverRef rejectLogStorageApiIfNotLeader", () => {
  beforeEach(() => {
    resetProxyServerForApi();
  });

  it("returns true and sends 503 when proxy server ref is unset", () => {
    const res = new MockServerResponse() as unknown as ServerResponse;
    expect(rejectLogStorageApiIfNotLeader(res)).toBe(true);
    expect(res.statusCode).toBe(503);
    const parsed = JSON.parse((res as unknown as MockServerResponse).body) as { error?: string };
    expect(parsed.error).toMatch(/leader/i);
  });

  it("returns true when role is follower", () => {
    setProxyServerForApi({
      getRole: () => "follower",
    } as unknown as ProxyServer);

    const res = new MockServerResponse() as unknown as ServerResponse;
    expect(rejectLogStorageApiIfNotLeader(res)).toBe(true);
    expect(res.statusCode).toBe(503);
  });

  it("returns false when role is leader", () => {
    setProxyServerForApi({
      getRole: () => "leader",
    } as unknown as ProxyServer);

    const res = new MockServerResponse() as unknown as ServerResponse;
    expect(rejectLogStorageApiIfNotLeader(res)).toBe(false);
    expect(res.statusCode).toBe(200);
  });
});
