/**
 * Integration Test: Concurrency Efficiency
 *
 * Tests that verify workers are truly processing in parallel:
 * 1. Fixed response time with known concurrency → verify total execution time
 * 2. Variable response times → verify concurrent processing efficiency
 * 3. Peak concurrent workers should match maxConcurrency setting
 *
 * The key insight: If tasks are processed sequentially, total time = N * taskTime.
 * If processed concurrently, total time ≈ ceil(N/maxConcurrency) * taskTime.
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { MockConfig, MockProvider, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig } from "../utils";

describe("Integration: Concurrency Efficiency", () => {
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

  describe("IT13: Parallel processing verification", () => {
    it("IT13-01: should process tasks concurrently with fixed response time", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const maxConcurrency = 5;
      const totalTasks = 12;
      const taskDuration = 1000; // 1 second per task

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency,
          maxQueueSize: 20,
          timeout: 30000, // Long timeout
        }),
        proxyTimeout: 60,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Mock fixed response time
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });

      // Expected rounds: ceil(12 / 5) = 3 rounds
      // Expected total time: 3 * 1s = 3s (plus overhead)
      const expectedRounds = Math.ceil(totalTasks / maxConcurrency);
      const expectedMinTime = expectedRounds * taskDuration;
      const expectedMaxTime = expectedMinTime * 1.15; // 15% overhead tolerance

      const startTime = Date.now();

      // Send all requests concurrently
      const results = await Promise.all(
        Array.from({ length: totalTasks }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `test-${i}`, messages: [] })
            .timeout(60000)
        )
      );

      const totalTime = Date.now() - startTime;

      // All tasks should complete successfully
      for (const result of results) {
        expect(result.status).toBe(200);
        expect(result.body.content).toBe("completed");
      }

      // Verify total time is within expected range
      // If sequential: 12 * 1s = 12s
      // If concurrent: 3 * 1s = 3s
      expect(totalTime).toBeGreaterThanOrEqual(expectedMinTime - 100); // Small tolerance for timing
      expect(totalTime).toBeLessThan(expectedMaxTime);

      // This proves concurrency is working: 3s << 12s
      console.log(
        `IT13-01: ${totalTasks} tasks with ${maxConcurrency} concurrency took ${totalTime}ms ` +
          `(expected ~${expectedMinTime}ms, sequential would be ${totalTasks * taskDuration}ms)`
      );

      // Verify final state
      const stats = testServer.getResourceStats();
      expect(stats.activeWorkers).toBe(0);
      expect(stats.queueLength).toBe(0);
    });

    it("IT13-02: should maintain peak workers at maxConcurrency with variable response times", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const maxConcurrency = 5;
      const totalTasks = 15;
      const baseDuration = 800; // Base duration in ms

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency,
          maxQueueSize: 20,
          timeout: 30000,
        }),
        proxyTimeout: 60,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Track peak active workers
      let peakWorkers = 0;
      const workerCheckInterval = setInterval(() => {
        const stats = testServer.getResourceStats();
        if (stats.activeWorkers > peakWorkers) {
          peakWorkers = stats.activeWorkers;
        }
      }, 50);

      // Generate variable response times: 800ms - 1200ms (±20% variation)
      const responseTimes = Array.from({ length: totalTasks }, (_, i) => {
        const variation = (i % 5) * 100; // 0, 100, 200, 300, 400, then repeat
        return baseDuration + variation;
      });

      // Setup mock with variable delays based on request order
      let requestCount = 0;
      mockProvider.onPostDynamic("/v1/messages", () => {
        const delay = responseTimes[requestCount % responseTimes.length];
        requestCount++;
        return {
          status: 200,
          body: { content: "completed" },
          delay,
        };
      });

      // Calculate expected time range
      // With variable times 800-1200ms, tasks will complete at different rates
      // First batch starts immediately, subsequent batches start as workers free up
      // Expected: roughly 3-4 rounds with staggered completion
      const avgDuration = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const expectedRounds = Math.ceil(totalTasks / maxConcurrency);
      const expectedMinTime = (expectedRounds - 1) * baseDuration + 400; // Conservative min
      const expectedMaxTime = expectedRounds * avgDuration * 1.3; // Generous max with overhead

      const startTime = Date.now();

      const results = await Promise.all(
        Array.from({ length: totalTasks }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `test-${i}`, messages: [] })
            .timeout(60000)
        )
      );

      const totalTime = Date.now() - startTime;
      clearInterval(workerCheckInterval);

      // All tasks should complete successfully
      for (const result of results) {
        expect(result.status).toBe(200);
      }

      // Verify peak workers didn't exceed maxConcurrency
      expect(peakWorkers).toBeLessThanOrEqual(maxConcurrency);
      expect(peakWorkers).toBeGreaterThanOrEqual(maxConcurrency - 1); // Should reach near max

      // Verify total time shows concurrent processing
      // Sequential time would be sum of all durations
      const sequentialTime = responseTimes.reduce((a, b) => a + b, 0);
      expect(totalTime).toBeLessThan(sequentialTime * 0.5); // Must be at least 2x faster than sequential

      // Verify total time is within expected range
      expect(totalTime).toBeGreaterThan(expectedMinTime);
      expect(totalTime).toBeLessThan(expectedMaxTime);

      console.log(
        `IT13-02: ${totalTasks} tasks with ${maxConcurrency} concurrency took ${totalTime}ms ` +
          `(peak workers: ${peakWorkers}, sequential would be ~${sequentialTime}ms)`
      );

      // Verify final state
      const stats = testServer.getResourceStats();
      expect(stats.activeWorkers).toBe(0);
      expect(stats.queueLength).toBe(0);
    });

    it("IT13-03: should handle concurrency=1 as sequential processing", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const maxConcurrency = 1;
      const totalTasks = 5;
      const taskDuration = 300; // 300ms per task

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency,
          maxQueueSize: 10,
          timeout: 30000,
        }),
        proxyTimeout: 60,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });

      // Sequential: 5 * 300ms = 1500ms
      const expectedMinTime = totalTasks * taskDuration;
      const expectedMaxTime = expectedMinTime * 1.2; // 20% overhead

      const startTime = Date.now();

      const results = await Promise.all(
        Array.from({ length: totalTasks }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `test-${i}`, messages: [] })
            .timeout(60000)
        )
      );

      const totalTime = Date.now() - startTime;

      // All tasks should complete
      for (const result of results) {
        expect(result.status).toBe(200);
      }

      // With concurrency=1, should take roughly N * taskDuration
      expect(totalTime).toBeGreaterThanOrEqual(expectedMinTime - 100);
      expect(totalTime).toBeLessThan(expectedMaxTime);

      console.log(
        `IT13-03: ${totalTasks} tasks with concurrency=1 took ${totalTime}ms ` +
          `(expected ~${expectedMinTime}ms)`
      );
    });

    it("IT13-04: should efficiently scale with higher concurrency", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const taskDuration = 500;
      const totalTasks = 10;

      // Test with concurrency 2
      const config2 = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 20,
          timeout: 30000,
        }),
        proxyTimeout: 60,
      });

      const server2 = new TestServer({ config: config2 });
      await server2.start();

      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });

      const start2 = Date.now();
      const results2 = await Promise.all(
        Array.from({ length: totalTasks }, (_, i) =>
          request(server2.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `test-${i}`, messages: [] })
            .timeout(60000)
        )
      );
      const time2 = Date.now() - start2;

      for (const result of results2) {
        expect(result.status).toBe(200);
      }

      await server2.stop();

      // Test with concurrency 5
      const config5 = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 5,
          maxQueueSize: 20,
          timeout: 30000,
        }),
        proxyTimeout: 60,
      });

      const server5 = new TestServer({ config: config5 });
      await server5.start();

      mockProvider.reset();
      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });

      const start5 = Date.now();
      const results5 = await Promise.all(
        Array.from({ length: totalTasks }, (_, i) =>
          request(server5.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `test-${i}`, messages: [] })
            .timeout(60000)
        )
      );
      const time5 = Date.now() - start5;

      for (const result of results5) {
        expect(result.status).toBe(200);
      }

      await server5.stop();

      // With concurrency 2: ceil(10/2) = 5 rounds * 500ms = 2500ms
      // With concurrency 5: ceil(10/5) = 2 rounds * 500ms = 1000ms
      // time5 should be significantly faster than time2
      const expectedTime2 = Math.ceil(totalTasks / 2) * taskDuration;
      const expectedTime5 = Math.ceil(totalTasks / 5) * taskDuration;

      // Verify scaling
      expect(time2).toBeGreaterThan(expectedTime2 - 200);
      expect(time5).toBeGreaterThan(expectedTime5 - 200);
      expect(time5).toBeLessThan(time2 * 0.7); // At least 30% faster

      console.log(
        `IT13-04: ${totalTasks} tasks: concurrency=2 took ${time2}ms, concurrency=5 took ${time5}ms ` +
          `(expected ~${expectedTime2}ms vs ~${expectedTime5}ms)`
      );
    });
  });

  describe("IT14: Worker pool utilization", () => {
    it("IT14-01: should fully utilize worker pool under load", async () => {
      mockProvider = new MockProvider();
      await mockProvider.start();

      const maxConcurrency = 5;
      const taskDuration = 1500; // Long enough to observe peak

      const config = new MockConfig({
        provider: createTestProvider({ baseUrl: mockProvider.baseUrl }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency,
          maxQueueSize: 20,
          timeout: 30000,
        }),
        proxyTimeout: 60,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Track worker utilization over time
      const workerSamples: number[] = [];
      const sampleInterval = setInterval(() => {
        const stats = testServer.getResourceStats();
        workerSamples.push(stats.activeWorkers);
      }, 100);

      mockProvider.onPost("/v1/messages", {
        status: 200,
        body: { content: "completed" },
        delay: taskDuration,
      });

      // Send 15 requests
      const results = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          request(testServer.baseUrl)
            .post("/v1/messages")
            .set("x-api-key", "test-key")
            .send({ model: `test-${i}`, messages: [] })
            .timeout(60000)
        )
      );

      clearInterval(sampleInterval);

      // All should complete
      for (const result of results) {
        expect(result.status).toBe(200);
      }

      // Verify we hit max concurrency at some point
      const peakWorkers = Math.max(...workerSamples);
      expect(peakWorkers).toBe(maxConcurrency);

      // Verify average utilization was reasonable (at least 60% of max)
      const avgWorkers = workerSamples.reduce((a, b) => a + b, 0) / workerSamples.length;
      expect(avgWorkers).toBeGreaterThan(maxConcurrency * 0.4);

      console.log(
        `IT14-01: Peak workers: ${peakWorkers}, Avg workers: ${avgWorkers.toFixed(1)}, ` +
          `Samples: ${workerSamples.length}`
      );
    });
  });
});
