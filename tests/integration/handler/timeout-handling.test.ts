/**
 * Integration Test: Timeout Handling
 *
 * Tests two distinct timeout scenarios:
 *
 * 1. QUEUE TIMEOUT: Task times out while waiting in queue
 *    - Upstream request is NOT sent (task rejected before execution)
 *    - Returns 503 with "waiting in queue" message
 *    - Only applies when queue is backed up
 *
 * 2. EXECUTION PHASE: Once task starts executing
 *    - No timeout from our side - relies entirely on:
 *      a) Upstream server response
 *      b) Client disconnection
 *    - This avoids complex timing issues
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import http from "http";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig, sleep } from "../utils";

describe("Integration: Timeout Handling", () => {
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

  describe("IT03-A: Queue Timeout (task times out while WAITING in queue)", () => {
    /**
     * Scenario: Queue Timeout
     * - maxWorkers: 1 (only one worker)
     * - task requestTimeout: 0.3ms (short)
     * - first request: takes 10 seconds
     * - second request: should timeout in queue after 300ms
     *
     * Verification:
     * 1. Second request returns 503
     * 2. Upstream NOT called for second request
     * 3. No resource leak
     */
    it("IT03-01: should timeout task waiting in queue (upstream NOT called)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1, // Only 1 worker
          maxQueueSize: 10,
          requestTimeout: 0.3, // 300ms queue timeout
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock very slow response (10 seconds) - longer than queue timeout
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "slow" },
        delay: 10000,
      });

      // First request occupies the only worker for 10 seconds
      const url = new URL(`${testServer.baseUrl}/v1/messages`);
      const req1 = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "test-key",
          },
        },
        () => {}
      );

      req1.on("error", () => {}); // Suppress socket errors
      req1.write(JSON.stringify({ model: "claude-3-sonnet", messages: [{ role: "user", content: "first" }] }));
      req1.end();

      // Wait for first request to reach upstream
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Track how many times upstream was called
      const upstreamCallCountBefore = mockProvider.getRequestCount("/v1/messages");

      // Second request should timeout while waiting in queue (300ms timeout)
      // First request takes 10s, so second will definitely timeout in queue
      const res2 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "second" }] })
        .timeout(5000);

      // 1. Should return 503
      expect(res2.status).toBe(503);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(res2.body.error).toMatch(/timeout/i);

      // 2. Upstream should NOT have been called for second request
      const upstreamCallCountAfter = mockProvider.getRequestCount("/v1/messages");
      expect(upstreamCallCountAfter).toBe(upstreamCallCountBefore);

      // 3. Wait for cleanup and verify no resource leak
      await sleep(100);
      const stats = testServer.getQueueStats();
      // First request still processing, second request timed out in queue
      expect(stats.default?.queueLength).toBe(0);

      // Cleanup
      req1.destroy();
    });

    it("IT03-02: should allow new requests after queue timeout scenario", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      // This test verifies that after handling a queue timeout scenario,
      // the system can still process new requests without resource leaks
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

      // Mock a slow response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "slow" },
        delay: 5000,
      });

      // First request occupies the worker
      const url = new URL(`${testServer.baseUrl}/v1/messages`);
      const req1 = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "test-key",
          },
        },
        () => {}
      );

      req1.on("error", () => {});
      req1.write(JSON.stringify({ model: "claude-3-sonnet", messages: [{ role: "user", content: "first" }] }));
      req1.end();

      // Wait for first request to reach upstream
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Second request times out in queue
      const res2 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "second" }] })
        .timeout(5000);

      // Should get 503 (queue timeout)
      expect(res2.status).toBe(503);

      // Cleanup first request
      req1.destroy();

      // Wait for cleanup
      await sleep(300);

      // Verify worker is released
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);

      // Reset mock for quick response
      mockProvider.reset();
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "quick" },
        delay: 10,
      });

      // New request should succeed - this is the key assertion
      const res3 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "new" }] });

      expect(res3.status).toBe(200);
    });
  });

  describe("IT03-B: Execution Phase (no timeout once executing)", () => {
    /**
     * Once task starts executing (request sent to upstream):
     * - NO timeout from our side
     * - Relies entirely on upstream response or client disconnect
     * - This test verifies slow upstream responses are handled correctly
     */

    it("IT03-03: should complete slow upstream response (no execution timeout)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 2,
          maxQueueSize: 10,
          requestTimeout: 0.5, // 500ms queue timeout
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock slow response (2 seconds) - much longer than queue timeout
      // But since there's no queue, it should complete successfully
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "slow but completed", id: "msg_123" },
        delay: 2000,
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(10000);

      // Should complete successfully - no execution timeout
      expect(res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(res.body.content).toBe("slow but completed");
    });

    it("IT03-04: should handle client disconnect during execution", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1,
          maxQueueSize: 10,
          requestTimeout: 1,
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

      // Use raw HTTP to have control over disconnect
      const url = new URL(`${testServer.baseUrl}/v1/messages`);
      const req1 = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "test-key",
          },
        },
        () => {}
      );

      req1.on("error", () => {});
      req1.write(JSON.stringify({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] }));
      req1.end();

      // Wait for request to reach upstream
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Verify worker is active
      const statsDuring = testServer.getQueueStats();
      expect(statsDuring.default?.activeWorkers).toBe(1);

      // Disconnect client
      req1.destroy();

      // Wait for server to detect disconnect
      await sleep(500);

      // Worker should be released after client disconnect
      const statsAfter = testServer.getQueueStats();
      expect(statsAfter.default?.activeWorkers).toBe(0);

      // Reset mock for quick response
      mockProvider.reset();
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "quick" },
        delay: 10,
      });

      // New request should work
      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "new" }] });

      expect(res.status).toBe(200);
    });
  });

  describe("IT03-C: Connection errors", () => {
    it("IT03-05: should return 502 on connection refused", async () => {
      // Use a non-existent URL to simulate connection refused
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1", // Invalid port - connection refused
        }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 2,
          maxQueueSize: 10,
          requestTimeout: 5,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(10000);

      // Connection refused should return 502 (Bad Gateway)
      expect(res.status).toBe(502);
    });
  });
});
