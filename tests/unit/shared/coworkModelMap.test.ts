import { describe, expect, it } from "vitest";
import { computeCanonicalAliasHash } from "@ccrelay/shared/aliasHash";
import { buildCoworkModelMapEntries, rebuildCoworkModelMap } from "@ccrelay/shared/coworkModelMap";

describe("buildCoworkModelMapEntries", () => {
  const providerId = "glm-intl-anthropic";
  const alias = (model: string) =>
    computeCanonicalAliasHash(providerId, "anthropic", model, "claude-");

  it("builds alias, identity, then default wildcards in order", () => {
    const list = [`glm-5.1;GLM 5.1;${alias("glm-5.1")}`, `glm-4.7;;${alias("glm-4.7")}`];
    const entries = buildCoworkModelMapEntries(list);
    expect(entries).toEqual([
      { pattern: alias("glm-5.1"), model: "glm-5.1" },
      { pattern: "glm-5.1", model: "glm-5.1" },
      { pattern: alias("glm-4.7"), model: "glm-4.7" },
      { pattern: "glm-4.7", model: "glm-4.7" },
      { pattern: "claude-*", model: "glm-5.1" },
      { pattern: "gpt-*", model: "glm-5.1" },
    ]);
  });

  it("dedupes identity rules when the same id appears twice", () => {
    const list = ["glm-5.1", "glm-5.1;GLM 5.1"];
    const entries = buildCoworkModelMapEntries(list);
    expect(entries.filter(e => e.pattern === "glm-5.1")).toEqual([
      { pattern: "glm-5.1", model: "glm-5.1" },
    ]);
  });

  it("uses wildcardTargetModel when provided", () => {
    const list = ["glm-5.1", "glm-4.7"];
    const entries = buildCoworkModelMapEntries(list, { wildcardTargetModel: "glm-4.7" });
    expect(entries.slice(-2)).toEqual([
      { pattern: "claude-*", model: "glm-4.7" },
      { pattern: "gpt-*", model: "glm-4.7" },
    ]);
  });
});

describe("rebuildCoworkModelMap", () => {
  const providerId = "glm-intl-anthropic";
  const alias = (model: string) =>
    computeCanonicalAliasHash(providerId, "anthropic", model, "claude-");

  it("clear-and-rebuilds from customModelsList only", () => {
    const list = [`glm-5.1;;${alias("glm-5.1")}`];
    const rebuilt = rebuildCoworkModelMap({
      customModelsList: list,
      existingModelMap: [
        { pattern: "anthropic/glm-5.1", model: "glm-5.1" },
        { pattern: "gpt-*-mini", model: "glm-5.1" },
        { pattern: alias("glm-5.1"), model: "glm-5.1" },
      ],
      aliasPrefix: "claude-",
    });
    expect(rebuilt).toEqual([
      { pattern: alias("glm-5.1"), model: "glm-5.1" },
      { pattern: "glm-5.1", model: "glm-5.1" },
      { pattern: "claude-*", model: "glm-5.1" },
      { pattern: "gpt-*", model: "glm-5.1" },
    ]);
  });
});
