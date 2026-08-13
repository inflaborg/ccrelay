import { describe, expect, it } from "vitest";
import { computeCanonicalAliasHash } from "@ccrelay/shared/aliasHash";
import {
  buildCoworkModelMapEntries,
  CLAUDE_FAMILY_WILDCARDS,
  extractClaudeFamilyTargets,
  rebuildCoworkModelMap,
} from "@ccrelay/shared/coworkModelMap";

const [haikuPat, sonnetPat, opusPat] = CLAUDE_FAMILY_WILDCARDS;

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
      { pattern: "claude-haiku-*", model: "glm-5.1" },
      { pattern: "claude-sonnet-*", model: "glm-5.1" },
      { pattern: "claude-opus-*", model: "glm-5.1" },
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
    expect(entries.slice(-5)).toEqual([
      { pattern: "claude-haiku-*", model: "glm-5.1" },
      { pattern: "claude-sonnet-*", model: "glm-5.1" },
      { pattern: "claude-opus-*", model: "glm-5.1" },
      { pattern: "claude-*", model: "glm-4.7" },
      { pattern: "gpt-*", model: "glm-4.7" },
    ]);
  });

  it("maps Claude family wildcards to per-family targets when provided", () => {
    const list = ["glm-5.1", "glm-4.7", "glm-4.6"];
    const entries = buildCoworkModelMapEntries(list, {
      claudeFamilyTargets: {
        [haikuPat]: "glm-4.6",
        [sonnetPat]: "glm-4.7",
        [opusPat]: "glm-5.1",
      },
    });
    expect(entries.slice(-5)).toEqual([
      { pattern: "claude-haiku-*", model: "glm-4.6" },
      { pattern: "claude-sonnet-*", model: "glm-4.7" },
      { pattern: "claude-opus-*", model: "glm-5.1" },
      { pattern: "claude-*", model: "glm-5.1" },
      { pattern: "gpt-*", model: "glm-5.1" },
    ]);
  });

  it("falls back to first model when a family target is not in the list", () => {
    const list = ["glm-5.1", "glm-4.7"];
    const entries = buildCoworkModelMapEntries(list, {
      claudeFamilyTargets: { [opusPat]: "missing-model" },
    });
    expect(entries.find(e => e.pattern === "claude-opus-*")).toEqual({
      pattern: "claude-opus-*",
      model: "glm-5.1",
    });
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
      { pattern: "claude-haiku-*", model: "glm-5.1" },
      { pattern: "claude-sonnet-*", model: "glm-5.1" },
      { pattern: "claude-opus-*", model: "glm-5.1" },
      { pattern: "claude-*", model: "glm-5.1" },
      { pattern: "gpt-*", model: "glm-5.1" },
    ]);
  });

  it("preserves Claude family targets that still exist in the list", () => {
    const list = ["glm-5.1", "glm-4.7"];
    const rebuilt = rebuildCoworkModelMap({
      customModelsList: list,
      existingModelMap: [
        { pattern: "claude-haiku-*", model: "glm-4.7" },
        { pattern: "claude-sonnet-*", model: "glm-4.7" },
        { pattern: "claude-opus-*", model: "glm-5.1" },
        { pattern: "gpt-*-mini", model: "glm-5.1" },
      ],
    });
    expect(rebuilt.slice(-5)).toEqual([
      { pattern: "claude-haiku-*", model: "glm-4.7" },
      { pattern: "claude-sonnet-*", model: "glm-4.7" },
      { pattern: "claude-opus-*", model: "glm-5.1" },
      { pattern: "claude-*", model: "glm-5.1" },
      { pattern: "gpt-*", model: "glm-5.1" },
    ]);
    expect(rebuilt.some(e => e.pattern === "gpt-*-mini")).toBe(false);
  });

  it("drops stale Claude family targets and falls back to the first model", () => {
    const list = ["glm-5.1"];
    const rebuilt = rebuildCoworkModelMap({
      customModelsList: list,
      existingModelMap: [{ pattern: "claude-haiku-*", model: "glm-4.7" }],
    });
    expect(rebuilt.find(e => e.pattern === "claude-haiku-*")).toEqual({
      pattern: "claude-haiku-*",
      model: "glm-5.1",
    });
  });
});

describe("extractClaudeFamilyTargets", () => {
  it("reads family patterns and skips ids not in the valid set", () => {
    expect(
      extractClaudeFamilyTargets(
        [
          { pattern: "claude-haiku-*", model: "a" },
          { pattern: "claude-sonnet-*", model: "gone" },
          { pattern: "claude-*", model: "a" },
        ],
        new Set(["a"])
      )
    ).toEqual({ [haikuPat]: "a" });
  });
});
