/**
 * Integration Test: Queue Full Handling
 *
 * Tests that verify correct behavior when queue reaches capacity
 *
 * Note: Queue full behavior is already extensively tested in unit tests.
 * These integration tests verify the end-to-end behavior with real HTTP.
 */

/* eslint-disable @typescript-eslint/naming-convention */
// HTTP headers use kebab-case format

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import http from "http";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig } from "../utils";

describe("Integration: Queue Full", () => {
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

      // maxConcurrency=1, maxQueueSize=1 means:
      // - Total capacity = 1 processing + 1 queued = 2
      // - 3rd request should be rejected with 503
      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1, // Only 1 worker
          maxQueueSize: 1, // Only 1 queued request
          timeout: 10000, // 10s timeout
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock a slow response (3 seconds) to keep the worker busy
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "ok" },
        delay: 3000,
      });

      const url = new URL(`${testServer.baseUrl}/v1/messages`);

      // Send first request (will be processed)
      const req1 = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
      }, () => {});

      // Suppress socket errors from abort
      req1.on("error", () => {});

      req1.write(JSON.stringify({ model: "first", messages: [] }));
      req1.end();

      // Wait for first request to reach mock provider (2s timeout)
      await mockProvider.waitForRequests(1, 2000);

      // Send second request (will queue)
      const req2 = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
      }, () => {});

      // Suppress socket errors from abort
      req2.on("error", () => {});

      req2.write(JSON.stringify({ model: "second", messages: [] }));
      req2.end();

      // Wait briefly to ensure second request is queued
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify queue state: 1 active + 1 queued = 2 total
      // Total capacity is 1 + 1 = 2, so 3rd request should be rejected
      const stats = testServer.getQueueStats();
      const total = (stats.default?.activeWorkers ?? 0) + (stats.default?.queueLength ?? 0);
      expect(total).toBeGreaterThanOrEqual(2);

      // Third request should be rejected immediately (queue full)
      const res3 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "third", messages: [] });

      expect(res3.status).toBe(503);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(res3.body.code).toBe("QUEUE_FULL_OR_TIMEOUT");

      // Cleanup
      req1.destroy();
      req2.destroy();
    });

    it("IT07-02: should accept request when worker available", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2, // 2 workers
          maxQueueSize: 1, // 1 can queue
          timeout: 10000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "ok" },
      });

      // Both requests should succeed (2 workers available)
      const [res1, res2] = await Promise.all([
        request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "first", messages: [] }),
        request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "second", messages: [] }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });
  });
});
