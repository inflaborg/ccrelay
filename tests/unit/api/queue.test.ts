/**
 * Unit tests for api/queue.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { handleQueueStats, setServer } from "@/api/queue";
import type { QueueOverview } from "@/types";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

class MockIncomingMessage extends EventEmitter {
  url: string;
  method: string;

  constructor(url: string, method: string = "GET") {
    super();
    this.url = url;
    this.method = method;
  }
}

class MockServerResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) {
      this.headers = { ...this.headers, ...headers };
    }
    return this;
  }

  end(data?: string): this {
    if (data) {
      this.body += data;
    }
    this.emit("finish");
    return this;
  }
}

describe("api/queue", () => {
  beforeEach(() => {
    setServer(null as unknown as import("@/server/handler").ProxyServer);
  });

  it("returns 503 when server is not initialized", () => {
    const req = new MockIncomingMessage("/ccrelay/api/queue");
    const res = new MockServerResponse();

    handleQueueStats(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ error: "Server not available" });
  });

  it("returns queue overview when concurrency is enabled", () => {
    const overview: QueueOverview = {
      enabled: true,
      default: {
        queueLength: 2,
        activeWorkers: 1,
        maxWorkers: 3,
        maxQueueSize: 100,
        totalProcessed: 10,
        totalFailed: 1,
        avgWaitTime: 500,
        avgProcessTime: 2000,
        processingTasks: [{ id: "req-1", elapsed: 1200 }],
        queuedTasks: [{ id: "req-2", elapsed: 800 }],
      },
      routes: {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- route queue name from config
        count_tokens: {
          queueLength: 0,
          activeWorkers: 0,
          maxWorkers: 30,
          maxQueueSize: 1000,
          totalProcessed: 5,
          totalFailed: 0,
          avgWaitTime: 0,
          avgProcessTime: 100,
          processingTasks: [],
          queuedTasks: [],
        },
      },
    };

    setServer({
      getQueueOverview: () => overview,
    } as never);

    const req = new MockIncomingMessage("/ccrelay/api/queue");
    const res = new MockServerResponse();

    handleQueueStats(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(overview);
  });

  it("returns disabled overview when concurrency is off", () => {
    setServer({
      getQueueOverview: () => ({
        enabled: false,
        message: "Concurrency control is not enabled",
        routes: {},
      }),
    } as never);

    const req = new MockIncomingMessage("/ccrelay/api/queue");
    const res = new MockServerResponse();

    handleQueueStats(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      enabled: false,
      message: "Concurrency control is not enabled",
      routes: {},
    });
  });
});
