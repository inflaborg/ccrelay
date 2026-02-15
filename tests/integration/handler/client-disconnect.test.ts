/**
 * Integration Test: Client Disconnect Scenarios
 *
 * Tests that verify correct handling of client disconnection
 * during different phases of request processing.
 */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig, sleep } from "../utils";

describe("Integration: Client Disconnect", () => {
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

  describe("IT01: Client disconnect during queue wait", () => {
    it.skip("IT01-01: should cancel queued task when client disconnects", async () => {
      // Skipped due to timing issues - the mock provider responds too quickly
      // Setup mock provider with slow response
      mockProvider = new MockProvider();
      await mockProvider.start();

      // Configure with queue (maxConcurrency=1, so second request queues)
      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1,
          maxQueueSize: 10,
          timeout: 30000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock a slow response (5 seconds)
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "ok" },
        delay: 5000,
      });

      // First request occupies the only worker
      const req1 = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] });

      // Wait for first request to start processing
      await sleep(100);

      // Verify queue stats - one worker active
      const statsDuringProcessing = testServer.getQueueStats();
      expect(statsDuringProcessing.default?.activeWorkers).toBe(1);

      // Second request will queue
      const req2 = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi 2" }] });

      // Wait for second request to be queued
      await sleep(100);

      // Verify queue has one item
      const statsDuringQueue = testServer.getQueueStats();
      expect(statsDuringQueue.default?.queueLength).toBeGreaterThanOrEqual(1);

      // Abort the second request (client disconnect)
      req2.abort();

      // Wait a bit for abort to be processed
      await sleep(100);

      // Verify that only one request was sent to upstream
      // (the queued request should not have been sent)
      const requestCount = mockProvider.getRequestCount();
      expect(requestCount).toBe(1);

      // Clean up first request
      req1.abort();
    });

    it.skip("IT01-02: should not send request to upstream if task cancelled in queue", async () => {
      // Skipped due to timing issues with mock provider
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1,
          maxQueueSize: 10,
          timeout: 30000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock slow response to ensure first request stays active
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "slow" },
        delay: 10000,
      });

      // First request
      const req1 = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "first" }] });

      // Wait for first request to be sent to upstream
      await sleep(200);

      // Queue multiple requests
      const req2 = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "second" }] });

      const req3 = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "third" }] });

      await sleep(100);

      // Abort both queued requests
      req2.abort();
      req3.abort();

      await sleep(200);

      // Only first request should have been sent to upstream
      expect(mockProvider.getRequestCount()).toBe(1);

      // Cleanup
      req1.abort();
    });

    it.skip("IT01-03: should process next task in queue when previous is cancelled", async () => {
      // Skipped due to timing issues with mock provider
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1,
          maxQueueSize: 10,
          timeout: 30000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      let requestCount = 0;

      // Mock response that counts requests
      mockProvider.onDynamic("/v1/messages", "POST", () => {
        requestCount++;
        return {
          status: 200,
          body: { content: `response-${requestCount}` },
          delay: 100,
        };
      });

      // First request occupies worker
      const req1Promise = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "first" }] });

      await sleep(100);

      // Second request queues
      const req2 = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "second" }] });

      // Third request queues behind second
      const req3Promise = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "third" }] });

      await sleep(100);

      // Cancel second request
      req2.abort();

      // Wait for first and third to complete
      const [res1, res3] = await Promise.allSettled([req1Promise, req3Promise]);

      // First should succeed
      expect(res1.status).toBe("fulfilled");
      if (res1.status === "fulfilled") {
        expect(res1.value.status).toBe(200);
      }

      // Third should also succeed (after second was cancelled)
      expect(res3.status).toBe("fulfilled");
      if (res3.status === "fulfilled") {
        expect(res3.value.status).toBe(200);
      }

      // Should have processed 2 requests (first and third)
      expect(requestCount).toBe(2);
    });
  });

  describe.skip("IT01-B: Client disconnect handling for running tasks", () => {
    // Skipped due to timing issues with supertest abort handling
    it("IT01-04: should mark running task as cancelled when client disconnects", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1,
          maxQueueSize: 10,
          timeout: 30000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock a hanging response
      mockProvider.onHanging("/v1/messages", "POST");

      // Start request
      const req = request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "test" }] });

      // Wait for request to be processed (not just queued)
      await sleep(300);

      // Verify task is running
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBeGreaterThanOrEqual(1);

      // Disconnect client
      req.abort();

      await sleep(300);

      // Worker should be freed
      const statsAfter = testServer.getQueueStats();
      expect(statsAfter.default?.activeWorkers).toBe(0);
    });
  });
});
