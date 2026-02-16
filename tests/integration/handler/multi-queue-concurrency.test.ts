/**
 * Integration Test: Multi-Queue Concurrency
 *
 * Tests that verify default queue and route queues work independently:
 * 1. Default queue and route queue process tasks concurrently (not blocking each other)
 * 2. Each queue has its own concurrency limit
 * 3. Tasks in different queues don't compete for the same worker pool
 *
 * The key insight: Default queue and route queues are SEPARATE worker pools.
 * If we have 5 tasks in default queue (5 concurrency) and 5 tasks in route queue (5 concurrency),
 * total time should be ~1 round, not ~2 rounds.
 */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig } from "../utils";

describe("Integration: Multi-Queue Concurrency", () => {
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

  describe("IT15: Default and Route queue isolation", () => {
    it("IT15-01: should process default and route queue tasks concurrently", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const taskDuration = 1000; // 1 second per task
      const defaultConcurrency = 5;
      const routeConcurrency = 5;
      const defaultTasks = 5;
      const routeTasks = 5;

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: defaultConcurrency,
          maxQueueSize: 20,
          requestTimeout: 30,
        }),
        routeQueues: [
          {
            name: "route-queue",
            pattern: "^/route/.*",
            maxWorkers: routeConcurrency,
            maxQueueSize: 20,
            requestTimeout: 30,
          },
        ],
      });

      testServer = new TestServer({ config });
      await testServer.start();

      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });
      // Route queue uses /route/messages path
      mockProvider.onPost("/route/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });

      // If queues are independent:
      // - Default queue: 5 tasks / 5 concurrency = 1 round = 1s
      // - Route queue: 5 tasks / 5 concurrency = 1 round = 1s
      // Both run in parallel, so total time should be ~1s (plus overhead)
      //
      // If queues were NOT independent (shared workers):
      // - Total: 10 tasks / 5 concurrency = 2 rounds = 2s

      const startTime = Date.now();

      // Send 5 tasks to default queue (/v1/messages doesn't match route pattern)
      const defaultPromises = Promise.all(
        Array.from({ length: defaultTasks }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `default-${i}`, messages: [] })
            .timeout(60000)
        )
      );

      // Send 5 tasks to route queue (/route/... matches route pattern)
      const routePromises = Promise.all(
        Array.from({ length: routeTasks }, (_, i) =>
          request(testServer.baseUrl)
            .post("/route/messages")
            .set("x-api-key", "test-key")
            .send({ model: `route-${i}`, messages: [] })
            .timeout(60000)
        )
      );

      // Wait for all to complete
      const [defaultResults, routeResults] = await Promise.all([
        defaultPromises,
        routePromises,
      ]);

      const totalTime = Date.now() - startTime;

      // All tasks should complete successfully
      for (const result of defaultResults) {
        expect(result.status).toBe(200);
      }
      for (const result of routeResults) {
        expect(result.status).toBe(200);
      }

      // Verify total time shows parallel processing between queues
      // Expected: ~1s (both queues process in parallel)
      // If sequential: would be ~2s
      expect(totalTime).toBeLessThan(taskDuration * 1.3); // 1.3s max (30% overhead)
      expect(totalTime).toBeGreaterThan(taskDuration * 0.8); // At least 0.8s

      console.log(
        `IT15-01: ${defaultTasks} default + ${routeTasks} route tasks took ${totalTime}ms ` +
          `(expected ~${taskDuration}ms if parallel, ~${taskDuration * 2}ms if sequential)`
      );

      // Verify final state
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
      expect(stats.routes["route-queue"]?.activeWorkers).toBe(0);
    });

    it("IT15-02: should maintain separate concurrency limits for each queue", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const taskDuration = 1500; // Long enough to observe peak
      const defaultConcurrency = 3;
      const routeConcurrency = 2;

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: defaultConcurrency,
          maxQueueSize: 20,
          requestTimeout: 30,
        }),
        routeQueues: [
          {
            name: "route-queue",
            pattern: "^/route/.*",
            maxWorkers: routeConcurrency,
            maxQueueSize: 20,
            requestTimeout: 30,
          },
        ],
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Track peak workers for each queue
      let peakDefaultWorkers = 0;
      let peakRouteWorkers = 0;
      const sampleInterval = setInterval(() => {
        const stats = testServer.getQueueStats();
        if (stats.default && stats.default.activeWorkers > peakDefaultWorkers) {
          peakDefaultWorkers = stats.default.activeWorkers;
        }
        if (stats.routes["route-queue"] && stats.routes["route-queue"].activeWorkers > peakRouteWorkers) {
          peakRouteWorkers = stats.routes["route-queue"].activeWorkers;
        }
      }, 50);

      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });
      mockProvider.onPost("/route/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });

      // Send 5 tasks to default queue
      const defaultPromises = Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `default-${i}`, messages: [] })
            .timeout(60000)
        )
      );

      // Send 4 tasks to route queue
      const routePromises = Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/route/messages")
            .set("x-api-key", "test-key")
            .send({ model: `route-${i}`, messages: [] })
            .timeout(60000)
        )
      );

      const [defaultResults, routeResults] = await Promise.all([
        defaultPromises,
        routePromises,
      ]);

      clearInterval(sampleInterval);

      // All tasks should complete
      for (const result of defaultResults) {
        expect(result.status).toBe(200);
      }
      for (const result of routeResults) {
        expect(result.status).toBe(200);
      }

      // Verify peak workers don't exceed configured limits
      expect(peakDefaultWorkers).toBeLessThanOrEqual(defaultConcurrency);
      expect(peakRouteWorkers).toBeLessThanOrEqual(routeConcurrency);

      // Verify we actually hit the limits (queues are being used)
      expect(peakDefaultWorkers).toBe(defaultConcurrency);
      expect(peakRouteWorkers).toBe(routeConcurrency);

      console.log(
        `IT15-02: Peak workers - default: ${peakDefaultWorkers}/${defaultConcurrency}, ` +
          `route: ${peakRouteWorkers}/${routeConcurrency}`
      );
    });

    it("IT15-03: should handle multiple route queues independently", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const taskDuration = 800;
      const defaultConcurrency = 2;
      const route1Concurrency = 3;
      const route2Concurrency = 2;

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: defaultConcurrency,
          maxQueueSize: 20,
          requestTimeout: 30,
        }),
        routeQueues: [
          {
            name: "route-a",
            pattern: "^/api-a/.*",
            maxWorkers: route1Concurrency,
            maxQueueSize: 20,
            requestTimeout: 30,
          },
          {
            name: "route-b",
            pattern: "^/api-b/.*",
            maxWorkers: route2Concurrency,
            maxQueueSize: 20,
            requestTimeout: 30,
          },
        ],
      });

      testServer = new TestServer({ config });
      await testServer.start();

      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });
      mockProvider.onPost("/api-a/messages", {
        status: 200,
        body: { content: "completed-a" },
        delay: taskDuration,
      });
      mockProvider.onPost("/api-b/messages", {
        status: 200,
        body: { content: "completed-b" },
        delay: taskDuration,
      });

      // 2 default + 3 route-a + 2 route-b = 7 tasks
      // Each queue has enough concurrency to process in 1 round
      // So total time should be ~1 round = 800ms

      const startTime = Date.now();

      const results = await Promise.all([
        // 2 tasks to default queue
        ...Array.from({ length: 2 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `default-${i}`, messages: [] })
            .timeout(60000)
        ),
        // 3 tasks to route-a
        ...Array.from({ length: 3 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/api-a/messages")
            .set("x-api-key", "test-key")
            .send({ model: `route-a-${i}`, messages: [] })
            .timeout(60000)
        ),
        // 2 tasks to route-b
        ...Array.from({ length: 2 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/api-b/messages")
            .set("x-api-key", "test-key")
            .send({ model: `route-b-${i}`, messages: [] })
            .timeout(60000)
        ),
      ]);

      const totalTime = Date.now() - startTime;

      // All should complete
      for (const result of results) {
        expect(result.status).toBe(200);
      }

      // All queues process in parallel, should be ~1 round
      expect(totalTime).toBeLessThan(taskDuration * 1.4);
      expect(totalTime).toBeGreaterThan(taskDuration * 0.8);

      console.log(
        `IT15-03: 7 tasks across 3 queues took ${totalTime}ms ` +
          `(expected ~${taskDuration}ms if parallel)`
      );

      // Verify final state
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
      expect(stats.routes["route-a"]?.activeWorkers).toBe(0);
      expect(stats.routes["route-b"]?.activeWorkers).toBe(0);
    });
  });

  describe("IT16: Queue isolation edge cases", () => {
    it("IT16-01: should not block default queue when route queue is overloaded", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const taskDuration = 500;
      const defaultConcurrency = 2;
      const routeConcurrency = 1; // Only 1 concurrency for route queue

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: defaultConcurrency,
          maxQueueSize: 20,
          requestTimeout: 30,
        }),
        routeQueues: [
          {
            name: "slow-route",
            pattern: "^/slow/.*",
            maxWorkers: routeConcurrency,
            maxQueueSize: 20,
            requestTimeout: 30,
          },
        ],
      });

      testServer = new TestServer({ config });
      await testServer.start();

      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });
      mockProvider.onPost("/slow/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });

      // Send 4 tasks to slow route queue (will take 4 rounds = 2s with concurrency=1)
      // But send them without waiting
      const routePromise = Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/slow/messages")
            .set("x-api-key", "test-key")
            .send({ model: `slow-${i}`, messages: [] })
            .timeout(60000)
        )
      );

      // Wait a bit for route queue to start processing
      await new Promise(r => setTimeout(r, 100));

      // Now send 2 tasks to default queue
      // They should complete quickly without waiting for route queue
      const defaultStart = Date.now();
      const defaultResults = await Promise.all(
        Array.from({ length: 2 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `default-${i}`, messages: [] })
            .timeout(60000)
        )
      );
      const defaultTime = Date.now() - defaultStart;

      // Default tasks should complete in ~1 round = 500ms
      // Not affected by the slow route queue
      expect(defaultTime).toBeLessThan(taskDuration * 1.5);

      for (const result of defaultResults) {
        expect(result.status).toBe(200);
      }

      // Wait for route queue to finish
      const routeResults = await routePromise;
      for (const result of routeResults) {
        expect(result.status).toBe(200);
      }

      console.log(
        `IT16-01: Default queue (${defaultTime}ms) not blocked by slow route queue`
      );
    });

    it("IT16-02: should track queue stats independently", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const taskDuration = 1000;

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 2,
          maxQueueSize: 20,
          requestTimeout: 30,
        }),
        routeQueues: [
          {
            name: "tracked-route",
            pattern: "^/tracked/.*",
            maxWorkers: 3,
            maxQueueSize: 20,
            requestTimeout: 30,
          },
        ],
      });

      testServer = new TestServer({ config });
      await testServer.start();

      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });
      mockProvider.onPost("/tracked/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });

      // Start tasks but don't wait
      const defaultPromise = Promise.all(
        Array.from({ length: 2 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `default-${i}`, messages: [] })
            .timeout(60000)
        )
      );

      const routePromise = Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/tracked/messages")
            .set("x-api-key", "test-key")
            .send({ model: `route-${i}`, messages: [] })
            .timeout(60000)
        )
      );

      // Check stats while tasks are running
      await new Promise(r => setTimeout(r, 100)); // Let tasks start
      const duringStats = testServer.getQueueStats();

      // Verify each queue tracks its own workers
      expect(duringStats.default?.activeWorkers).toBeGreaterThan(0);
      expect(duringStats.default?.activeWorkers).toBeLessThanOrEqual(2);
      expect(duringStats.routes["tracked-route"]?.activeWorkers).toBeGreaterThan(0);
      expect(duringStats.routes["tracked-route"]?.activeWorkers).toBeLessThanOrEqual(3);

      // Wait for completion
      await Promise.all([defaultPromise, routePromise]);

      // Check stats after completion
      const afterStats = testServer.getQueueStats();
      expect(afterStats.default?.activeWorkers).toBe(0);
      expect(afterStats.routes["tracked-route"]?.activeWorkers).toBe(0);

      // Verify total processed counts
      expect(afterStats.default?.totalProcessed).toBe(2);
      expect(afterStats.routes["tracked-route"]?.totalProcessed).toBe(3);

      console.log(
        `IT16-02: Stats tracked independently - ` +
          `default: ${afterStats.default?.totalProcessed}, ` +
          `route: ${afterStats.routes["tracked-route"]?.totalProcessed}`
      );
    });
  });
});
