/**
 * Unit tests for SQLite CLI driver
 * Tests the business-level interface
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SqliteCliDriver } from "@/database/drivers/sqlite-cli";

// Mock vscode
vi.mock("vscode", () => ({
  window: {
    createOutputChannel: vi.fn().mockReturnValue({
      appendLine: vi.fn(),
      show: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
    }),
  },
}));

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn().mockReturnValue("/usr/bin/sqlite3"),
}));

describe("SqliteCliDriver", () => {
  let driver: SqliteCliDriver;
  const testConfig = {
    type: "sqlite" as const,
    path: ":memory:",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new SqliteCliDriver(testConfig);
  });

  afterEach(async () => {
    try {
      await driver.close();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("constructor", () => {
    it("should create driver with config", () => {
      expect(driver).toBeDefined();
      expect(driver.enabled).toBe(false);
    });
  });

  describe("business methods existence", () => {
    it("should have insertLog method", () => {
      expect(typeof driver.insertLog).toBe("function");
    });

    it("should have insertLogPending method", () => {
      expect(typeof driver.insertLogPending).toBe("function");
    });

    it("should have updateLogCompleted method", () => {
      expect(typeof driver.updateLogCompleted).toBe("function");
    });

    it("should have queryLogs method", () => {
      expect(typeof driver.queryLogs).toBe("function");
    });

    it("should have getLogById method", () => {
      expect(typeof driver.getLogById).toBe("function");
    });

    it("should have deleteLogs method", () => {
      expect(typeof driver.deleteLogs).toBe("function");
    });

    it("should have clearAllLogs method", () => {
      expect(typeof driver.clearAllLogs).toBe("function");
    });

    it("should have getStats method", () => {
      expect(typeof driver.getStats).toBe("function");
    });

    it("should have cleanOldLogs method", () => {
      expect(typeof driver.cleanOldLogs).toBe("function");
    });

    it("should have forceFlush method", () => {
      expect(typeof driver.forceFlush).toBe("function");
    });
  });

  describe("queryLogs when not initialized", () => {
    it("should return empty result when not enabled", async () => {
      const result = await driver.queryLogs({});
      expect(result).toEqual({ logs: [], total: 0 });
    });
  });

  describe("getStats when not initialized", () => {
    it("should return empty stats when not enabled", async () => {
      const stats = await driver.getStats();
      expect(stats).toEqual({
        totalLogs: 0,
        successCount: 0,
        errorCount: 0,
        avgDuration: 0,
        byProvider: {},
      });
    });
  });

  describe("getLogById when not initialized", () => {
    it("should return null when not enabled", async () => {
      const log = await driver.getLogById(1);
      expect(log).toBeNull();
    });
  });

  describe("deleteLogs when not initialized", () => {
    it("should not throw when not enabled", async () => {
      await expect(driver.deleteLogs([1, 2, 3])).resolves.not.toThrow();
    });
  });

  describe("clearAllLogs when not initialized", () => {
    it("should not throw when not enabled", async () => {
      await expect(driver.clearAllLogs()).resolves.not.toThrow();
    });
  });

  describe("cleanOldLogs when not initialized", () => {
    it("should not throw when not enabled", async () => {
      await expect(driver.cleanOldLogs()).resolves.not.toThrow();
    });
  });

  describe("close", () => {
    it("should handle close when not initialized", async () => {
      await expect(driver.close()).resolves.not.toThrow();
    });
  });
});
