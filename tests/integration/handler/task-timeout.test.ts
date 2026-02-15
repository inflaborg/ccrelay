/**
 * Integration Test: Task Timeout and Client Disconnect
 *
 * Tests that verify task behavior:
 * 1. Queue timeout - task times out while waiting in queue
 * 2. Client disconnect handling - release worker when client disconnects
 * 3. Slow responses complete successfully (no execution timeout)
 *
 * IMPORTANT: Timeout Behavior:
 * - QUEUE TIMEOUT: Only applies while task is waiting in queue
 * - Once task starts executing, there is NO timeout from our side
 * - Execution relies entirely on upstream response or client disconnect
 */

/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import http from "http";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig, sleep } from "../utils";

describe("Integration: Task Timeout and Client Disconnect", () => {
  let testServer: TestServer;
  let mockProvider: MockProvider;

  afterEach(async () => {
    if (testServer) {
      await testServer.stop();
    }
    if (mockProvider) {
      await mockProvider.stop();
    }
  });

  describe("IT08: Queue timeout and client disconnect", () => {
    it("IT08-01: should complete slow response (no execution timeout)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 500, // 500ms queue timeout
        }),
        proxyTimeout: 10,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock slow response (2 seconds) - much longer than queue timeout
      // But since there's no queue, it should complete successfully
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "slow but completed" },
        delay: 2000,
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(10000);

      // Should complete successfully - no execution timeout
      expect(res.status).toBe(200);
      expect(res.body.content).toBe("slow but completed");
    });

    it("IT08-02: should release worker after client disconnect (no resource leak)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1, // Only 1 worker
          maxQueueSize: 10,
          timeout: 30000, // Long queue timeout (30 seconds)
        }),
        proxyTimeout: 30,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock hanging response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "hanging" },
        delay: 60000,
      });

      // Use raw HTTP for better control
      const url = new URL(`${testServer.baseUrl}/v1/messages`);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
      }, () => {});

      req.on("error", () => {}); // Suppress socket errors
      req.write(JSON.stringify({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] }));
      req.end();

      // Wait for request to reach upstream
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Verify worker is active
      const statsDuring = testServer.getQueueStats();
      expect(statsDuring.default?.activeWorkers).toBe(1);

      // Disconnect client
      req.destroy();

      // Wait for server to detect disconnect
      await sleep(500);

      // Worker should be released
      const statsAfter = testServer.getQueueStats();
      expect(statsAfter.default?.activeWorkers).toBe(0);
    });

    it("IT08-03: should allow new requests after client disconnect (recovery)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1,
          maxQueueSize: 10,
          timeout: 30000,
        }),
        proxyTimeout: 30,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock hanging response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "hanging" },
        delay: 60000,
      });

      // First request - disconnect mid-stream
      const url = new URL(`${testServer.baseUrl}/v1/messages`);
      const req1 = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
      }, () => {});

      req1.on("error", () => {});
      req1.write(JSON.stringify({ model: "claude-3-sonnet", messages: [{ role: "user", content: "first" }] }));
      req1.end();

      // Wait for request to reach upstream
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Disconnect client
      req1.destroy();

      // Wait for cleanup
      await sleep(500);

      // Verify worker released
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);

      // Reset mock for quick response
      mockProvider.reset();
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "success", id: "msg_123" },
        delay: 10,
      });

      // New request should succeed
      const res2 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "second" }] });

      expect(res2.status).toBe(200);
      expect(res2.body.content).toBe("success");
    });

    it("IT08-04: should handle multiple concurrent client disconnects without deadlock", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 3,
          maxQueueSize: 10,
          timeout: 30000,
        }),
        proxyTimeout: 30,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock hanging response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "hanging" },
        delay: 60000,
      });

      // Start multiple concurrent requests
      const url = new URL(`${testServer.baseUrl}/v1/messages`);
      const requests: http.ClientRequest[] = [];

      for (let i = 0; i < 3; i++) {
        const req = http.request({
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "test-key",
          },
        }, () => {});

        req.on("error", () => {});
        req.write(JSON.stringify({ model: "claude-3-sonnet", messages: [{ role: "user", content: String(i + 1) }] }));
        req.end();
        requests.push(req);
      }

      // Wait for all requests to reach upstream
      await sleep(500);

      // Verify workers are active
      const statsDuring = testServer.getQueueStats();
      expect(statsDuring.default?.activeWorkers).toBe(3);

      // Disconnect all clients
      for (const req of requests) {
        req.destroy();
      }

      // Wait for cleanup
      await sleep(500);

      // All workers should be released (no leak)
      const statsAfter = testServer.getQueueStats();
      expect(statsAfter.default?.activeWorkers).toBe(0);
    });

    it("IT08-05: should complete task that finishes quickly (normal case)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 1000, // 1 second queue timeout
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock response that completes in 200ms
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed", id: "msg_123" },
        delay: 200,
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      // Should complete normally
      expect(res.status).toBe(200);
      expect(res.body.content).toBe("completed");
    });
  });
});
