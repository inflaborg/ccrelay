/**
 * Integration Test: DNS and Network Failure Handling
 *
 * Tests that verify correct handling of DNS failures and network errors
 * Note: We use real non-existent domains to trigger actual network errors
 */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { MockConfig, TestServer } from "../fixtures";
import { createTestProvider, createTestConcurrencyConfig } from "../utils";

describe("Integration: DNS/Network Failure", () => {
  let testServer: TestServer;

  afterEach(async () => {
    if (testServer) {
      await testServer.stop();
    }
  });

  describe("IT06: DNS resolution failure", () => {
    it("IT06-01: should return error on DNS failure (ENOTFOUND)", async () => {
      // Use a domain that definitely doesn't exist
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "https://this-domain-definitely-does-not-exist-12345.invalid",
        }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 30000,
        }),
        proxyTimeout: 5,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(10000);

      // Should get error response (502, 503, or 500)
      expect([502, 503, 500]).toContain(res.status);
    });

    it("IT06-02: should handle connection refused (ECONNREFUSED)", async () => {
      // Use localhost with a port that's not listening
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://127.0.0.1:1", // Port 1 is almost never used
        }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 30000,
        }),
        proxyTimeout: 5,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(10000);

      expect([502, 503, 500]).toContain(res.status);
    });

    it("IT06-03: should handle connection reset (ECONNRESET)", async () => {
      // Use a non-routable IP to trigger connection issues
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://10.255.255.1:9999", // Non-routable IP
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

      expect([502, 503, 500]).toContain(res.status);
    });

    it("IT06-04: should handle socket timeout (ETIMEDOUT)", async () => {
      // Use a non-routable IP with short timeout
      const config = new MockConfig({
        provider: createTestProvider({
          baseUrl: "http://10.255.255.1:9999", // Non-routable IP
        }),
        concurrency: createTestConcurrencyConfig({
          maxConcurrency: 2,
          maxQueueSize: 10,
          timeout: 1000, // Short timeout
        }),
        proxyTimeout: 1,
      });

      testServer = new TestServer({ config });
      await testServer.start();

      const res = await request(testServer.baseUrl)
        .post("/v1/messages")
        .set("x-api-key", "test-key")
        .send({ model: "claude-3-sonnet", messages: [{ role: "user", content: "hi" }] })
        .timeout(10000);

      expect([502, 503, 500]).toContain(res.status);
    });
  });
});
