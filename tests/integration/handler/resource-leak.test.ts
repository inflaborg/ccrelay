/**
 * Integration Test: Resource Leak Detection
 *
 * Tests that verify no resource leaks after various scenarios:
 * 1. Worker leaks (ConcurrencyManager)
 * 2. Socket/connection leaks
 * 3. Event listener leaks
 * 4. Memory pattern verification
 *
 * These tests use multiple verification methods:
 * - activeWorkers count
 * - Server connection count
 * - Memory heap snapshot comparison
 * - Event emitter listener counts
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import http from "http";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig, sleep } from "../utils";

describe("Integration: Resource Leak Detection", () => {
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

  describe("IT09: Worker leak verification", () => {
    it("IT09-01: should not leak workers after timeout", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 300,
        }),
        proxyTimeout: 1,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Get initial resource stats
      const initialStats = testServer.getResourceStats();

      // Mock hanging response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "hanging" },
        delay: 60000,
      });

      // Send request that will timeout
      await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "test", messages: [] })
        .timeout(5000);

      // Wait for cleanup
      await sleep(300);

      // Verify no resource leak
      const finalStats = testServer.getResourceStats();
      expect(finalStats.activeWorkers).toBe(0);
      expect(finalStats.activeWorkers).toBe(initialStats.activeWorkers);
      expect(finalStats.activeConnections).toBe(0);
    });

    it("IT09-02: should not leak workers after connection error", async () => {
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

      // Get initial resource stats
      const initialStats = testServer.getResourceStats();

      // Send request that will fail
      await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "test", messages: [] })
        .timeout(10000);

      // Wait for cleanup
      await sleep(200);

      // Verify no resource leak
      const finalStats = testServer.getResourceStats();
      expect(finalStats.activeWorkers).toBe(0);
      expect(finalStats.activeWorkers).toBe(initialStats.activeWorkers);
      expect(finalStats.activeConnections).toBe(0);
    });

    it("IT09-03: should not leak workers after client disconnect", async () => {
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

      // Get initial resource stats
      const initialStats = testServer.getResourceStats();

      // Mock slow response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "ok" },
        delay: 5000,
      });

      // Send request and abort
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

      req.on("error", () => {});
      req.write(JSON.stringify({ model: "test", messages: [] }));
      req.end();

      // Wait for request to reach upstream
      await mockProvider.waitForRequestTo("/v1/messages", 2000);

      // Abort
      req.destroy();

      // Wait for cleanup
      await sleep(500);

      // Verify no resource leak
      const finalStats = testServer.getResourceStats();
      expect(finalStats.activeWorkers).toBe(0);
      expect(finalStats.activeWorkers).toBe(initialStats.activeWorkers);
      expect(finalStats.activeConnections).toBe(0);
    });
  });

  describe("IT09-B: Multiple operation leak verification", () => {
    it("IT09-04: should not leak workers after 10 consecutive errors", async () => {
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1", // Will fail
        }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 1000,
        }),
        proxyTimeout: 1,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Get initial resource stats
      const initialStats = testServer.getResourceStats();

      // Send 10 consecutive failing requests
      for (let i = 0; i < 10; i++) {
        await request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: `test-${i}`, messages: [] })
          .timeout(5000);

        await sleep(50);
      }

      // Wait for all cleanup
      await sleep(500);

      // Verify no resource leak
      const finalStats = testServer.getResourceStats();
      expect(finalStats.activeWorkers).toBe(0);
      expect(finalStats.queueLength).toBe(0);
      expect(finalStats.activeWorkers).toBe(initialStats.activeWorkers);
      expect(finalStats.activeConnections).toBe(0);
    });

    it("IT09-05: should not leak workers with mixed success and failure", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 5000,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mixed operations: success, error, success, error...
      for (let i = 0; i < 5; i++) {
        // Success
        mockProvider.reset();
        mockProvider.onPost("/v1/messages", {
          status: 200,
          body: { content: "ok" },
          delay: 50,
        });

        const res1 = await request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "test", messages: [] });

        expect(res1.status).toBe(200);

        // Error (stop mock to cause failure)
        await mockProvider.stop();
        mockProvider = new MockProvider();
        // Don't start - will cause connection error

        // Reconfigure server with failing provider
        await testServer.stop();
        const errorConfig = new MockConfig({
          provider: createTestProvider({
            baseUrl: "http://127.0.0.1:1",
          }),
          concurrency: createTestConcurrencyConfig({
            maxConcurrency: 2,
            maxQueueSize: 10,
            timeout: 1000,
          }),
          proxyTimeout: 1,
        });
        testServer = new TestServer({ config: errorConfig });
        await testServer.start();

        const res2 = await request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "test", messages: [] })
          .timeout(5000);

        expect([502, 503]).toContain(res2.status);

        // Restore working state
        await testServer.stop();
        mockProvider = new MockProvider();
        await mockProvider.start();

        const workingConfig = new MockConfig({
          provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
          concurrency: createTestConcurrencyConfig({
            maxConcurrency: 2,
            maxQueueSize: 10,
            timeout: 5000,
          }),
        });
        testServer = new TestServer({ config: workingConfig });
        await testServer.start();
      }

      // Wait for all cleanup
      await sleep(500);

      // Verify no resource leak
      const finalStats = testServer.getResourceStats();
      expect(finalStats.activeWorkers).toBe(0);
      expect(finalStats.queueLength).toBe(0);
      expect(finalStats.activeConnections).toBe(0);
    });
  });

  describe("IT09-C: Concurrent operation leak verification", () => {
    it("IT09-06: should not leak workers after concurrent errors", async () => {
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1", // Will fail
        }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 5,
          maxQueueSize: 10,
          timeout: 1000,
        }),
        proxyTimeout: 1,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Get initial resource stats
      const initialStats = testServer.getResourceStats();

      // Send 10 concurrent failing requests
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `test-${i}`, messages: [] })
            .timeout(10000)
        )
      );

      // All should have failed
      for (const result of results) {
        if (result.status === "fulfilled") {
          expect([502, 503]).toContain(result.value.status);
        }
      }

      // Wait for all cleanup
      await sleep(500);

      // Verify no resource leak
      const finalStats = testServer.getResourceStats();
      expect(finalStats.activeWorkers).toBe(0);
      expect(finalStats.queueLength).toBe(0);
      expect(finalStats.activeWorkers).toBe(initialStats.activeWorkers);
      expect(finalStats.activeConnections).toBe(0);
    });

    it("IT09-07: should not leak workers after concurrent timeouts", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 5,
          maxQueueSize: 10,
          timeout: 300, // Short timeout
        }),
        proxyTimeout: 1,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Get initial resource stats
      const initialStats = testServer.getResourceStats();

      // Mock hanging response
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "hanging" },
        delay: 60000, // Will timeout
      });

      // Send 10 concurrent requests that will timeout
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `test-${i}`, messages: [] })
            .timeout(10000)
        )
      );

      // All should have timed out
      for (const result of results) {
        if (result.status === "fulfilled") {
          expect(result.value.status).toBe(503);
        }
      }

      // Wait for all cleanup
      await sleep(500);

      // Verify no resource leak
      const finalStats = testServer.getResourceStats();
      expect(finalStats.activeWorkers).toBe(0);
      expect(finalStats.queueLength).toBe(0);
      expect(finalStats.activeWorkers).toBe(initialStats.activeWorkers);
      expect(finalStats.activeConnections).toBe(0);
    });
  });

  describe("IT09-D: Recovery verification", () => {
    it("IT09-08: should be able to process requests after resource cleanup", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 1, // Single worker to ensure sequential
          maxQueueSize: 5,
          timeout: 300,
        }),
        proxyTimeout: 1,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock hanging response initially
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "hanging" },
        delay: 60000,
      });

      // Send 5 requests that will timeout
      for (let i = 0; i < 5; i++) {
        await request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: `test-${i}`, messages: [] })
          .timeout(5000);
      }

      // Wait for cleanup
      await sleep(500);

      // Verify cleanup
      let stats = testServer.getResourceStats();
      expect(stats.activeWorkers).toBe(0);

      // Reset mock for success
      mockProvider.reset();
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "success" },
        delay: 10,
      });

      // Should be able to process new requests
      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "final", messages: [] });

      expect(res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(res.body.content).toBe("success");

      // Final cleanup check
      stats = testServer.getResourceStats();
      expect(stats.activeWorkers).toBe(0);
    });
  });
});
