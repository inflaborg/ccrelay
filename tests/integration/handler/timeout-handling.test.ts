/**
 * Integration Test: Timeout Handling
 *
 * Tests two distinct timeout scenarios:
 *
 * 1. QUEUE TIMEOUT: Task times out while waiting in queue
 *    - Upstream request is NOT sent (task rejected before execution)
 *    - Returns 503 with "waiting in queue" message
 *    - Worker is NOT acquired
 *
 * 2. EXECUTION TIMEOUT: Task times out during execution
 *    - Upstream request HAS been sent
 *    - Returns 503 with timeout message
 *    - Worker is released after timeout
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
     * - maxConcurrency: 1 (only one worker)
     * - task timeout: 300ms (short)
     * - first request: takes 10 seconds
     * - second request: should timeout in queue after 300ms
     *
     * Verification:
     * 1. Second request returns 503
     * 2. Error message indicates "waiting in queue"
     * 3. Upstream NOT called for second request
     * 4. No resource leak (workers released)
     */
    it("IT03-01: should timeout task waiting in queue (upstream NOT called)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1, // Only 1 worker
          maxQueueSize: 10,
          timeout: 300, // 300ms queue timeout
        }),
        proxyTimeout: 30, // Long proxy timeout (don't trigger execution timeout)
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

    it("IT03-02: should release worker after queue timeout and allow new requests", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1,
          maxQueueSize: 10,
          timeout: 300, // 300ms queue timeout
        }),
        proxyTimeout: 30,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock slow response for first request
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

      // Wait for first request to start
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Second request times out in queue
      await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "second" }] })
        .timeout(5000);

      // Cleanup first request
      req1.destroy();
      await sleep(200);

      // Reset mock for quick response
      mockProvider.reset();
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "quick" },
        delay: 10,
      });

      // New request should succeed
      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "new" }] });

      expect(res.status).toBe(200);
    });
  });

  describe("IT03-B: Execution Timeout (task times out DURING execution)", () => {
    /**
     * Scenario: Execution Timeout
     * - maxConcurrency: 1
     * - task timeout: 500ms
     * - upstream response: hangs for 60 seconds
     * - request should timeout after 500ms during execution
     *
     * Verification:
     * 1. Returns 503 with timeout message
     * 2. Upstream WAS called (execution started)
     * 3. Worker is released (no leak)
     * 4. New requests work after timeout
     */
    it("IT03-03: should timeout task during execution (upstream WAS called)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 500, // 500ms execution timeout
        }),
        proxyTimeout: 1,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock hanging response (60 seconds - will trigger execution timeout)
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "hanging" },
        delay: 60000,
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(5000);

      // 1. Should return 503 with timeout
      expect(res.status).toBe(503);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(res.body.error).toMatch(/timeout/i);

      // 2. Upstream WAS called (execution started)
      const upstreamCallCount = mockProvider.getRequestCount("/v1/messages");
      expect(upstreamCallCount).toBeGreaterThanOrEqual(1);

      // 3. Worker should be released (no leak)
      await sleep(100);
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
    });

    it("IT03-04: should release worker after execution timeout and allow new requests", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1,
          maxQueueSize: 10,
          timeout: 300, // 300ms execution timeout
        }),
        proxyTimeout: 1,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock hanging response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "hanging" },
        delay: 60000,
      });

      // Use raw HTTP to have control over timing
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
      req1.write(JSON.stringify({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] }));
      req1.end();

      // Wait for request to reach upstream (execution started)
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Wait for execution timeout to occur (300ms timeout + buffer)
      await sleep(500);

      // Worker should be released
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);

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

      // Cleanup
      req1.destroy();
    });
  });

  describe("IT03-C: Slow but completing response", () => {
    it("IT03-05: should handle slow but completing response (no timeout)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 5000, // 5 second timeout
        }),
        proxyTimeout: 10,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock a slow but completing response (200ms - well within 5s timeout)
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed", id: "msg_123" },
        delay: 200,
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      expect(res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(res.body.content).toBe("completed");
    });
  });

  describe("IT03-D: Connection errors", () => {
    it("IT03-06: should return 502 on connection refused", async () => {
      // Use a non-existent URL to simulate connection refused
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1", // Invalid port - connection refused
        }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 5000,
        }),
        proxyTimeout: 3,
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
