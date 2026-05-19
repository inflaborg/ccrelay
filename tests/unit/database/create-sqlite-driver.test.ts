import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockNativeInitialize, mockCliInitialize } = vi.hoisted(() => ({
  mockNativeInitialize: vi.fn(),
  mockCliInitialize: vi.fn(),
}));

vi.mock("@/database/drivers/sqlite-native", () => {
  class MockSqliteNativeDriver {
    initialize = mockNativeInitialize;
    enabled = true;
    close = vi.fn().mockResolvedValue(undefined);
  }
  return { SqliteNativeDriver: MockSqliteNativeDriver }; // eslint-disable-line @typescript-eslint/naming-convention -- matches export name
});

vi.mock("@/database/drivers/sqlite-cli", () => {
  class MockSqliteCliDriver {
    initialize = mockCliInitialize;
    enabled = true;
    close = vi.fn().mockResolvedValue(undefined);
  }
  return { SqliteCliDriver: MockSqliteCliDriver }; // eslint-disable-line @typescript-eslint/naming-convention -- matches export name
});

describe("createSqliteDriver", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockNativeInitialize.mockResolvedValue(undefined);
    mockCliInitialize.mockResolvedValue(undefined);
  });

  it("uses CLI driver when driver is cli", async () => {
    const { createSqliteDriver } = await import("@/database/create-sqlite-driver");

    await createSqliteDriver({ type: "sqlite", path: "/tmp/x.db", driver: "cli" });

    expect(mockCliInitialize).toHaveBeenCalled();
    expect(mockNativeInitialize).not.toHaveBeenCalled();
  });

  it("uses native driver when driver is native", async () => {
    const { createSqliteDriver } = await import("@/database/create-sqlite-driver");

    await createSqliteDriver({ type: "sqlite", path: "/tmp/x.db", driver: "native" });

    expect(mockNativeInitialize).toHaveBeenCalled();
    expect(mockCliInitialize).not.toHaveBeenCalled();
  });

  it("auto: falls back to CLI when native initialize fails", async () => {
    mockNativeInitialize.mockRejectedValueOnce(new Error("Cannot find module 'better-sqlite3'"));
    const { createSqliteDriver } = await import("@/database/create-sqlite-driver");

    await createSqliteDriver({ type: "sqlite", path: "/tmp/x.db", driver: "auto" });

    expect(mockNativeInitialize).toHaveBeenCalled();
    expect(mockCliInitialize).toHaveBeenCalled();
  });

  it("native: propagates initialize failure", async () => {
    mockNativeInitialize.mockRejectedValueOnce(new Error("native broken"));
    const { createSqliteDriver } = await import("@/database/create-sqlite-driver");

    await expect(
      createSqliteDriver({ type: "sqlite", path: "/tmp/x.db", driver: "native" })
    ).rejects.toThrow("native broken");
  });
});
