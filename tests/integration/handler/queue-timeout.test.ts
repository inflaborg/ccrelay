/**
 * Integration Test: Queue Timeout and Task Cleanup
 *
 * Tests that verify correct handling of tasks that timeout while waiting in queue.
 *
 * IMPORTANT: Timeout Behavior:
 * - QUEUE TIMEOUT: Only applies while task is waiting in queue
 * - Once task starts executing (request sent to upstream), there is NO timeout
 * - Execution relies entirely on:
 *   1. Upstream server response
 *   2. Client disconnection detection
 *
 * Key verification points:
 * - Tasks timing out in queue should return 503 to client
 * - Upstream should NOT be called for queue-timed-out tasks
 * - No resource leaks after mass timeout scenarios
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import http from "http";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig, sleep } from "../utils";

describe("Integration: Queue Timeout and Task Cleanup", () => {
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

  describe("IT10: Task timeout while waiting in queue", () => {
    it("IT10-01: should return 503 when task times out in queue (upstream NOT called)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1, // Only 1 worker
          maxQueueSize: 5,
          requestTimeout: 0.3, // 300ms queue timeout
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock very slow response (will block the single worker)
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "slow" },
        delay: 10000, // 10 seconds - much longer than queue timeout
      });

      // First request occupies the worker for 10 seconds
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
      req1.write(JSON.stringify({ model: "first", messages: [] }));
      req1.end();

      // Wait for first request to reach upstream
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Track upstream calls before second request
      const upstreamCountBefore = mockProvider.getRequestCount("/v1/messages");

      // Second request will queue and should timeout while waiting
      const res2 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "second", messages: [] })
        .timeout(5000);

      // Should get 503 (timeout while waiting in queue)
      expect(res2.status).toBe(503);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(res2.body.error).toMatch(/timeout/i);

      // Upstream should NOT have been called for second request
      const upstreamCountAfter = mockProvider.getRequestCount("/v1/messages");
      expect(upstreamCountAfter).toBe(upstreamCountBefore);

      // Cleanup
      req1.destroy();
    });

    it("IT10-02: should properly release worker after queue timeout", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1,
          maxQueueSize: 10,
          requestTimeout: 0.3, // 300ms queue timeout
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock slow response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "slow" },
        delay: 10000, // 10 seconds
      });

      // First request occupies worker
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
      req1.write(JSON.stringify({ model: "first", messages: [] }));
      req1.end();

      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Get initial stats - first worker should be active
      const statsBefore = testServer.getResourceStats();
      expect(statsBefore.activeWorkers).toBe(1);

      // Send second request (will queue and timeout)
      const res2 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "second", messages: [] })
        .timeout(5000);

      expect(res2.status).toBe(503);

      // Cleanup first request
      req1.destroy();

      // Wait for full cleanup
      await sleep(300);

      // Now worker should be released
      const finalStats = testServer.getResourceStats();
      expect(finalStats.activeWorkers).toBe(0);
      expect(finalStats.queueLength).toBe(0);
    });

    it("IT10-03: should handle multiple tasks timing out and cleanup resources", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1,
          maxQueueSize: 20,
          requestTimeout: 0.3, // 300ms queue timeout
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock slow response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "slow" },
        delay: 10000, // 10 seconds
      });

      // First request occupies worker
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
      req1.write(JSON.stringify({ model: "first", messages: [] }));
      req1.end();

      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Send 5 requests that will queue and timeout
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `queued-${i}`, messages: [] })
            .timeout(5000)
        )
      );

      // All queued requests should timeout with 503
      let timeoutCount = 0;
      for (const result of results) {
        if (result.status === "fulfilled") {
          expect(result.value.status).toBe(503);
          timeoutCount++;
        }
      }
      expect(timeoutCount).toBe(5);

      // Cleanup first request
      req1.destroy();

      // Wait for cleanup
      await sleep(500);

      // Verify queue is empty and workers released
      const stats = testServer.getResourceStats();
      expect(stats.queueLength).toBe(0);
      expect(stats.activeWorkers).toBe(0);
    });
  });

  describe("IT11: Proxy timeout (upstream hanging, client disconnect)", () => {
    /**
     * Once task starts executing:
     * - NO timeout from our side
     * - Relies on upstream response or client disconnect
     * - proxyTimeout is for connection-level issues, not execution timeout
     */
    it("IT11-01: should handle upstream hanging via client disconnect", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 2,
          maxQueueSize: 10,
          requestTimeout: 30, // Long queue timeout (30 seconds)
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock hanging response - sends headers but never completes
      mockProvider.onHanging("/v1/messages", "POST");

      // Use raw HTTP to control disconnect
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

      req.on("error", () => {});
      req.write(JSON.stringify({ model: "test", messages: [] }));
      req.end();

      // Wait for request to reach upstream
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Verify worker is active
      const statsDuring = testServer.getResourceStats();
      expect(statsDuring.activeWorkers).toBe(1);

      // Disconnect client to release the hanging request
      req.destroy();

      // Wait for cleanup
      await sleep(500);

      // Verify worker released
      const statsAfter = testServer.getResourceStats();
      expect(statsAfter.activeWorkers).toBe(0);
    });

    it("IT11-02: should release worker after client disconnect", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1,
          maxQueueSize: 10,
          requestTimeout: 30,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock very slow response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "hanging" },
        delay: 60000,
      });

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

      req.on("error", () => {});
      req.write(JSON.stringify({ model: "test", messages: [] }));
      req.end();

      // Wait for request to reach upstream
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Verify worker is active
      const statsBefore = testServer.getResourceStats();
      expect(statsBefore.activeWorkers).toBe(1);

      // Disconnect client
      req.destroy();

      // Wait for cleanup
      await sleep(300);

      // Verify worker released
      const statsAfter = testServer.getResourceStats();
      expect(statsAfter.activeWorkers).toBe(0);
    });
  });

  describe("IT12: Queue full with mass accumulation", () => {
    it("IT12-01: should handle queue full scenario with timeouts", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1,
          maxQueueSize: 2, // Small queue
          requestTimeout: 0.3, // 300ms queue timeout
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock slow response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "slow" },
        delay: 10000,
      });

      const url = new URL(`${testServer.baseUrl}/v1/messages`);

      // First request occupies worker
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
      req1.write(JSON.stringify({ model: "first", messages: [] }));
      req1.end();

      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Send requests to fill queue + overflow
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `overflow-${i}`, messages: [] })
            .timeout(5000)
        )
      );

      // All should have received 503 (either queue full or timeout)
      let errorCount = 0;
      for (const result of results) {
        if (result.status === "fulfilled") {
          expect(result.value.status).toBe(503);
          errorCount++;
        }
      }
      expect(errorCount).toBe(5);

      // Wait for cleanup
      await sleep(300);

      // Verify queue is empty
      const stats = testServer.getResourceStats();
      expect(stats.queueLength).toBe(0);

      // Cleanup
      req1.destroy();
    });

    it("IT12-02: should recover after queue full + timeout scenario", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1,
          maxQueueSize: 2,
          requestTimeout: 0.3,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Phase 1: Fill up and cause timeouts
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "slow" },
        delay: 10000,
      });

      const url = new URL(`${testServer.baseUrl}/v1/messages`);

      // First request
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
      req1.write(JSON.stringify({ model: "first", messages: [] }));
      req1.end();

      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Send overflow requests
      await Promise.allSettled(
        Array.from({ length: 4 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `overflow-${i}`, messages: [] })
            .timeout(5000)
        )
      );

      // Wait for all to complete/timeout
      await sleep(500);

      // Cleanup first request
      req1.destroy();
      await sleep(300);

      // Phase 2: Verify recovery
      mockProvider.reset();
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "recovered" },
        delay: 10,
      });

      // New request should succeed
      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "recovery", messages: [] });

      expect(res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(res.body.content).toBe("recovered");

      // Final cleanup check
      const stats = testServer.getResourceStats();
      expect(stats.activeWorkers).toBe(0);
      expect(stats.queueLength).toBe(0);
    });
  });
});
