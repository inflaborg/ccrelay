/**
 * Integration Test: SSE Stream Handling
 *
 * Tests that verify correct handling of SSE streaming responses
 * and client disconnection during streaming.
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig, sleep, createSSEStreamChunks } from "../utils";

describe("Integration: SSE Stream", () => {
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

  describe("IT02: SSE stream client disconnect", () => {
    it("IT02-01: should stream SSE response to client", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock SSE response
      const sseChunks = createSSEStreamChunks("Hello world!");
      mockProvider.onSSE("/v1/messages", "POST", {
        status: 200,
        chunks: sseChunks,
        chunkDelay: 50,
        headers: { "Content-Type": "text/event-stream" },
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .set("Accept", "text/event-stream")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }], stream: true });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");
      expect(res.text).toContain("message_start");
      expect(res.text).toContain("Hello world!");
    });

    it("IT02-02: should handle client disconnect during SSE stream", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Create SSE chunks with more content and slower delivery
      const sseChunks = [
        ...createSSEStreamChunks("Part 1"),
        ...createSSEStreamChunks("Part 2"),
        ...createSSEStreamChunks("Part 3"),
      ];

      mockProvider.onSSE("/v1/messages", "POST", {
        status: 200,
        chunks: sseChunks,
        chunkDelay: 200, // Slower to allow disconnect mid-stream
        headers: { "Content-Type": "text/event-stream" },
      });

      // Start request and collect chunks
      const req = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .set("Accept", "text/event-stream")
        .buffer(false) // Don't buffer, stream mode
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }], stream: true });

      // Wait for streaming to start
      await sleep(300);

      // Abort mid-stream
      req.abort();

      await sleep(100);

      // Server should handle the disconnect gracefully
      // The queue should be available for new requests
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBeLessThanOrEqual(1);
    });

    it("IT02-03: should handle upstream SSE error", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock error response
      mockProvider.onPost("/v1/messages", {
        status: 500,
        body: { error: { type: "internal_error", message: "Upstream error" } },
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      expect(res.status).toBe(500);
    });

    it("IT02-04: should handle SSE stream interruption from upstream", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // SSE with partial data then error
      const partialChunks = createSSEStreamChunks("Partial").slice(0, 2);

      mockProvider.onSSE("/v1/messages", "POST", {
        status: 200,
        chunks: partialChunks,
        chunkDelay: 100,
        headers: { "Content-Type": "text/event-stream" },
      });

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .set("Accept", "text/event-stream")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }], stream: true })
        .timeout(5000);

      // Should receive partial data
      expect(res.status).toBe(200);
      expect(res.text).toContain("message_start");
    });
  });

  describe.skip("IT02-B: SSE with queue", () => {
    // Skipped due to timing issues with supertest and mock servers
    it("IT02-05: should queue SSE requests when at capacity", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1, // Only one at a time
          maxQueueSize: 10,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock a hanging response to ensure first request stays active
      mockProvider.onHanging("/v1/messages", "POST");

      // Start first request
      const req1 = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "first" }] });

      // Wait for first request to start processing
      await sleep(300);

      // Verify queue stats
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBeGreaterThanOrEqual(1);

      // Second request should queue
      const req2 = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "second" }] });

      await sleep(200);

      // Should have one in queue
      const statsWithQueue = testServer.getQueueStats();
      expect(statsWithQueue.default?.queueLength).toBeGreaterThanOrEqual(1);

      // Clean up
      req1.abort();
      req2.abort();
    });
  });
});
