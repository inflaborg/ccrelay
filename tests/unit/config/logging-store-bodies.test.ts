import { describe, expect, it } from "vitest";
/* eslint-disable @typescript-eslint/naming-convention -- YAML snake_case parity */
import { FileConfigSchema } from "@/types";
import { getDefaultConfig } from "@/config/defaults";
import { resolveLoggingStoreBodies } from "@/config/logging";

describe("resolveLoggingStoreBodies", () => {
  it("defaults to on when logging is omitted", () => {
    expect(resolveLoggingStoreBodies(undefined)).toBe(true);
    expect(resolveLoggingStoreBodies({})).toBe(true);
  });

  it("prefers storeBodies over deprecated enabled", () => {
    expect(resolveLoggingStoreBodies({ storeBodies: true, enabled: false })).toBe(true);
    expect(resolveLoggingStoreBodies({ storeBodies: false, enabled: true })).toBe(false);
  });

  it("accepts snake_case store_bodies", () => {
    expect(resolveLoggingStoreBodies({ store_bodies: false })).toBe(false);
    expect(resolveLoggingStoreBodies({ store_bodies: true, enabled: false })).toBe(true);
  });

  it("falls back to deprecated enabled when storeBodies is absent", () => {
    expect(resolveLoggingStoreBodies({ enabled: false })).toBe(false);
    expect(resolveLoggingStoreBodies({ enabled: true })).toBe(true);
  });
});

describe("bundled logging defaults", () => {
  it("enables storeBodies in the default YAML", () => {
    expect(getDefaultConfig().logging?.storeBodies).toBe(true);
  });

  it("parses storeBodies and optional enabled", () => {
    const withNew = FileConfigSchema.safeParse({ logging: { storeBodies: false } });
    expect(withNew.success).toBe(true);
    if (withNew.success) {
      expect(withNew.data.logging?.storeBodies).toBe(false);
    }

    const legacy = FileConfigSchema.safeParse({ logging: { enabled: false } });
    expect(legacy.success).toBe(true);
    if (legacy.success) {
      expect(legacy.data.logging?.enabled).toBe(false);
      expect(legacy.data.logging?.storeBodies).toBeUndefined();
    }
  });
});
