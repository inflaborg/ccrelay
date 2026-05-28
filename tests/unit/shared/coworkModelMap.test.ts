import { describe, expect, it } from "vitest";
import { computeCanonicalAliasHash } from "@ccrelay/shared/aliasHash";
import { rebuildCoworkModelMap } from "@ccrelay/shared/coworkModelMap";

describe("rebuildCoworkModelMap", () => {
  const providerId = "glm-intl-anthropic";
  const alias = (model: string) =>
    computeCanonicalAliasHash(providerId, "anthropic", model, "claude-");

  it("builds exact alias rules from customModelsList", () => {
    const list = [`glm-5.1;GLM 5.1;${alias("glm-5.1")}`, `glm-4.7;;${alias("glm-4.7")}`];
    const rebuilt = rebuildCoworkModelMap({ customModelsList: list, aliasPrefix: "claude-" });
    expect(rebuilt.slice(0, 2)).toEqual([
      { pattern: alias("glm-5.1"), model: "glm-5.1" },
      { pattern: alias("glm-4.7"), model: "glm-4.7" },
    ]);
  });

  it("preserves wildcard catch-alls from existing modelMap", () => {
    const list = [`glm-5.1;;${alias("glm-5.1")}`];
    const rebuilt = rebuildCoworkModelMap({
      customModelsList: list,
      existingModelMap: [
        { pattern: alias("glm-5.1"), model: "glm-5.1" },
        { pattern: "claude-*", model: "glm-5.1" },
        { pattern: "gpt-*", model: "glm-5.1" },
      ],
      aliasPrefix: "claude-",
    });
    expect(rebuilt).toEqual([
      { pattern: alias("glm-5.1"), model: "glm-5.1" },
      { pattern: "claude-*", model: "glm-5.1" },
      { pattern: "gpt-*", model: "glm-5.1" },
    ]);
  });

  it("drops stale legacy alias-shaped patterns", () => {
    const list = [`glm-5.1;;${alias("glm-5.1")}`];
    const rebuilt = rebuildCoworkModelMap({
      customModelsList: list,
      existingModelMap: [
        { pattern: "claude-abc123", model: "glm-5.1" },
        { pattern: alias("glm-5.1"), model: "glm-5.1" },
        { pattern: "claude-*", model: "glm-5.1" },
      ],
      aliasPrefix: "claude-",
    });
    expect(rebuilt.some(e => e.pattern === "claude-abc123")).toBe(false);
    expect(rebuilt[0]).toEqual({ pattern: alias("glm-5.1"), model: "glm-5.1" });
  });

  it("preserves custom non-alias patterns", () => {
    const list = [`glm-5.1;;${alias("glm-5.1")}`];
    const rebuilt = rebuildCoworkModelMap({
      customModelsList: list,
      existingModelMap: [
        { pattern: "anthropic/glm-5.1", model: "glm-5.1" },
        { pattern: alias("glm-5.1"), model: "glm-5.1" },
      ],
      aliasPrefix: "claude-",
    });
    expect(rebuilt).toContainEqual({ pattern: "anthropic/glm-5.1", model: "glm-5.1" });
    expect(rebuilt[0]).toEqual({ pattern: alias("glm-5.1"), model: "glm-5.1" });
  });
});
