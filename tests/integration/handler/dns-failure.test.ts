/**
 * Integration Test: DNS and Network Failure Handling
 *
 * Tests that verify correct handling of DNS failures and network errors.
 * Each test verifies:
 * 1. Correct HTTP status code returned
 * 2. Worker is released after error (no resource leak)
 *
 * Note: We use real non-existent domains to trigger actual network errors
 */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import nock from "nock";
import { MockConfig, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig, sleep } from "../utils";

describe("Integration: DNS/Network Failure", () => {
  let testServer: TestServer;

  afterEach(async () => {
    nock.cleanAll();
    nock.enableNetConnect(); // Re-enable network connections
    if (testServer) {
      await testServer.stop();
    }
  });

  describe("IT06: DNS resolution failure", () => {
    it("IT06-01: should return 502 on DNS failure (ENOTFOUND)", async () => {
      // Use a domain that definitely doesn't exist
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "https://this-domain-definitely-does-not-exist-12345.invalid",
        }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 2,
          maxQueueSize: 10,
          requestTimeout: 5,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(15000);

      // DNS failure should return 502 (Bad Gateway)
      expect(res.status).toBe(502);
    });

    it("IT06-02: should return 502 on connection refused (ECONNREFUSED)", async () => {
      // Use localhost with a port that's not listening
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1", // Port 1 is almost never used
        }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 2,
          maxQueueSize: 10,
          requestTimeout: 5,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(10000);

      // Connection refused should return 502
      expect(res.status).toBe(502);
    });

    it("IT06-03: should handle client timeout during slow upstream (mocked)", async () => {
      // Use nock to simulate slow response (30 seconds delay)
      nock("http://mock-upstream-slow:9999")
        .post("/v1/messages")
        .delay(30000) // 30 second delay
        .reply(200, { success: true });

      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://mock-upstream-slow:9999",
        }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1,
          maxQueueSize: 10,
          requestTimeout: 30, // Long enough to not trigger queue timeout
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Client sets a short timeout (1 second), should timeout before proxy responds
      try {
        await request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
          .timeout(1000);
        // Should not reach here
        expect.fail("Expected client timeout error");
      } catch (err: unknown) {
        // Client timeout is expected - verify it's a timeout error
        expect((err as Error).message).toContain("Timeout");
      }

      // Wait for cleanup
      await sleep(100);

      // Verify: worker should be released after client disconnect
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
    });

    it("IT06-04: should release worker after DNS failure", async () => {
      // Use a domain that definitely doesn't exist
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "https://this-domain-definitely-does-not-exist-12345.invalid",
        }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 1, // Only 1 worker to verify release
          maxQueueSize: 10,
          requestTimeout: 0.30,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(10000);

      // Wait for cleanup
      await sleep(100);

      // Worker should be released after error
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
    });
  });

  describe("IT06-B: Resource leak verification", () => {
    it("IT06-05: should not leak workers on repeated network failures", async () => {
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1", // Will fail
        }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 2,
          maxQueueSize: 10,
          requestTimeout: 2,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Make multiple failing requests sequentially
      for (let i = 0; i < 3; i++) {
        await request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: `test ${i}` }] })
          .timeout(10000);

        await sleep(50);
      }

      // All workers should be released
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
    });

    it("IT06-06: should handle concurrent network failures without deadlock", async () => {
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1",
        }),
        concurrency: createTestConcurrencyConfig({
          maxWorkers: 3,
          maxQueueSize: 10,
          requestTimeout: 2,
        }),
      });

      testServer = new TestServer({ config });
      await testServer.start();

      // Make concurrent requests
      const results = await Promise.allSettled([
        request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [] })
          .timeout(10000),
        request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [] })
          .timeout(10000),
        request(testServer.baseUrl)
          .post("/v1/messages")
          .set("x-api-key", "test-key")
          .send({ model: "claude-3-sonnet", messages: [] })
          .timeout(10000),
      ]);

      // All should have failed with 502
      for (const result of results) {
        if (result.status === "fulfilled") {
          expect(result.value.status).toBe(502);
        }
      }

      // Wait for cleanup
      await sleep(200);

      // All workers should be released
      const stats = testServer.getQueueStats();
      expect(stats.default?.activeWorkers).toBe(0);
    });
  });
});
