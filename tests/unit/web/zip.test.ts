import { describe, expect, it } from "vitest";
import { zipFiles } from "../../../web/src/lib/zip";

function findAscii(haystack: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= haystack.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (haystack[i + j] !== n[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

describe("zipFiles", () => {
  it("builds a zip with directory paths", async () => {
    const zip = await zipFiles(
      [
        { path: "12/request-converted.json", content: '{"ok":true}' },
        { path: "12/request-analysis.md", content: "### User\n\nhello\n" },
      ],
      new Date("2026-08-13T12:00:00")
    );

    expect(zip[0]).toBe(0x50); // P
    expect(zip[1]).toBe(0x4b); // K
    expect(findAscii(zip, "12/request-converted.json")).toBe(true);
    expect(findAscii(zip, "12/request-analysis.md")).toBe(true);

    let foundEocd = false;
    for (let i = 0; i < zip.length - 3; i++) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
        foundEocd = true;
        break;
      }
    }
    expect(foundEocd).toBe(true);
  });

  it("compresses a large file without hanging", async () => {
    const payload = "x".repeat(1_000_000);
    const zip = await zipFiles([{ path: "1/response-converted.json", content: payload }]);
    expect(zip[0]).toBe(0x50);
    expect(zip.length).toBeLessThan(payload.length);
  });
});
