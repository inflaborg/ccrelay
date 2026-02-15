/**
 * Integration Test: Task Timeout Cancellation
 *
 * Tests that verify task timeout and abort controller behavior:
 * 1. Task timeout returns 503 with error message
 * 2. Worker is released after timeout (no leak)
 * 3. New requests work after timeout (recovery)
 * 4. Concurrent timeouts handled correctly
 * 5. Task completing before timeout works normally
 */

/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import http from "http";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig, sleep } from "../utils";

describe("Integration: Task Timeout Cancellation", () => {
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

  describe("IT08: Task timeout and cancellation", () => {
    it("IT08-01: should timeout and return 503 when task exceeds timeout", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 300, // 300ms timeout
        }),
        proxyTimeout: 1,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock hanging response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "hanging" },
        delay: 60000, // 60 seconds
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(5000);

      // Task timeout should return 503 with timeout error message
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/timeout/i);
    });

    it("IT08-02: should release worker after timeout (no resource leak)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1, // Only 1 worker
          maxQueueSize: 10,
          timeout: 300,
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

      // Wait for timeout to occur (300ms timeout + buffer)
      await sleep(500);

      // Worker should be released
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);

      // Cleanup
      req.destroy();
    });

    it("IT08-03: should allow new requests after timeout (recovery)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1,
          maxQueueSize: 10,
          timeout: 300,
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

      // First request times out
      const res1 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "first" }] })
        .timeout(5000);

      expect(res1.status).toBe(503);

      // Wait for cleanup
      await sleep(200);

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

    it("IT08-04: should handle multiple concurrent timeouts without deadlock", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 3,
          maxQueueSize: 10,
          timeout: 300,
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

      // Start multiple concurrent requests
      const results = await Promise.allSettled([
        request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "1" }] })
          .timeout(5000),
        request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "2" }] })
          .timeout(5000),
        request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "3" }] })
          .timeout(5000),
      ]);

      // All should have timed out with 503
      for (const result of results) {
        if (result.status === "fulfilled") {
          expect(result.value.status).toBe(503);
        }
      }

      // Wait for cleanup
      await sleep(200);

      // All workers should be released (no leak)
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
    });

    it("IT08-05: should complete task that finishes before timeout (normal case)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 1000, // 1 second timeout
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock response that completes in 200ms (before 1s timeout)
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
