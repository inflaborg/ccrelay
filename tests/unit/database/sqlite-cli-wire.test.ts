import { describe, it, expect } from "vitest";
import {
  encodeBlobForCliWire,
  decodeBlobFromCliWire,
  sqlLiteralForBlob,
} from "@/database/drivers/sqlite/cli-wire";

describe("sqlite-cli-wire", () => {
  it("roundtrips UTF-8 JSON through B64 wire prefix", () => {
    const original = Buffer.from('{"model":"gpt-4","stream":true}', "utf-8");
    const wire = encodeBlobForCliWire(original);
    const decoded = decodeBlobFromCliWire(wire);
    expect(decoded?.toString("utf-8")).toBe(original.toString("utf-8"));
  });

  it("sqlLiteralForBlob produces hex blob literal", () => {
    const buf = Buffer.from("ab", "utf-8");
    expect(sqlLiteralForBlob(buf)).toBe("x'6162'");
  });

  it("decodes sqlite JSON base64 blob output", () => {
    const raw = Buffer.from("hello", "utf-8").toString("base64");
    const decoded = decodeBlobFromCliWire(raw);
    expect(decoded?.toString("utf-8")).toBe("hello");
  });
});
