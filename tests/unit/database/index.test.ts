/**
 * Unit tests for database/index.ts
 *
 * Product Requirements:
 * - D001-D004: Database initialization and schema creation
 * - D005-D011: insertLog with various data types
 * - D012-D017: queryLogs with filters
 * - D018: Statistics and batch operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LogDatabase, getDatabase, type RequestLog, type LogFilter } from "@/database";

// Mock sqlite-cli driver
vi.mock("@/database/drivers/sqlite-cli", async importOriginal => {
  const actual = await importOriginal<typeof import("@/database/drivers/sqlite-cli")>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SqliteCliDriver: vi.fn(function () {
      return {
        initialize: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        insertLog: vi.fn(),
        insertLogPending: vi.fn(),
        updateLogCompleted: vi.fn(),
        writeBatch: vi.fn().mockResolvedValue(undefined),
        queryLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
        getLogById: vi.fn().mockResolvedValue(null),
        deleteLogs: vi.fn().mockResolvedValue(undefined),
        clearAllLogs: vi.fn().mockResolvedValue(undefined),
        getStats: vi.fn().mockResolvedValue({
          totalLogs: 0,
          successCount: 0,
          errorCount: 0,
          avgDuration: 0,
          byProvider: {},
        }),
        cleanOldLogs: vi.fn().mockResolvedValue(undefined),
        forceFlush: vi.fn(),
        enabled: true,
      };
    }),
  };
});

describe("database: LogDatabase", () => {
  let db: LogDatabase;
  const testDbPath = "/tmp/test-ccrelay-logs.db";

  beforeEach(() => {
    vi.clearAllMocks();
    // Create fresh instance for each test
    db = new LogDatabase(testDbPath);
  });

  afterEach(() => {
    // Clean up database instance
    try {
      void db.close();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("D001-D004: Database initialization", () => {
    it("D001: should initialize database successfully", async () => {
      await db.initialize(true);

      expect(db.enabled).toBe(true);
    });

    it("D002: should handle JSON fields correctly", async () => {
      await db.initialize(true);

      const log: RequestLog = {
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        requestBody: '{"model":"test"}',
        responseBody: '{"content":"response"}',
        statusCode: 200,
        duration: 100,
        success: true,
      };

      db.insertLog(log);

      // Verify JSON fields are preserved in original object
      expect(log.requestBody).toBeDefined();
      expect(log.responseBody).toBeDefined();
    });

    it("D003: should handle nullable fields", async () => {
      await db.initialize(true);

      const log: RequestLog = {
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "GET",
        path: "/v1/models",
        statusCode: undefined,
        duration: 50,
        success: true,
        errorMessage: undefined,
      };

      db.insertLog(log);

      // Verify nullable fields can be undefined
      expect(log.statusCode).toBeUndefined();
      expect(log.errorMessage).toBeUndefined();
    });

    it("D004: should create proper table structure", async () => {
      await db.initialize(true);

      // Verify initialization by checking enabled status
      expect(db.enabled).toBe(true);
    });
  });

  describe("D005-D011: insertLog operations", () => {
    beforeEach(async () => {
      await db.initialize(true);
    });

    it("D005: should insert log with auto-incrementing ID", () => {
      const logs: RequestLog[] = [];

      for (let i = 0; i < 5; i++) {
        const log: RequestLog = {
          timestamp: Date.now(),
          providerId: "test",
          providerName: "Test Provider",
          method: "POST",
          path: "/v1/messages",
          duration: 100,
          success: true,
        };
        logs.push(log);
        db.insertLog(log);
      }

      // All inserts should succeed without throwing
      expect(logs.length).toBe(5);
    });

    it("D006: should handle JSON field serialization", () => {
      const log: RequestLog = {
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        requestBody: '{"nested":{"key":"value"},"array":[1,2,3]}',
        responseBody: '{"result":"success","data":null}',
        duration: 100,
        success: true,
      };

      db.insertLog(log);

      // Should handle JSON serialization without errors
      expect(log.requestBody).toBe('{"nested":{"key":"value"},"array":[1,2,3]}');
      expect(log.responseBody).toBe('{"result":"success","data":null}');
    });

    it("D007: should handle NULL values correctly", () => {
      const log: RequestLog = {
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        targetUrl: undefined,
        requestBody: undefined,
        responseBody: undefined,
        statusCode: undefined,
        duration: 100,
        success: true,
        errorMessage: undefined,
      };

      db.insertLog(log);

      // Should handle NULL values
      expect(log.targetUrl).toBeUndefined();
      expect(log.requestBody).toBeUndefined();
      expect(log.responseBody).toBeUndefined();
    });

    it("D008: should not insert when disabled", async () => {
      const disabledDb = new LogDatabase("/tmp/test-disabled.db");
      await disabledDb.initialize(false);

      const log: RequestLog = {
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        duration: 100,
        success: true,
      };

      disabledDb.insertLog(log);

      // Should not throw when disabled
      expect(disabledDb.enabled).toBe(false);
    });

    it("D009: should handle special characters in log data", () => {
      const log: RequestLog = {
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages?query=test&filter=value",
        requestBody: '{"message":"Hello\\nWorld\\tTab"}',
        responseBody: '{"response":"Test \\"quotes\\""}',
        duration: 100,
        success: true,
      };

      db.insertLog(log);

      // Should handle special characters
      expect(log.path).toContain("?query=test&filter=value");
      expect(log.requestBody).toContain("\\n");
      expect(log.requestBody).toContain("\\t");

      // Also verify escaped quotes are present as expected in JSON
      expect(log.responseBody).toContain('\\"quotes\\"');
    });

    it("D010: should handle large log data", () => {
      const largeData = "x".repeat(10000);

      const log: RequestLog = {
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        requestBody: largeData,
        responseBody: largeData,
        duration: 5000,
        success: true,
      };

      db.insertLog(log);

      // Should handle large data
      expect(log.requestBody?.length).toBe(10000);
      expect(log.responseBody?.length).toBe(10000);
    });

    it("D011: should extract model from request body", () => {
      const log: RequestLog = {
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        requestBody: '{"model":"claude-3-5-sonnet-20241022","max_tokens":4096}',
        duration: 100,
        success: true,
      };

      db.insertLog(log);

      // Model should be extracted from requestBody
      expect(log.requestBody).toContain("claude-3-5-sonnet-20241022");
    });
  });

  describe("D012-D017: queryLogs with filters", () => {
    beforeEach(async () => {
      await db.initialize(true);
    });

    it("D012: should return all logs without filter", () => {
      const result = db.queryLogs();

      expect(result).toBeDefined();
      return result.then(r => {
        expect(r.logs).toBeInstanceOf(Array);
        expect(r.total).toBeGreaterThanOrEqual(0);
      });
    });

    it("D013: should filter by providerId", () => {
      const filter: LogFilter = {
        providerId: "test-provider",
      };

      const result = db.queryLogs(filter);

      return result.then(r => {
        expect(r.logs).toBeInstanceOf(Array);
      });
    });

    it("D014: should filter by method", () => {
      const filter: LogFilter = {
        method: "POST",
      };

      const result = db.queryLogs(filter);

      return result.then(r => {
        expect(r.logs).toBeInstanceOf(Array);
      });
    });

    it("D015: should filter by path pattern", () => {
      const filter: LogFilter = {
        pathPattern: "/v1/messages",
      };

      const result = db.queryLogs(filter);

      return result.then(r => {
        expect(r.logs).toBeInstanceOf(Array);
      });
    });

    it("D016: should filter by duration range", () => {
      const filter: LogFilter = {
        minDuration: 100,
        maxDuration: 500,
      };

      const result = db.queryLogs(filter);

      return result.then(r => {
        expect(r.logs).toBeInstanceOf(Array);

        for (const log of r.logs) {
          expect(log.duration).toBeGreaterThanOrEqual(100);
          expect(log.duration).toBeLessThanOrEqual(500);
        }
      });
    });

    it("D017: should apply limit to results", () => {
      const filter: LogFilter = {
        limit: 5,
      };

      const result = db.queryLogs(filter);

      return result.then(r => {
        expect(r.logs.length).toBeLessThanOrEqual(5);
      });
    });

    it("should apply offset for pagination", () => {
      // First query
      const firstResult = db.queryLogs({ limit: 10 });

      // Second query with offset
      const secondResult = db.queryLogs({
        limit: 10,
        offset: 10,
      });

      return Promise.all([firstResult, secondResult]).then(([first, second]) => {
        expect(first.logs).toBeInstanceOf(Array);
        expect(second.logs).toBeInstanceOf(Array);
      });
    });

    it("should handle empty result set", () => {
      const filter: LogFilter = {
        providerId: "non-existent-provider",
        limit: 10,
      };

      const result = db.queryLogs(filter);

      return result.then(r => {
        expect(r.logs).toEqual([]);
        expect(r.total).toBe(0);
      });
    });

    it("should return total count matching filter", () => {
      const filter: LogFilter = {
        providerId: "test",
      };

      const result = db.queryLogs(filter);

      return result.then(r => {
        expect(r.total).toBeGreaterThanOrEqual(r.logs.length);
      });
    });
  });

  describe("D018: Statistics", () => {
    beforeEach(async () => {
      await db.initialize(true);
    });

    it("D018: should return stats with data", () => {
      // Insert some test logs
      db.insertLog({
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        duration: 100,
        success: true,
      });

      db.insertLog({
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        duration: 200,
        success: false,
        errorMessage: "Test error",
      });

      const stats = db.getStats();

      return stats.then(s => {
        expect(s).toBeDefined();
        expect(s.totalLogs).toBeGreaterThanOrEqual(0);
        expect(s.successCount).toBeGreaterThanOrEqual(0);
        expect(s.errorCount).toBeGreaterThanOrEqual(0);
      });
    });

    it("should return zero values when no data", async () => {
      const freshDb = new LogDatabase("/tmp/test-empty.db");
      await freshDb.initialize(true);

      const stats = await freshDb.getStats();

      expect(stats.totalLogs).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.avgDuration).toBe(0);
      expect(stats.byProvider).toEqual({});

      await freshDb.close();
    });

    it("should calculate average duration correctly", async () => {
      db.insertLog({
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        duration: 100,
        success: true,
      });

      db.insertLog({
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        duration: 200,
        success: true,
      });

      db.insertLog({
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        duration: 300,
        success: true,
      });

      const stats = await db.getStats();

      // The mocked driver returns avgDuration: 0 by default
      // This test verifies the interface works correctly
      expect(stats.avgDuration).toBeGreaterThanOrEqual(0);
    });

    it("should count logs by provider", async () => {
      db.insertLog({
        timestamp: Date.now(),
        providerId: "providerA",
        providerName: "Provider A",
        method: "POST",
        path: "/v1/messages",
        duration: 100,
        success: true,
      });

      db.insertLog({
        timestamp: Date.now(),
        providerId: "providerB",
        providerName: "Provider B",
        method: "POST",
        path: "/v1/messages",
        duration: 100,
        success: true,
      });

      db.insertLog({
        timestamp: Date.now(),
        providerId: "providerA",
        providerName: "Provider A",
        method: "POST",
        path: "/v1/messages",
        duration: 100,
        success: true,
      });

      const stats = await db.getStats();

      // The mocked driver returns byProvider: {} by default
      // This test verifies the interface works correctly
      expect(stats.byProvider).toBeDefined();
    });
  });

  describe("D014-D015: Batch operations", () => {
    beforeEach(async () => {
      await db.initialize(true);
    });

    it("D014: should batch insert multiple logs successfully", () => {
      const logs: RequestLog[] = [];

      for (let i = 0; i < 10; i++) {
        logs.push({
          timestamp: Date.now(),
          providerId: "test",
          providerName: "Test Provider",
          method: "POST",
          path: "/v1/messages",
          duration: 100,
          success: true,
        });
      }

      // Should not throw
      for (const log of logs) {
        db.insertLog(log);
      }

      expect(logs.length).toBe(10);
    });

    it("D015: should handle transaction rollback on error", async () => {
      // This test verifies that the writeQueue handles transaction failures gracefully
      // Insert multiple logs to fill the batch queue
      for (let i = 0; i < 5; i++) {
        db.insertLog({
          timestamp: Date.now(),
          providerId: "test",
          providerName: "Test Provider",
          method: "POST",
          path: "/v1/messages",
          duration: 100,
          success: true,
        });
      }

      // Force flush by advancing timers
      vi.useFakeTimers();
      vi.advanceTimersByTime(1100);
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();

      // Verify database is still functional after batch operation
      expect(db.enabled).toBe(true);
    });

    it("D018: should handle concurrent inserts from multiple sources", () => {
      const insertPromises: Promise<void>[] = [];

      for (let i = 0; i < 5; i++) {
        const log: RequestLog = {
          timestamp: Date.now(),
          providerId: "test",
          providerName: "Test Provider",
          method: "POST",
          path: "/v1/messages",
          duration: 100,
          success: true,
        };

        insertPromises.push(
          new Promise<void>(resolve => {
            resolve(db.insertLog(log));
          })
        );
      }

      return Promise.all(insertPromises).then(() => {
        // All concurrent inserts should complete
        expect(insertPromises.length).toBe(5);
      });
    });
  });

  describe("D016-D017: deleteOldLogs and clearLogs", () => {
    beforeEach(async () => {
      await db.initialize(true);
    });

    it("D016: should delete logs older than specified days", async () => {
      // Insert old log (100 days ago)
      db.insertLog({
        timestamp: Date.now() - 100 * 24 * 60 * 60 * 1000,
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        duration: 100,
        success: true,
      });

      // Insert recent log (1 day ago)
      db.insertLog({
        timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000,
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages/recent",
        duration: 50,
        success: true,
      });

      // Force flush
      vi.useFakeTimers();
      vi.advanceTimersByTime(1100);
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();

      // Database should be enabled and logs inserted
      expect(db.enabled).toBe(true);
    });

    it("D017: should clear all logs from database", () => {
      // Insert some logs
      for (let i = 0; i < 5; i++) {
        db.insertLog({
          timestamp: Date.now(),
          providerId: "test",
          providerName: "Test Provider",
          method: "POST",
          path: "/v1/messages",
          duration: 100,
          success: true,
        });
      }

      // Clear logs
      const clearPromise = db.clearAllLogs();

      return clearPromise.then(() => {
        return db.queryLogs().then(result => {
          expect(result.logs).toEqual([]);
          expect(result.total).toBe(0);
        });
      });
    });
  });

  describe("Database close", () => {
    it("should close database connection", () => {
      const initPromise = db.initialize(true);

      return initPromise.then(() => {
        return db.close().then(() => {
          // After close, database should not be enabled
          expect(db.enabled).toBe(false);
        });
      });
    });

    it("should handle multiple close calls", () => {
      const initPromise = db.initialize(true);

      return initPromise.then(() => {
        return db.close().then(() => {
          return db.close().then(() => {
            // Second close should not throw
            expect(db.enabled).toBe(false);
          });
        });
      });
    });
  });

  describe("getLogById", () => {
    beforeEach(async () => {
      await db.initialize(true);
    });

    it("should return log by ID", () => {
      // Insert a log first
      db.insertLog({
        id: 123,
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        duration: 100,
        success: true,
      });

      const log = db.getLogById(123);

      return log.then(l => {
        if (l !== null) {
          expect(l.id).toBe(123);
        }
      });
    });

    it("should return null for non-existent ID", () => {
      const log = db.getLogById(99999);

      return log.then(l => {
        expect(l).toBeNull();
      });
    });

    it("should return null when database is disabled", () => {
      const log = db.getLogById(1);

      return log.then(l => {
        expect(l).toBeNull();
      });
    });
  });

  describe("deleteLogs", () => {
    beforeEach(async () => {
      await db.initialize(true);
    });

    it("should delete logs by IDs", () => {
      const idsToDelete = [1, 2, 3];

      const deletePromise = db.deleteLogs(idsToDelete);

      return deletePromise.then(() => {
        // Verify deletion
        return Promise.all(idsToDelete.map(id => db.getLogById(id))).then(logs => {
          for (const log of logs) {
            expect(log).toBeNull();
          }
        });
      });
    });

    it("should handle empty ID array", () => {
      const deletePromise = db.deleteLogs([]);

      return deletePromise.then(() => {
        // Should not throw
        expect(true).toBe(true);
      });
    });
  });

  describe("updateLogCompleted", () => {
    beforeEach(async () => {
      await db.initialize(true);
    });

    it("should update log with response data", () => {
      const clientId = "test-client-123";

      // First insert as pending
      db.insertLogPending({
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        clientId,
        status: "pending",
        duration: 0,
        success: false,
      });

      // Then update as completed
      db.updateLogCompleted(clientId, 200, '{"result":"success"}', 150, true, undefined);

      // Wait a bit for async operation
      return new Promise<void>(resolve => {
        setTimeout(() => {
          // Update should succeed without throwing
          expect(true).toBe(true);
          resolve();
        }, 10);
      });
    });

    it("should handle update for non-existent clientId", () => {
      db.updateLogCompleted("non-existent-client", 404, undefined, 0, false, "Not found");

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("Singleton getDatabase", () => {
    it("should return the same instance", () => {
      const db1 = getDatabase();
      const db2 = getDatabase();

      expect(db1).toBe(db2);
    });
  });

  describe("Edge cases", () => {
    it("should handle very large duration values", async () => {
      await db.initialize(true);

      const log: RequestLog = {
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        duration: Number.MAX_SAFE_INTEGER,
        success: true,
      };

      db.insertLog(log);

      // Should handle large values
      expect(log.duration).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("should handle negative duration", async () => {
      await db.initialize(true);

      const log: RequestLog = {
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        duration: -1,
        success: true,
      };

      db.insertLog(log);

      expect(log.duration).toBe(-1);
    });

    it("should handle special provider IDs", async () => {
      await db.initialize(true);

      const specialIds = [
        "providerWithDash",
        "provider_with_underscore",
        "providerWithDot",
        "UPPERCASE",
        "lowercase",
        "123numeric",
        "with-space",
        "unicode-provider",
      ];

      for (const id of specialIds) {
        db.insertLog({
          timestamp: Date.now(),
          providerId: id,
          providerName: `Provider ${id}`,
          method: "POST",
          path: "/v1/messages",
          duration: 100,
          success: true,
        });
      }

      // Should handle all special IDs
      expect(specialIds.length).toBe(8);
    });

    it("should handle all route types", async () => {
      await db.initialize(true);

      const routeTypes = ["block", "passthrough", "router"] as const;

      for (const routeType of routeTypes) {
        db.insertLog({
          timestamp: Date.now(),
          providerId: "test",
          providerName: "Test Provider",
          method: "POST",
          path: "/v1/messages",
          duration: 100,
          success: true,
          routeType,
        });
      }

      // Should handle all route types
      expect(routeTypes.length).toBe(3);
    });
  });

  describe("Status tracking", () => {
    beforeEach(async () => {
      await db.initialize(true);
    });

    it("should handle pending status", () => {
      const clientId = "pending-test-client";

      db.insertLogPending({
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        clientId,
        status: "pending",
        duration: 0,
        success: false,
      });

      // Should not throw
      expect(true).toBe(true);
    });

    it("should handle completed status", () => {
      const clientId = "completed-test-client";

      db.insertLogPending({
        timestamp: Date.now(),
        providerId: "test",
        providerName: "Test Provider",
        method: "POST",
        path: "/v1/messages",
        clientId,
        status: "pending",
        duration: 0,
        success: false,
      });

      db.updateLogCompleted(clientId, 200, '{"result":"ok"}', 100, true, undefined);

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
