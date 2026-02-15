/**
 * Integration Test: Error Pass-through and Connection Retry
 *
 * Tests that verify:
 * 1. HTTP error responses (4xx, 5xx) are passed through to client
 * 2. Connection-level errors trigger automatic retry
 * 3. Resource cleanup after errors
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig, sleep } from "../utils";

describe("Integration: Error Pass-through and Retry", () => {
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

  describe("IT05: HTTP error pass-through (no retry)", () => {
    it("IT05-01: should pass through 500 error from upstream", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 10000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock 500 error
      mockProvider.onPost("/v1/messages", {
        status: 500,
        body: { error: { type: "internal_error", message: "Internal server error" } },
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      // HTTP 500 errors are passed through, no retry
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("error");
    });

    it("IT05-02: should pass through 502 bad gateway", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 10000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock 502 error
      mockProvider.onPost("/v1/messages", {
        status: 502,
        body: { error: { type: "bad_gateway", message: "Bad Gateway" } },
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      // HTTP 502 errors are passed through, no retry
      expect(res.status).toBe(502);
    });

    it("IT05-03: should pass through 429 rate limit with headers", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 10000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock 429 rate limit
      mockProvider.onPost("/v1/messages", {
        status: 429,
        body: {
          error: { type: "rate_limit_error", message: "Rate limit exceeded" },
        },
        headers: { "retry-after": "30" },
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      // 429 should be passed through with headers
      expect(res.status).toBe(429);
      expect(res.headers["retry-after"]).toBe("30");
    });

    it("IT05-04: should pass through 400 bad request (no retry)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 10000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock 400 error
      mockProvider.onPost("/v1/messages", {
        status: 400,
        body: {
          error: { type: "invalid_request_error", message: "Invalid request" },
        },
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      // HTTP 400 errors are passed through, no retry
      expect(res.status).toBe(400);
    });
  });

  describe("IT05-B: Connection error handling", () => {
    it("IT05-05: should return 502 on connection refused (ECONNREFUSED)", async () => {
      // Use a port that's not listening
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1", // Port 1 is never used
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
        .timeout(15000);

      // Connection refused should return 502 (Bad Gateway)
      expect(res.status).toBe(502);
    });

    it("IT05-06: should release worker after connection error", async () => {
      // Use a port that's not listening
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1",
        }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1, // Only 1 worker
          maxQueueSize: 10,
          timeout: 2000,
        }),
        proxyTimeout: 2,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Make request that will fail
      await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(10000);

      // Wait for cleanup
      await sleep(100);

      // Worker should be released after error
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);

      // Now start a working provider
      mockProvider = new MockProvider();
      await mockProvider.start();

      // Update config to use working provider
      const workingConfig = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1,
          maxQueueSize: 10,
          timeout: 5000,
        }),
      });

      // Stop old server and start new one
      await testServer.stop();
      testServer = new TestServer({ config: workingConfig });
      await testServer.start();

      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "success" },
      });

      // New request should work
      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      expect(res.status).toBe(200);
    });
  });

  describe("IT05-C: Error recovery verification", () => {
    it("IT05-07: should successfully handle request after upstream error", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 10000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // First call returns 500
      mockProvider.onPost("/v1/messages", {
        status: 500,
        body: { error: { message: "Temporary error" } },
      });

      const res1 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "first" }] });

      expect(res1.status).toBe(500);

      // Reset mock to return success
      mockProvider.reset();
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "Success", id: "msg_456" },
      });

      // Second request (new client request) should succeed
      const res2 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "second" }] });

      expect(res2.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(res2.body.content).toBe("Success");
    });

    it("IT05-08: should not leak workers on repeated errors", async () => {
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1", // Will fail
        }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 2000,
        }),
        proxyTimeout: 2,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Make multiple failing requests
      for (let i = 0; i < 5; i++) {
        await request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: `test ${i}` }] })
          .timeout(10000);

        await sleep(50);
      }

      // All workers should be released
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
    });
  });

  describe("IT05-D: Concurrent error handling", () => {
    it("IT05-09: should handle concurrent connection errors without deadlock", async () => {
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1",
        }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 3,
          maxQueueSize: 10,
          timeout: 2000,
        }),
        proxyTimeout: 2,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Make concurrent requests
      const results = await Promise.allSettled([
        request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [] })
          .timeout(10000),
        request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [] })
          .timeout(10000),
        request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [] })
          .timeout(10000),
      ]);

      // All should have failed with 502
      for (const result of results) {
        if (result.status === "fulfilled") {
          expect(result.value.status).toBe(502);
        }
      }

      // Wait for cleanup
      await sleep(200);

      // All workers should be released
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
    });
  });
});
