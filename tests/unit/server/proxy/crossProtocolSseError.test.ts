/* eslint-disable @typescript-eslint/naming-convention */
import * as http from "http";
import type { AddressInfo } from "net";
import { PassThrough } from "stream";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProxyExecutor } from "@/server/proxy/executor";
import { ResponseLogger } from "@/server/responseLogger";
import type { LogDatabase } from "@/database";
import type { ApiSurface, Provider, RequestTask } from "@/types";

const UPSTREAM_ERROR_SSE =
  'data: {"error":{"message":"webSearchEnabled is false","type":"invalid_request_error"}}\n\n';

function mockClientResponse(): http.ServerResponse & { written: string } {
  const pt = new PassThrough();
  const chunks: string[] = [];
  pt.on("data", (c: Buffer) => {
    chunks.push(c.toString());
  });
  const mock = pt as unknown as http.ServerResponse & { written: string };
  Object.defineProperty(mock, "written", {
    get: () => chunks.join(""),
    configurable: true,
  });
  Object.defineProperty(mock, "writableEnded", { value: false, writable: true });
  mock.writeHead = () => mock;
  return mock;
}

describe("ProxyExecutor cross-protocol SSE errors", () => {
  let mockUpstream: http.Server;
  let upstreamBaseUrl: string;
  let targetUrl: string;

  beforeEach(async () => {
    mockUpstream = http.createServer((_req, res) => {
      res.writeHead(400, { "Content-Type": "text/event-stream" });
      res.end(UPSTREAM_ERROR_SSE);
    });
    await new Promise<void>(resolve => mockUpstream.listen(0, "127.0.0.1", () => resolve()));
    const addr = mockUpstream.address() as AddressInfo;
    upstreamBaseUrl = `http://127.0.0.1:${addr.port}`;
    targetUrl = `${upstreamBaseUrl}/v1/chat/completions`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      mockUpstream.close(err => (err ? reject(err) : resolve()));
    });
  });

  async function executeWithSurface(
    clientSurface: ApiSurface,
    providerType: Provider["providerType"]
  ): Promise<{ result: Awaited<ReturnType<ProxyExecutor["execute"]>>; written: string }> {
    const clientRes = mockClientResponse();
    const provider: Provider = {
      id: "test-openai",
      name: "Test",
      baseUrl: upstreamBaseUrl,
      mode: "passthrough",
      providerType,
      headers: {},
    };

    const task: RequestTask = {
      id: "cross-sse-err",
      clientId: "cross-sse-err",
      method: "POST",
      targetUrl,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ model: "m", messages: [], stream: true })),
      provider,
      inboundPath: "/openai/responses",
      requestPath: "/v1/chat/completions",
      isOpenAIProvider: providerType !== "anthropic",
      clientSurface,
      responsesStreamRequested: clientSurface === "openai_responses",
      originalModel: "mimo-v2",
      res: clientRes,
      createdAt: Date.now(),
    };

    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);
    return { result, written: clientRes.written };
  }

  it("openai_responses client receives Responses SSE errors at upstream status (not 502)", async () => {
    const { result, written } = await executeWithSurface("openai_responses", "openai_chat");
    expect(result.statusCode).toBe(400);
    expect(result.errorMessage).toBe("webSearchEnabled is false");
    expect(written).toContain("event: error");
    expect(written).toContain("response.failed");
    expect(written).toContain("webSearchEnabled is false");
    expect(written).not.toContain("Cross-protocol conversion does not support streaming");
    expect(result.headers?.["content-type"]).toContain("text/event-stream");
  });

  it("openai chat client receives upstream Chat SSE error passthrough at upstream status", async () => {
    const { result, written } = await executeWithSurface("openai", "openai_chat");
    expect(result.statusCode).toBe(400);
    expect(written).toContain('"webSearchEnabled is false"');
    expect(written).toContain("data:");
    expect(written).not.toContain("Cross-protocol conversion does not support streaming");
  });

  it("anthropic client receives Anthropic SSE error + message_stop at upstream status", async () => {
    const { result, written } = await executeWithSurface("anthropic", "openai_chat");
    expect(result.statusCode).toBe(400);
    expect(written).toContain("event: error");
    expect(written).toContain("event: message_stop");
    expect(written).toContain("webSearchEnabled is false");
    expect(written).not.toContain("Cross-protocol conversion does not support streaming");
  });
});
