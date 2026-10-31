/* eslint-disable @typescript-eslint/naming-convention */
import * as http from "http";
import type { AddressInfo } from "net";
import { PassThrough } from "stream";
import { describe, it, expect, afterEach } from "vitest";
import { ProxyExecutor } from "@/server/proxy/executor";
import { ResponseLogger } from "@/server/responseLogger";
import type { LogDatabase } from "@/database";
import type { ApiSurface, Provider, RequestTask } from "@/types";

type MockClientRes = http.ServerResponse & { written: string; ended: boolean };

function mockClientResponse(): MockClientRes {
  const pt = new PassThrough();
  const chunks: string[] = [];
  pt.on("data", (c: Buffer) => {
    chunks.push(c.toString());
  });
  const mock = pt as unknown as MockClientRes;
  const headers: Record<string, unknown> = {};
  let headersSent = false;
  let ended = false;
  Object.defineProperty(mock, "written", { get: () => chunks.join(""), configurable: true });
  Object.defineProperty(mock, "ended", { get: () => ended, configurable: true });
  Object.defineProperty(mock, "headersSent", { get: () => headersSent, configurable: true });
  Object.defineProperty(mock, "writableEnded", { get: () => ended, configurable: true });
  mock.writeHead = ((_status: number, h?: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(h ?? {})) {
      headers[k.toLowerCase()] = v;
    }
    headersSent = true;
    return mock;
  }) as unknown as typeof mock.writeHead;
  mock.getHeader = ((name: string) => headers[name.toLowerCase()]) as typeof mock.getHeader;
  const origEnd = pt.end.bind(pt);
  mock.end = ((...args: unknown[]) => {
    ended = true;
    return (origEnd as (...a: unknown[]) => unknown)(...args);
  }) as typeof mock.end;
  return mock;
}

describe("ProxyExecutor upstream idle timeout", () => {
  let upstream: http.Server | null = null;
  const openSockets = new Set<import("net").Socket>();

  afterEach(async () => {
    for (const s of openSockets) {
      s.destroy();
    }
    openSockets.clear();
    if (upstream) {
      await new Promise<void>(resolve => upstream!.close(() => resolve()));
      upstream = null;
    }
  });

  async function startUpstream(handler: http.RequestListener): Promise<string> {
    upstream = http.createServer(handler);
    upstream.on("connection", s => {
      openSockets.add(s);
      s.on("close", () => openSockets.delete(s));
    });
    await new Promise<void>(resolve => upstream!.listen(0, "127.0.0.1", () => resolve()));
    const addr = upstream.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}`;
  }

  function buildTask(
    baseUrl: string,
    clientSurface: ApiSurface,
    providerType: Provider["providerType"],
    res: http.ServerResponse
  ): RequestTask {
    const provider: Provider = {
      id: "slow-upstream",
      name: "Slow",
      baseUrl,
      mode: "inject",
      providerType,
      headers: {},
    };
    return {
      id: "idle-timeout",
      clientId: "idle-timeout",
      method: "POST",
      targetUrl: `${baseUrl}/v1/messages`,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ model: "m", messages: [], stream: true })),
      provider,
      inboundPath: "/v1/messages",
      requestPath: "/v1/messages",
      isOpenAIProvider: providerType !== "anthropic",
      clientSurface,
      originalModel: "claude-sonnet",
      res,
      createdAt: Date.now(),
    };
  }

  function executor(timeoutMs: number): ProxyExecutor {
    const db = { enabled: false } as unknown as LogDatabase;
    const ex = new ProxyExecutor(new ResponseLogger(db));
    ex.setUpstreamTimeoutProvider(() => timeoutMs);
    return ex;
  }

  it("returns 504 in the client protocol when upstream never sends headers", async () => {
    const baseUrl = await startUpstream(() => {
      // never respond
    });
    const clientRes = mockClientResponse();
    const started = Date.now();
    const result = await executor(150).execute(
      buildTask(baseUrl, "anthropic", "anthropic", clientRes)
    );

    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.statusCode).toBe(504);
    expect(result.streamed).toBeFalsy();
    expect(result.errorMessage).toContain("Upstream idle timeout");
    const body = JSON.parse(String(result.body)) as { type: string; error: { message: string } };
    expect(body.type).toBe("error");
    expect(body.error.message).toContain("slow-upstream");
  });

  it("uses the OpenAI error shape for OpenAI clients", async () => {
    const baseUrl = await startUpstream(() => {
      // never respond
    });
    const clientRes = mockClientResponse();
    const result = await executor(150).execute(
      buildTask(baseUrl, "openai", "openai_chat", clientRes)
    );
    expect(result.statusCode).toBe(504);
    const body = JSON.parse(String(result.body)) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_timeout");
  });

  it("appends an SSE error frame and ends the stream when upstream stalls mid-stream", async () => {
    const baseUrl = await startUpstream((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","content":[],"model":"x","usage":{"input_tokens":1,"output_tokens":0}}}\n\n'
      );
      // then stall forever
    });
    const clientRes = mockClientResponse();
    const result = await executor(200).execute(
      buildTask(baseUrl, "anthropic", "anthropic", clientRes)
    );

    expect(result.statusCode).toBe(504);
    expect(result.streamed).toBe(true);
    expect(clientRes.ended).toBe(true);
    expect(clientRes.written).toContain("message_start");
    expect(clientRes.written).toContain("event: error");
    expect(clientRes.written).toContain("Upstream idle timeout");
  });

  it("does not time out when disabled (0) and upstream eventually responds", async () => {
    const baseUrl = await startUpstream((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }, 250);
    });
    const clientRes = mockClientResponse();
    const result = await executor(0).execute(
      buildTask(baseUrl, "anthropic", "anthropic", clientRes)
    );
    expect(result.statusCode).toBe(200);
  });
});
