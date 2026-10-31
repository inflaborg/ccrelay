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

const CHAT_COMPLETION = {
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 1,
  model: "upstream-model",
  choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
};

function chatChunk(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-2",
    object: "chat.completion.chunk",
    model: "upstream-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

describe("ProxyExecutor OpenAI Chat 200 SSE → Anthropic client", () => {
  let mockUpstream: http.Server;
  let upstreamBaseUrl: string;
  let upstreamBody = "";

  beforeEach(async () => {
    mockUpstream = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(upstreamBody);
    });
    await new Promise<void>(resolve => mockUpstream.listen(0, "127.0.0.1", () => resolve()));
    const addr = mockUpstream.address() as AddressInfo;
    upstreamBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      mockUpstream.close(err => (err ? reject(err) : resolve()));
    });
  });

  async function execute(
    streamRequested: boolean
  ): Promise<{ result: Awaited<ReturnType<ProxyExecutor["execute"]>>; written: string }> {
    const clientRes = mockClientResponse();
    const task: RequestTask = {
      id: "chat-sse-200",
      clientId: "chat-sse-200",
      method: "POST",
      targetUrl: `${upstreamBaseUrl}/v1/chat/completions`,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ model: "m", messages: [], stream: streamRequested })),
      provider: {
        id: "test-openai",
        name: "Test",
        baseUrl: upstreamBaseUrl,
        mode: "inject",
        providerType: "openai_chat",
        headers: {},
      },
      inboundPath: "/v1/messages",
      requestPath: "/v1/chat/completions",
      isOpenAIProvider: true,
      clientSurface: "anthropic",
      ...(streamRequested ? { streamRequested: true } : {}),
      originalModel: "claude-sonnet",
      res: clientRes,
      createdAt: Date.now(),
    };
    const db = { enabled: false } as unknown as LogDatabase;
    const result = await new ProxyExecutor(new ResponseLogger(db)).execute(task);
    return { result, written: clientRes.written };
  }

  it("converts a full chat.completion sent as a data: line into an Anthropic message (issue #152)", async () => {
    upstreamBody = `data: ${JSON.stringify(CHAT_COMPLETION)}\n\ndata: [DONE]\n\n`;
    const { result } = await execute(false);

    expect(result.statusCode).toBe(200);
    expect(result.headers?.["content-type"]).toBe("application/json");
    const body = JSON.parse(String(result.body)) as Record<string, unknown>;
    expect(body.type).toBe("message");
    expect(body.model).toBe("claude-sonnet");
    expect(body.content).toEqual([{ type: "text", text: "hello" }]);
    expect(String(result.body)).not.toContain("event: error");
  });

  it("converts a bare chat.completion JSON labelled as text/event-stream", async () => {
    upstreamBody = JSON.stringify(CHAT_COMPLETION);
    const { result } = await execute(false);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(String(result.body)) as Record<string, unknown>;
    expect(body.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("aggregates chunk deltas when the client did not ask for a stream", async () => {
    upstreamBody =
      chatChunk({ role: "assistant", content: "hel" }) +
      chatChunk({ content: "lo" }) +
      chatChunk({}, "stop") +
      "data: [DONE]\n\n";
    const { result } = await execute(false);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(String(result.body)) as Record<string, unknown>;
    expect(body.content).toEqual([{ type: "text", text: "hello" }]);
    expect(body.stop_reason).toBe("end_turn");
  });

  it("relays chunk deltas live as Anthropic SSE when the client streams", async () => {
    upstreamBody =
      chatChunk({ role: "assistant", content: "hel" }) +
      chatChunk({ content: "lo" }) +
      chatChunk({}, "stop") +
      "data: [DONE]\n\n";
    const { result, written } = await execute(true);

    expect(result.statusCode).toBe(200);
    expect(result.streamed).toBe(true);
    expect(result.streamCompleted).toBe(true);
    expect(written).toContain("event: message_start");
    expect(written).toContain('"text_delta","text":"hel"');
    expect(written).toContain('"text_delta","text":"lo"');
    expect(written).toContain("event: message_stop");
    expect(written).not.toContain("event: error");
  });
});
