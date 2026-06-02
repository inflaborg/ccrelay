import { describe, expect, it } from "vitest";
import {
  applyConcurrencyRequestTimeoutMigration,
  needsConfigUpgrade,
  prepareConfigUpgrade025,
} from "@/config/migration";
import { CONFIG_VERSION, LEGACY_CONCURRENCY_REQUEST_TIMEOUT } from "@/config/defaults";

describe("needsConfigUpgrade", () => {
  it("returns true when configVersion is missing", () => {
    expect(needsConfigUpgrade(null)).toBe(true);
  });

  it("returns true for versions below 0.2.5", () => {
    expect(needsConfigUpgrade("0.2.0")).toBe(true);
    expect(needsConfigUpgrade("0.2.4")).toBe(true);
  });

  it("returns false for 0.2.5 and above", () => {
    expect(needsConfigUpgrade("0.2.5")).toBe(false);
    expect(needsConfigUpgrade("0.3.0")).toBe(false);
  });
});

describe("applyConcurrencyRequestTimeoutMigration", () => {
  it("migrates legacy default 60 to 0", () => {
    const raw: Record<string, unknown> = {
      concurrency: { enabled: true, requestTimeout: LEGACY_CONCURRENCY_REQUEST_TIMEOUT },
    };
    expect(applyConcurrencyRequestTimeoutMigration(raw)).toBe(true);
    expect((raw.concurrency as Record<string, unknown>).requestTimeout).toBe(0);
  });

  it("does not change custom timeouts", () => {
    const raw: Record<string, unknown> = {
      concurrency: { enabled: true, requestTimeout: 30 },
    };
    expect(applyConcurrencyRequestTimeoutMigration(raw)).toBe(false);
    expect((raw.concurrency as Record<string, unknown>).requestTimeout).toBe(30);
  });

  it("does nothing when concurrency section is missing", () => {
    const raw: Record<string, unknown> = { server: { port: 7575 } };
    expect(applyConcurrencyRequestTimeoutMigration(raw)).toBe(false);
  });
});

describe("prepareConfigUpgrade025", () => {
  it("upgrades version and migrates requestTimeout 60", () => {
    const raw: Record<string, unknown> = {
      configVersion: "0.2.0",
      concurrency: { enabled: true, requestTimeout: 60 },
    };
    const result = prepareConfigUpgrade025(raw, "0.2.0");
    expect(result).toEqual({ changed: true, concurrencyTimeoutMigrated: true });
    expect(raw.configVersion).toBe(CONFIG_VERSION);
    expect((raw.concurrency as Record<string, unknown>).requestTimeout).toBe(0);
  });

  it("bumps configVersion only when requestTimeout is omitted", () => {
    const raw: Record<string, unknown> = {
      configVersion: "0.2.0",
      concurrency: { enabled: true, maxWorkers: 3 },
    };
    const result = prepareConfigUpgrade025(raw, "0.2.0");
    expect(result).toEqual({ changed: true, concurrencyTimeoutMigrated: false });
    expect(raw.configVersion).toBe(CONFIG_VERSION);
    expect((raw.concurrency as Record<string, unknown>).requestTimeout).toBeUndefined();
  });

  it("does nothing when already at 0.2.5", () => {
    const raw: Record<string, unknown> = {
      configVersion: "0.2.5",
      concurrency: { enabled: true, requestTimeout: 60 },
    };
    const result = prepareConfigUpgrade025(raw, "0.2.5");
    expect(result).toEqual({ changed: false, concurrencyTimeoutMigrated: false });
    expect((raw.concurrency as Record<string, unknown>).requestTimeout).toBe(60);
  });
});
