import * as crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  buildPublicModelId,
  computeCanonicalAliasHash,
  looksLikeAliasWireId,
  looksLikeLegacyAliasPattern,
} from "@ccrelay/shared/aliasHash";
import { sha1Hex } from "@ccrelay/shared/sha1";

describe("shared sha1Hex", () => {
  it("matches Node crypto sha1 hex", () => {
    const samples = [
      "",
      "glm-5.1",
      "CN_GLM:anthropic:glm-5.1",
      "glm-intl-anthropic:anthropic:glm-5.1",
      "unicode-测试",
    ];
    for (const s of samples) {
      const node = crypto.createHash("sha1").update(s, "utf8").digest("hex");
      expect(sha1Hex(s)).toBe(node);
    }
  });
});

describe("shared aliasHash", () => {
  it("builds stable canonical hash per provider+protocol+model", () => {
    const a = computeCanonicalAliasHash("CN_GLM", "anthropic", "glm-5.1");
    const b = computeCanonicalAliasHash("GLOBAL_GLM", "anthropic", "glm-5.1");
    expect(a).toBe("claude-6e17ce8d");
    expect(b).not.toBe(a);
    expect(a).toMatch(/^claude-[0-9a-f]{8}$/);
  });

  it("matches Node crypto for canonical hash input", () => {
    const input = "glm-intl-anthropic:anthropic:glm-5.1";
    const expected =
      "claude-" + crypto.createHash("sha1").update(input, "utf8").digest("hex").slice(0, 8);
    expect(computeCanonicalAliasHash("glm-intl-anthropic", "anthropic", "glm-5.1")).toBe(expected);
    expect(expected).toBe("claude-b81d554d");
  });

  it("builds public id with colon separator", () => {
    expect(buildPublicModelId("CN_GLM", "glm-5.1")).toBe("CN_GLM:glm-5.1");
  });

  it("detects alias wire ids", () => {
    expect(looksLikeAliasWireId("claude-a1b2c3d4")).toBe(true);
    expect(looksLikeAliasWireId("claude-abc123")).toBe(false);
    expect(looksLikeAliasWireId("CN_GLM:glm-5.1")).toBe(false);
  });

  it("detects legacy alias-shaped patterns", () => {
    expect(looksLikeLegacyAliasPattern("claude-abc123")).toBe(true);
    expect(looksLikeLegacyAliasPattern("claude-a1b2c3d4")).toBe(true);
    expect(looksLikeLegacyAliasPattern("anthropic/glm-5.1")).toBe(false);
  });
});
