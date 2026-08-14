import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleLogsBatch, MAX_LOG_BATCH_IDS } from "@/api/logs";
import { setProxyServerForApi, resetProxyServerForApi } from "@/api/serverRef";

const getLogById = vi.fn();

vi.mock("@/database", () => ({
  getDatabase: vi.fn(() => ({
    enabled: true,
    logsEnabled: true,
    getLogById,
  })),
}));

class MockIncomingMessage extends EventEmitter {
  url = "/ccrelay/api/logs/batch";
  method = "POST";
  headers: Record<string, string> = {};
}

class MockServerResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";
  ended = false;
  headersSent = false;

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) {
      this.headers = { ...this.headers, ...headers };
    }
    this.headersSent = true;
    return this;
  }

  end(data?: string): this {
    if (data) {
      this.body += data;
    }
    this.ended = true;
    return this;
  }
}

function postBody(payload: unknown): IncomingMessage {
  const req = new MockIncomingMessage();
  queueMicrotask(() => {
    req.emit("data", Buffer.from(JSON.stringify(payload)));
    req.emit("end");
  });
  return req as unknown as IncomingMessage;
}

describe("handleLogsBatch", () => {
  beforeEach(() => {
    getLogById.mockReset();
    resetProxyServerForApi();
    setProxyServerForApi({ getRole: () => "leader" } as never);
  });

  afterEach(() => {
    resetProxyServerForApi();
  });

  it("returns full logs for requested ids and skips missing ones", async () => {
    getLogById.mockImplementation((id: number) =>
      Promise.resolve(id === 2 ? null : { id, path: `/v1/${id}` })
    );
    const res = new MockServerResponse();
    await handleLogsBatch(postBody({ ids: [1, 2, 1, 3] }), res as unknown as ServerResponse);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as { logs: Array<{ id: number }> };
    expect(payload.logs.map(l => l.id)).toEqual([1, 3]);
    expect(getLogById).toHaveBeenCalledTimes(3);
  });

  it("rejects a non-array ids field", async () => {
    const res = new MockServerResponse();
    await handleLogsBatch(postBody({ ids: "1" }), res as unknown as ServerResponse);
    expect(res.statusCode).toBe(400);
  });

  it("caps the number of ids", async () => {
    getLogById.mockResolvedValue({ id: 1 });
    const ids = Array.from({ length: MAX_LOG_BATCH_IDS + 25 }, (_, i) => i + 1);
    const res = new MockServerResponse();
    await handleLogsBatch(postBody({ ids }), res as unknown as ServerResponse);
    expect(getLogById).toHaveBeenCalledTimes(MAX_LOG_BATCH_IDS);
  });
});
