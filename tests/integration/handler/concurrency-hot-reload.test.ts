/**
 * Integration Test: Concurrency hot reload
 */

/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import * as http from "http";
import type { AddressInfo } from "net";
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import type { ConfigManager } from "@/config";
import { QueueManager } from "@/server/queueManager";
import { resolveInboundClientSurface } from "@/server/request/apiSurfaceDetector";
import type { ConcurrencyConfig, Provider, ProxyResult, RequestTask } from "@/types";
import { MockProvider } from "../fixtures";
import { createTestConcurrencyConfig, createTestProvider } from "../utils";

class QueueHotReloadHarness {
  private server: http.Server | null = null;
  private readonly state: {
    concurrency: ConcurrencyConfig | undefined;
    provider: Provider;
  };
  private readonly queueManager: QueueManager;
  private readonly upstreamBaseUrl: string;

  constructor(concurrency: ConcurrencyConfig | undefined, provider: Provider) {
    this.state = { concurrency, provider };
    this.upstreamBaseUrl = provider.baseUrl;
    const state = this.state;
    const configManager = {
      get configValue() {
        return {
          concurrency: state.concurrency,
          routeQueues: [],
        };
      },
      get routeQueues() {
        return [];
      },
    } as unknown as ConfigManager;
    this.queueManager = new QueueManager(configManager);
    this.queueManager.setExecutor(task => this.executeProxyRequest(task));
  }

  reloadConcurrency(concurrency: ConcurrencyConfig | undefined): void {
    this.state.concurrency = concurrency;
    this.queueManager.reloadFromConfig();
  }

  getQueueStats() {
    return this.queueManager.getDefaultQueue()?.getStats() ?? null;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res).catch(err => {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });

      this.server.listen(0, "127.0.0.1", () => resolve());
      this.server.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    this.queueManager.getDefaultQueue()?.shutdown();
    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(err => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  get baseUrl(): string {
    if (!this.server) {
      throw new Error("Server not started");
    }
    const port = (this.server.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}`;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = req.url ?? "/";
    const method = req.method ?? "GET";
    const body = await this.readBody(req);
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : (v ?? "")])
    );

    const queueInfo = this.queueManager.getQueueForPath(path);
    const provider = this.state.provider;
    const clientSurface = resolveInboundClientSurface(method, path, provider);

    const task: RequestTask = {
      id: `it-${Date.now()}`,
      method,
      targetUrl: `${this.upstreamBaseUrl}${path}`,
      headers,
      body,
      provider,
      inboundPath: path,
      requestPath: path,
      requestBodyLog: "",
      originalRequestBody: "",
      isOpenAIProvider: provider.providerType === "openai",
      clientSurface,
      clientId: "integration-client",
      createdAt: Date.now(),
      res,
    };

    if (!queueInfo) {
      const result = await this.executeProxyRequest(task);
      this.sendProxyResult(res, result);
      return;
    }

    const result = await queueInfo.queue.submit(task);
    this.sendProxyResult(res, result);
  }

  private sendProxyResult(res: http.ServerResponse, result: ProxyResult): void {
    if (res.writableEnded) {
      return;
    }
    if (result.error) {
      res.writeHead(result.statusCode >= 400 ? result.statusCode : 502, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ error: result.errorMessage ?? result.error.message }));
      return;
    }
    res.writeHead(result.statusCode, { "Content-Type": "application/json" });
    const payload =
      typeof result.body === "string"
        ? result.body
        : result.body
          ? result.body.toString("utf-8")
          : "{}";
    res.end(payload);
  }

  private readBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(Buffer.from(chunk)));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  private async executeProxyRequest(task: RequestTask): Promise<ProxyResult> {
    const start = Date.now();
    const requestBody = task.body ?? Buffer.alloc(0);
    const response = await fetch(task.targetUrl, {
      method: task.method,
      headers: task.headers,
      body: requestBody.length > 0 ? requestBody : undefined,
    });
    const text = await response.text();
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: text,
      duration: Date.now() - start,
    };
  }
}

describe("Integration: Concurrency hot reload", () => {
  let mockProvider: MockProvider;
  let harness: QueueHotReloadHarness;

  afterEach(async () => {
    if (harness) {
      await harness.stop();
    }
    if (mockProvider) {
      await mockProvider.stop();
    }
  });

  it("IT14-01: should process a second request in parallel after maxWorkers hot reload", async () => {
    mockProvider = new MockProvider();
    await mockProvider.start();

    const taskDuration = 1000;
    mockProvider.onPost("/v1/messages", {
      status: 200,
      body: { content: "completed" },
      delay: taskDuration,
    });

    const provider = createTestProvider({ baseUrl: mockProvider.baseUrl });
    harness = new QueueHotReloadHarness(
      createTestConcurrencyConfig({
        maxWorkers: 1,
        maxQueueSize: 10,
        requestTimeout: 30,
      }),
      provider
    );
    await harness.start();

    const req1Promise = fetch(`${harness.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "test-key",
      },
      body: JSON.stringify({ model: "test-1", messages: [] }),
    });

    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const stats = harness.getQueueStats();
        if (stats?.activeWorkers === 1) {
          resolve();
        } else if (Date.now() - start > 5000) {
          reject(new Error(`Timed out waiting for active worker. Stats: ${JSON.stringify(stats)}`));
        } else {
          setTimeout(check, 25);
        }
      };
      check();
    });

    harness.reloadConcurrency(
      createTestConcurrencyConfig({
        maxWorkers: 2,
        maxQueueSize: 10,
        requestTimeout: 30,
      })
    );

    const startTime = Date.now();
    const req2 = request(harness.baseUrl)
      .post("/v1/messages")
      .set("x-api-key", "test-key")
      .send({ model: "test-2", messages: [] })
      .timeout(30000);

    const [res1, res2] = await Promise.all([
      req1Promise.then(async r => ({
        status: r.status,
        body: await r.json(),
      })),
      req2,
    ]);
    const totalTime = Date.now() - startTime;

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body).toEqual({ content: "completed" });

    // Sequential would be ~2s; parallel after reload should finish closer to ~1s.
    expect(totalTime).toBeLessThan(taskDuration * 1.8);
    expect(totalTime).toBeGreaterThanOrEqual(taskDuration - 150);
  });
});
