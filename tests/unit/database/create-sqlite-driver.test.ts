/* eslint-disable @typescript-eslint/naming-convention -- mock class names match driver exports */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/database/drivers/sqlite/native", () => {
  class MockSqliteNativeDriver {
    initialize = vi.fn().mockResolvedValue(undefined);
    enabled = true;
    close = vi.fn().mockResolvedValue(undefined);
  }
  return { SqliteNativeDriver: MockSqliteNativeDriver };
});

vi.mock("@/database/drivers/sqlite/cli", () => {
  class MockSqliteCliDriver {
    initialize = vi.fn().mockResolvedValue(undefined);
    enabled = true;
    close = vi.fn().mockResolvedValue(undefined);
  }
  return { SqliteCliDriver: MockSqliteCliDriver };
});

describe("createSqliteDriver", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses CLI driver when driver is cli", async () => {
    const { createSqliteDriver } = await import("@/database/drivers/sqlite/factory");
    const { SqliteCliDriver } = await import("@/database/drivers/sqlite/cli");

    const driver = createSqliteDriver({ type: "sqlite", path: "/tmp/x.db", driver: "cli" });

    expect(driver).toBeInstanceOf(SqliteCliDriver);
  });

  it("uses native driver when driver is native", async () => {
    const { createSqliteDriver } = await import("@/database/drivers/sqlite/factory");
    const { SqliteNativeDriver } = await import("@/database/drivers/sqlite/native");

    const driver = createSqliteDriver({ type: "sqlite", path: "/tmp/x.db", driver: "native" });

    expect(driver).toBeInstanceOf(SqliteNativeDriver);
  });

  it("auto: returns a driver instance without initializing", async () => {
    const { createSqliteDriver } = await import("@/database/drivers/sqlite/factory");

    const driver = createSqliteDriver({ type: "sqlite", path: "/tmp/x.db", driver: "auto" });

    expect(driver).toBeDefined();
    expect(typeof driver.initialize).toBe("function");
  });
});
