/**
 * Integration Test: Client Disconnect Scenarios
 *
 * Tests that verify correct handling of client disconnection
 * during different phases of request processing:
 * 1. Client abort during slow response → worker released
 * 2. After disconnect, next request processed normally
 * 3. Multiple requests: one completes, queued one still processes
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import http from "http";
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

  describe("IT01: Client disconnect detection", () => {
    it("IT01-01: should detect client abort during slow response and release worker", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 2,
          maxQueueSize: 10,
          requestTimeout: 10,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock a slow response (3 seconds)
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "ok" },
        delay: 3000,
      });

      // Create a raw HTTP client to have more control
      const url = new URL(`${testServer.baseUrl}/v1/messages`);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
      };

      // Send request
      const req = http.request(options, () => {
        // We'll abort before this is called
      });

      // Suppress socket errors from abort
      req.on("error", () => {});

      req.write(JSON.stringify({ model: "test", messages: [] }));
      req.end();

      // Wait for request to reach mock provider
      const requestState = await mockProvider.waitForRequestTo("/v1/messages", 2000);
      expect(requestState.state).toBe("responding");

      // Verify worker is active
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBeGreaterThanOrEqual(1);

      // Abort the request
      req.destroy();

      // Wait for disconnect to be detected
      const disconnectedState = await mockProvider.waitForClientDisconnect(2000);
      expect(disconnectedState.clientConnected).toBe(false);

      // Worker should be freed after disconnect
      await sleep(200);
      const statsAfter = testServer.getQueueStats();
      expect(statsAfter.default?.activeWorkers).toBe(0);
    });

    it("IT01-02: should process next request normally after client disconnect", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1, // Only 1 at a time
          maxQueueSize: 10,
          requestTimeout: 10,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock slow response (2 seconds)
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "ok" },
        delay: 2000,
      });

      // First request using raw HTTP
      const url1 = new URL(`${testServer.baseUrl}/v1/messages`);
      const req1 = http.request({
        hostname: url1.hostname,
        port: url1.port,
        path: url1.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
      }, () => {});

      // Suppress socket errors from abort
      req1.on("error", () => {});

      req1.write(JSON.stringify({ model: "test", messages: [] }));
      req1.end();

      // Wait for first request to reach upstream
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Verify one worker active
      const stats1 = testServer.getQueueStats();
      expect(stats1.default?.activeWorkers).toBe(1);

      // Abort first request
      req1.destroy();
      await mockProvider.waitForClientDisconnect(2000);

      // Wait for worker to be released
      await sleep(200);
      const statsAfterDisconnect = testServer.getQueueStats();
      expect(statsAfterDisconnect.default?.activeWorkers).toBe(0);

      // Reset mock for quick response
      mockProvider.reset();
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "second success" },
        delay: 10,
      });

      // Second request should succeed
      const res2 = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "test", messages: [] });

      expect(res2.status).toBe(200);
    });

    it("IT01-03: should queue and process second request while first is processing", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1,
          maxQueueSize: 10,
          requestTimeout: 10,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock slow but completing response (500ms)
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "ok" },
        delay: 500,
      });

      // First request using raw HTTP
      const url1 = new URL(`${testServer.baseUrl}/v1/messages`);
      const req1Promise = new Promise<void>((resolve) => {
        const req1 = http.request({
          hostname: url1.hostname,
          port: url1.port,
          path: url1.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "test-key",
          },
        }, () => resolve());

        // Suppress socket errors
        req1.on("error", () => {});

        req1.write(JSON.stringify({ model: "first", messages: [] }));
        req1.end();
      });

      // Wait for first request to reach upstream
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Verify queue state - one worker active
      const stats1 = testServer.getQueueStats();
      expect(stats1.default?.activeWorkers).toBe(1);

      // Second request using raw HTTP (to have more control)
      const req2Promise = new Promise<void>((resolve) => {
        const req2 = http.request({
          hostname: url1.hostname,
          port: url1.port,
          path: url1.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "test-key",
          },
        }, () => resolve());

        req2.on("error", () => {});
        req2.write(JSON.stringify({ model: "second", messages: [] }));
        req2.end();
      });

      // Wait briefly for second to queue
      await sleep(100);

      // Verify second is queued
      const statsWithQueue = testServer.getQueueStats();
      expect(statsWithQueue.default?.queueLength).toBeGreaterThanOrEqual(1);

      // Wait for first to complete
      await req1Promise;

      // Second should also complete
      await req2Promise;

      // Both should have been processed
      expect(mockProvider.getReceivedRequestCount()).toBe(2);
    });
  });

  describe("IT01-B: Resource cleanup verification", () => {
    it("IT01-04: should release worker after client disconnect (no leak)", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1,
          maxQueueSize: 10,
          requestTimeout: 10,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock slow response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "ok" },
        delay: 5000,
      });

      const url = new URL(`${testServer.baseUrl}/v1/messages`);

      // Make and abort multiple requests
      for (let i = 0; i < 3; i++) {
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

        req.on("error", () => {});
        req.write(JSON.stringify({ model: `test-${i}`, messages: [] }));
        req.end();

        // Wait for request to reach upstream
        await mockProvider.waitForRequestTo("/v1/messages", 2000);

        // Abort
        req.destroy();
        await mockProvider.waitForClientDisconnect(2000);
        await sleep(100);

        // Reset for next iteration
        mockProvider.reset();
        mockProvider.onPost("/v1/messages", {
          status: 200,
          body: { content: "ok" },
          delay: 5000,
        });
      }

      // All workers should be released
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
    });
  });
});
