/* eslint-disable @typescript-eslint/naming-convention */
import * as http from "http";
import type { AddressInfo } from "net";
import { PassThrough } from "stream";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProxyExecutor } from "@/server/proxy/executor";
import { ResponseLogger } from "@/server/responseLogger";
import type { LogDatabase } from "@/database";
import type { Provider, RequestTask } from "@/types";

const RESPONSES_API_SSE_NO_DONE = [
  'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","status":"in_progress"},"sequence_number":0}\n\n',
  'event: response.in_progress\ndata: {"type":"response.in_progress","response":{"id":"resp_1","status":"in_progress"},"sequence_number":1}\n\n',
  'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":10,"output_tokens":5}},"sequence_number":2}\n\n',
];

function makeMockClientRes(): {
  res: http.ServerResponse & { written: string };
  emitClose: () => void;
  setWritableEnded: (v: boolean) => void;
} {
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
  let writableEndedFlag = false;
  Object.defineProperty(mock, "writableEnded", {
    get: () => writableEndedFlag,
    configurable: true,
  });
  Object.defineProperty(mock, "writableFinished", {
    get: () => writableEndedFlag,
    configurable: true,
  });
  mock.writeHead = () => mock;

  return {
    res: mock,
    emitClose: () => pt.emit("close"),
    setWritableEnded: (v: boolean) => {
      writableEndedFlag = v;
    },
  };
}

describe("ProxyExecutor SSE passthrough — false 499 regression", () => {
  let mockUpstream: http.Server;
  let upstreamBaseUrl: string;
  let targetUrl: string;

  beforeEach(async () => {
    mockUpstream = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const chunk of RESPONSES_API_SSE_NO_DONE) {
        res.write(chunk);
      }
      res.end();
    });
    await new Promise<void>(resolve => mockUpstream.listen(0, "127.0.0.1", () => resolve()));
    const addr = mockUpstream.address() as AddressInfo;
    upstreamBaseUrl = `http://127.0.0.1:${addr.port}`;
    targetUrl = `${upstreamBaseUrl}/v1/responses`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      mockUpstream.close(err => (err ? reject(err) : resolve()));
    });
  });

  function buildTask(clientRes: http.ServerResponse): RequestTask {
    const provider: Provider = {
      id: "azure-responses",
      name: "Azure",
      baseUrl: upstreamBaseUrl,
      mode: "passthrough",
      providerType: "openai",
      headers: {},
    };
    return {
      id: "false-499",
      clientId: "false-499",
      method: "POST",
      targetUrl,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ model: "gpt-5.4", input: "hi", stream: true })),
      provider,
      inboundPath: "/responses",
      requestPath: "/v1/responses",
      isOpenAIProvider: true,
      clientSurface: "openai_responses",
      originalModel: "gpt-5.4",
      res: clientRes,
      createdAt: Date.now(),
    };
  }

  it("client close after writableEnded (pipe finished) is ignored — recorded as 200", async () => {
    const { res: clientRes, emitClose, setWritableEnded } = makeMockClientRes();
    const task = buildTask(clientRes);

    // Simulate the production race deterministically: pipe has already flushed (writableEnded=true)
    // by the time the underlying socket reports `'close'`. The disconnect listener should
    // short-circuit and leave the request as a normal 200.
    setTimeout(() => {
      setWritableEnded(true);
      emitClose();
    }, 80);

    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);

    expect(result.statusCode).toBe(200);
    expect(result.errorMessage).toBeUndefined();
    expect(result.streamCompleted).toBe(true);
    expect(clientRes.written).toContain("response.completed");
  });

  it("normal completion (no client close) records as 200 with full response body", async () => {
    const { res: clientRes } = makeMockClientRes();
    const task = buildTask(clientRes);

    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);

    expect(result.statusCode).toBe(200);
    expect(result.errorMessage).toBeUndefined();
    expect(result.streamCompleted).toBe(true);
    expect(clientRes.written).toContain("response.completed");
  });
});

describe("ProxyExecutor SSE passthrough — terminal-then-abort recovery", () => {
  // Upstream sends `response.completed` then deliberately holds the FIN. The client closes
  // before upstream finishes its TCP teardown; without the terminal-marker check the abort
  // branch in setupErrorHandlers would mislabel the request as 499.
  let mockUpstream: http.Server;
  let upstreamBaseUrl: string;
  let targetUrl: string;
  let releaseUpstream: () => void = () => {};

  beforeEach(async () => {
    mockUpstream = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const chunk of RESPONSES_API_SSE_NO_DONE) {
        res.write(chunk);
      }
      // Hold the FIN until the test signals — this simulates Azure briefly delaying its
      // TCP teardown after the last SSE event.
      releaseUpstream = () => {
        try {
          res.end();
        } catch {
          /* socket may already be torn down */
        }
      };
    });
    await new Promise<void>(resolve => mockUpstream.listen(0, "127.0.0.1", () => resolve()));
    const addr = mockUpstream.address() as AddressInfo;
    upstreamBaseUrl = `http://127.0.0.1:${addr.port}`;
    targetUrl = `${upstreamBaseUrl}/v1/responses`;
  });

  afterEach(async () => {
    releaseUpstream();
    await new Promise<void>((resolve, reject) => {
      mockUpstream.close(err => (err ? reject(err) : resolve()));
    });
  });

  it("client aborting after response.completed records as 200 (not 499)", async () => {
    const { res: clientRes, emitClose } = makeMockClientRes();
    const provider: Provider = {
      id: "azure-responses",
      name: "Azure",
      baseUrl: upstreamBaseUrl,
      mode: "passthrough",
      providerType: "openai",
      headers: {},
    };

    const task: RequestTask = {
      id: "abort-after-terminal",
      clientId: "abort-after-terminal",
      method: "POST",
      targetUrl,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ model: "gpt-5.4", input: "hi", stream: true })),
      provider,
      inboundPath: "/responses",
      requestPath: "/v1/responses",
      isOpenAIProvider: true,
      clientSurface: "openai_responses",
      originalModel: "gpt-5.4",
      res: clientRes,
      createdAt: Date.now(),
    };

    // Wait long enough for all upstream chunks (incl. response.completed) to be received and
    // marked, then trigger client close. Upstream is still holding the FIN.
    setTimeout(() => emitClose(), 80);

    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);

    // Allow upstream to release its FIN so its socket cleans up.
    releaseUpstream();

    expect(result.statusCode).toBe(200);
    expect(result.errorMessage).toBeUndefined();
    expect(result.streamCompleted).toBe(true);
  });
});
