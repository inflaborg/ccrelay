/**
 * Integration Test: Queue Full Handling
 *
 * Tests that verify correct behavior when queue reaches capacity
 *
 * Note: These tests are skipped due to timing issues with supertest and mock servers.
 * The queue full functionality is tested in unit tests.
 */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig, sleep } from "../utils";

describe.skip("Integration: Queue Full", () => {
  let testServer: TestServer;
  let mockProvider: MockProvider;

  afterEach(async () => {
    try {
      if (testServer) {
        await testServer.stop();
      }
    } catch {
      // Ignore errors during cleanup
    }
    try {
      if (mockProvider) {
        await mockProvider.stop();
      }
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe("IT07: Queue full rejection", () => {
    it("IT07-01: should reject request when queue is full", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      // maxConcurrency=1, maxQueueSize=2 means:
      // - Total capacity = 1 processing + 2 queued = 3
      // - 4th request should be rejected
      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1, // Only 1 worker
          maxQueueSize: 2, // Queue holds 2 (total capacity = 1+2=3)
          timeout: 60000, // Long timeout
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock a hanging response that never completes
      mockProvider.onHanging("/v1/messages", "POST");

      // First request occupies the worker (processing=1, queue=0)
      void request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .timeout(60000)
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "first" }] });

      await sleep(100);

      // Second request goes to queue (processing=1, queue=1)
      void request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .timeout(60000)
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "second" }] });

      // Third request goes to queue (processing=1, queue=2)
      void request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .timeout(60000)
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "third" }] });

      await sleep(200);

      // Fourth request should be rejected (1+2=3 >= 3)
      const res4 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "fourth" }] });

      // Should get 503
      expect(res4.status).toBe(503);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(res4.body.code).toBe("QUEUE_FULL_OR_TIMEOUT");
    });
  });
});
