import { describe, expect, it } from "vitest";
import {
  buildPublicModelId,
  computeCanonicalAliasHash,
  looksLikeAliasWireId,
} from "@/server/smartRouting/aliasHash";

describe("aliasHash", () => {
  it("builds stable canonical hash per provider+protocol+model", () => {
    const a = computeCanonicalAliasHash("CN_GLM", "anthropic", "glm-5.1");
    const b = computeCanonicalAliasHash("GLOBAL_GLM", "anthropic", "glm-5.1");
    expect(a).toBe("claude-6e17ce8d");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^claude-[0-9a-f]{8}$/);
  });

  it("builds public id with colon separator", () => {
    expect(buildPublicModelId("CN_GLM", "glm-5.1")).toBe("CN_GLM:glm-5.1");
  });

  it("detects alias wire ids", () => {
    expect(looksLikeAliasWireId("claude-a1b2c3d4")).toBe(true);
    expect(looksLikeAliasWireId("CN_GLM:glm-5.1")).toBe(false);
  });
});
