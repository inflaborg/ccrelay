/* eslint-disable @typescript-eslint/naming-convention -- HTTP header names use hyphens */
import { describe, it, expect } from "vitest";
import { maskSecretValue, maskHeadersForLog, SENSITIVE_HEADER_NAMES } from "@/server/headerMask";

describe("server: headerMask", () => {
  describe("maskSecretValue", () => {
    it("keeps first 4 + last 4 with *** in the middle for long values", () => {
      expect(maskSecretValue("sk-abcdefghijklmnop")).toBe("sk-a***mnop");
    });

    it("fully masks values of length <= 8", () => {
      expect(maskSecretValue("short")).toBe("********");
      expect(maskSecretValue("12345678")).toBe("********");
    });

    it("masks 9-char values with first/last 4", () => {
      // length 9: first 4 + last 4 leaves 1 hidden char
      expect(maskSecretValue("123456789")).toBe("1234***6789");
    });

    it("preserves the Bearer scheme and masks only the credential", () => {
      expect(maskSecretValue("Bearer sk-abcdefghijklmnopqrstuvwxyz")).toBe("Bearer sk-a***wxyz");
    });

    it("preserves other space-prefixed schemes (e.g. Basic)", () => {
      expect(maskSecretValue("Basic dXNlcjpwYXNzd29yZDEyMzQ1")).toBe("Basic dXNl***MzQ1");
    });

    it("fully masks when the credential after the scheme is short", () => {
      expect(maskSecretValue("Bearer short")).toBe("Bearer ********");
    });
  });

  describe("maskHeadersForLog", () => {
    it("returns undefined for undefined/empty input", () => {
      expect(maskHeadersForLog(undefined)).toBeUndefined();
      expect(maskHeadersForLog(null)).toBeUndefined();
      expect(maskHeadersForLog({})).toBeUndefined();
    });

    it("masks sensitive headers and leaves others untouched", () => {
      const out = maskHeadersForLog({
        "content-type": "application/json",
        "x-api-key": "sk-secretkey123456",
      });
      const parsed = JSON.parse(out!) as Record<string, string>;
      expect(parsed["content-type"]).toBe("application/json");
      expect(parsed["x-api-key"]).toBe("sk-s***3456");
    });

    it("matches sensitive header names case-insensitively", () => {
      const out = maskHeadersForLog({ Authorization: "Bearer tokensecret123456" });
      const parsed = JSON.parse(out!) as Record<string, string>;
      expect(parsed.Authorization).toBe("Bearer toke***3456");
    });

    it("masks each element of array-valued sensitive headers", () => {
      const out = maskHeadersForLog({
        "x-api-key": ["sk-aaaaaaaa1111", "sk-bbbbbbbb2222"],
      });
      const parsed = JSON.parse(out!) as Record<string, string[]>;
      expect(parsed["x-api-key"]).toEqual(["sk-a***1111", "sk-b***2222"]);
    });

    it("passes non-sensitive headers (including arrays) through verbatim", () => {
      const out = maskHeadersForLog({
        "x-request-id": "abc-123",
        "set-cookie": ["s=1; Path=/", "t=2"],
      });
      const parsed = JSON.parse(out!) as Record<string, unknown>;
      expect(parsed["x-request-id"]).toBe("abc-123");
      expect(parsed["set-cookie"]).toEqual(["s=1; Path=/", "t=2"]);
    });

    it("treats authorization, x-api-key, proxy-authorization, and acl-token as sensitive", () => {
      expect(SENSITIVE_HEADER_NAMES.has("authorization")).toBe(true);
      expect(SENSITIVE_HEADER_NAMES.has("x-api-key")).toBe(true);
      expect(SENSITIVE_HEADER_NAMES.has("proxy-authorization")).toBe(true);
      expect(SENSITIVE_HEADER_NAMES.has("acl-token")).toBe(true);
      expect(SENSITIVE_HEADER_NAMES.has("content-type")).toBe(false);
    });

    it("masks acl-token header values", () => {
      const out = maskHeadersForLog({
        "acl-token": "acl-secret-token-value-12345",
        "content-type": "application/json",
      });
      const parsed = JSON.parse(out!) as Record<string, string>;
      expect(parsed["acl-token"]).toBe("acl-***2345");
      expect(parsed["content-type"]).toBe("application/json");
    });
  });
});
