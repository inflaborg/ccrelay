import { describe, it, expect } from "vitest";
import { normalizeCliRow } from "@/database/drivers/sqlite/utils";

describe("normalizeCliRow", () => {
  it("decodes hex-encoded JSON body previews to Buffer", () => {
    const json = '{"model":"gpt-4","stream":true}';
    const hex = Buffer.from(json, "utf-8").toString("hex");
    const row = normalizeCliRow({
      id: 1,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- sqlite column name
      request_body: hex,
    });

    expect(Buffer.isBuffer(row.request_body)).toBe(true);
    expect((row.request_body as Buffer).toString("utf-8")).toBe(json);
  });

  it("returns null for empty or missing body fields", () => {
    const row = normalizeCliRow({
      id: 1,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- sqlite column name
      request_body: "",
    });

    expect(row.request_body).toBeNull();
  });

  it("falls back to base64 blob decode for non-hex wire values", () => {
    const raw = Buffer.from("hello", "utf-8").toString("base64");
    const row = normalizeCliRow({
      id: 1,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- sqlite column name
      response_body: raw,
    });

    expect(Buffer.isBuffer(row.response_body)).toBe(true);
    expect((row.response_body as Buffer).toString("utf-8")).toBe("hello");
  });
});
