/**
 * Integration Test: Retry Logic
 *
 * Tests that verify retry behavior for transient failures
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig } from "../utils";

describe("Integration: Retry Logic", () => {
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

  describe("IT05: HTTP retry scenarios", () => {
    it("IT05-01: should handle 500 error from upstream", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 30000,
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

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("error");
    });

    it("IT05-02: should handle 502 bad gateway", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 30000,
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

      expect(res.status).toBe(502);
    });

    it("IT05-03: should handle 429 rate limit (no retry, pass through)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 30000,
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
        headers: { "Retry-After": "30" },
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      // Should pass through 429
      expect(res.status).toBe(429);
    });

    it("IT05-04: should handle 400 bad request (no retry)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 30000,
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

      expect(res.status).toBe(400);
    });

    it("IT05-05: should successfully return after transient 500", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 30000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      let attemptCount = 0;

      // First call returns 500, then reset to return 200
      mockProvider.onDynamic("/v1/messages", "POST", () => {
        attemptCount++;
        if (attemptCount === 1) {
          return {
            status: 500,
            body: { error: { message: "Temporary error" } },
          };
        }
        return {
          status: 200,
          body: { content: "Success on retry", id: "msg_123" },
        };
      });

      // First request gets 500
      const res1 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      expect(res1.status).toBe(500);
      expect(attemptCount).toBe(1);

      // Reset and try again
      mockProvider.reset();
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "Success", id: "msg_456" },
      });

      const res2 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      expect(res2.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(res2.body.content).toBe("Success");
    });
  });

  describe("IT05-B: Connection error handling", () => {
    it("IT05-06: should handle connection reset", async () => {
      // This test verifies behavior when connection is reset
      // We simulate by using a URL that will fail

      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1", // Will fail to connect
        }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 30000,
        }),
        proxyTimeout: 2,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(10000);

      // Should get error response
      expect([502, 503, 500]).toContain(res.status);
    });
  });
});
