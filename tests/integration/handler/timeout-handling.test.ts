/**
 * Integration Test: Timeout Handling
 *
 * Tests that verify correct handling of various timeout scenarios
 * including connection timeout, request timeout, and queue timeout.
 */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
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

  describe("IT03: Upstream server connection timeout", () => {
    it("IT03-01: should return 504 on upstream timeout (hanging response)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      // Short timeout for testing (500ms)
      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 500, // 500ms timeout
        }),
        proxyTimeout: 1, // 1 second proxy timeout
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock a response that never completes
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "never sent" },
        delay: 60000, // 60 seconds - will timeout
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(5000);

      // Should get 503 (queue timeout) or 504 (proxy timeout)
      expect([503, 504]).toContain(res.status);
    });

    it("IT03-02: should handle slow but completing response", async () => {
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

      // Mock a slow but completing response (200ms)
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
    });
  });

  describe("IT04: Socket timeout (request sent, no response)", () => {
    it("IT04-01: should handle connection refused", async () => {
      // Use a non-existent URL to simulate connection refused
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1", // Invalid port - connection refused
        }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 30000,
        }),
        proxyTimeout: 5,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(10000);

      // Should get an error response (502 or 503)
      expect([502, 503, 500]).toContain(res.status);
    });

    it("IT04-02: should release worker after timeout", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1, // Only 1 worker
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

      // Now mock quick response
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
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      expect(res.status).toBe(200);
    });
  });

  describe("IT03-B: Queue timeout", () => {
    it("IT03-03: should timeout task waiting in queue too long", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1,
          maxQueueSize: 10,
          timeout: 500, // 500ms timeout (includes queue wait time)
        }),
        proxyTimeout: 10,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock very slow response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "slow" },
        delay: 5000,
      });

      // First request occupies worker for 5 seconds
      const req1 = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "first" }] });

      await sleep(50);

      // Second request should timeout while waiting in queue
      // (queue timeout is shorter than first request duration)
      const res2 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "second" }] })
        .timeout(5000);

      // Should get 503 (queue timeout)
      expect(res2.status).toBe(503);

      // Cleanup
      req1.abort();
    });
  });
});
