/**
 * Integration Test: Task Timeout Cancellation
 *
 * Tests that verify task timeout and abort controller behavior
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
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
    it("IT08-01: should timeout and return error when task exceeds timeout", async () => {
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

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/timeout/i);
    });

    it("IT08-02: should release worker after timeout", async () => {
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

      // Start request that will timeout
      await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(5000);

      // Wait for cleanup
      await sleep(100);

      // Worker should be released
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
    });

    it("IT08-03: should allow new requests after timeout", async () => {
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
      await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "first" }] })
        .timeout(5000);

      // Wait for cleanup
      await sleep(200);

      // Reset mock for quick response
      mockProvider.reset();
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "success", id: "msg_123" },
        delay: 10,
      });

      // New request should succeed
      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "second" }] });

      expect(res.status).toBe(200);
    });

    it("IT08-04: should handle multiple concurrent timeouts", async () => {
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

      // All should have timed out
      for (const result of results) {
        if (result.status === "fulfilled") {
          expect(result.value.status).toBe(503);
        }
      }

      // Wait for cleanup
      await sleep(200);

      // All workers should be released
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
    });

    it("IT08-05: should complete task that finishes before timeout", async () => {
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

      expect(res.status).toBe(200);
      expect(res.body.content).toBe("completed");
    });
  });
});
