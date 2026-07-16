import { describe, expect, it } from "vitest";
import { serializeServiceMeta, parseServiceMetaColumn } from "@/database/shared-utils";

describe("serializeServiceMeta", () => {
  it("returns undefined for empty or missing meta", () => {
    expect(serializeServiceMeta(undefined)).toBeUndefined();
    expect(serializeServiceMeta({})).toBeUndefined();
  });

  it("serializes non-empty objects", () => {
    expect(serializeServiceMeta({ searchBackend: "tavily" })).toBe('{"searchBackend":"tavily"}');
  });
});

describe("parseServiceMetaColumn", () => {
  it("returns undefined for null and blank strings", () => {
    expect(parseServiceMetaColumn(null)).toBeUndefined();
    expect(parseServiceMetaColumn("  ")).toBeUndefined();
  });

  it("returns trimmed JSON text", () => {
    expect(parseServiceMetaColumn(' {"a":1} ')).toBe('{"a":1}');
  });
});
