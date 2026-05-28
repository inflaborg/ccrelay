import { computeCanonicalAliasHash } from "@ccrelay/shared/aliasHash";
import type { ModelMapEntry } from "../../../web/src/types/api";
import { describe, expect, it } from "vitest";
import {
  buildModelConfig,
  generateProviders,
  helperRowsSeedFromCustomModelsText,
  initSelections,
  parseCustomModelLineForUi,
} from "../../../web/src/features/providers/wizard/engine";
import {
  defaultModelIdsAsText,
  getPresetById,
} from "../../../web/src/features/providers/wizard/presets";

const TEST_PROVIDER = "glm-intl-anthropic";
const TEST_PROTOCOL: "anthropic" | "openai" | "openai_chat" = "anthropic";

function alias(
  upstreamId: string,
  providerId = TEST_PROVIDER,
  protocol: "anthropic" | "openai" | "openai_chat" = TEST_PROTOCOL
): string {
  return computeCanonicalAliasHash(providerId, protocol, upstreamId, "claude-");
}

describe("parseCustomModelLineForUi", () => {
  it("parses plain id", () => {
    expect(parseCustomModelLineForUi("glm-5.1")).toEqual({ realId: "glm-5.1", displayName: "" });
  });

  it("parses id;display", () => {
    expect(parseCustomModelLineForUi("glm-5.1;GLM 5.1")).toEqual({
      realId: "glm-5.1",
      displayName: "GLM 5.1",
    });
  });

  it("parses id;;alias as display equals id", () => {
    expect(parseCustomModelLineForUi(`glm-5.1;;${alias("glm-5.1")}`)).toEqual({
      realId: "glm-5.1",
      displayName: "",
    });
  });

  it("parses triple with display and alias", () => {
    expect(parseCustomModelLineForUi("gpt-5.4;GPT 5.4;claude-abc001")).toEqual({
      realId: "gpt-5.4",
      displayName: "GPT 5.4",
    });
  });

  it("returns null for blank", () => {
    expect(parseCustomModelLineForUi("   ")).toBeNull();
    expect(parseCustomModelLineForUi(";x")).toBeNull();
  });
});

describe("helperRowsSeedFromCustomModelsText", () => {
  it("maps non-empty lines to seed rows", () => {
    expect(helperRowsSeedFromCustomModelsText("a\nb;B\n\n  glm-5.1;GLM 5.1;claude-x  ")).toEqual([
      { realId: "a", displayName: "" },
      { realId: "b", displayName: "B" },
      { realId: "glm-5.1", displayName: "GLM 5.1" },
    ]);
  });
});

describe("buildModelConfig", () => {
  const baseInput = {
    providerId: TEST_PROVIDER,
    providerType: TEST_PROTOCOL,
    aliasPrefix: "claude-",
  };

  it("prefill from GLM defaultModelIdsAsText yields claude lines with display names", () => {
    const preset = getPresetById("glm");
    expect(preset).toBeDefined();
    const lines = defaultModelIdsAsText(preset!);
    const c = buildModelConfig({
      ...baseInput,
      modelIds: lines.split("\n").filter(l => l.trim().length > 0),
      claudeSupport: true,
      useCustomModels: true,
    });
    expect(c.useCustomModelsList).toBe(true);
    if (c.useCustomModelsList) {
      expect(c.customModelsList).toEqual([
        `glm-5.1;GLM 5.1;${alias("glm-5.1")}`,
        `glm-5-turbo;GLM 5 Turbo;${alias("glm-5-turbo")}`,
        `glm-4.7;GLM 4.7;${alias("glm-4.7")}`,
      ]);
    }
  });

  it("uses canonical alias list and maps before claude or gpt wildcards", () => {
    const c = buildModelConfig({
      ...baseInput,
      modelIds: ["glm-5.1", "glm-4.7"],
      claudeSupport: true,
      useCustomModels: true,
    });
    expect(c.useCustomModelsList).toBe(true);
    expect(c.modelMappingEnabled).toBe(true);
    if (c.useCustomModelsList) {
      expect(c.customModelsList).toEqual([
        `glm-5.1;;${alias("glm-5.1")}`,
        `glm-4.7;;${alias("glm-4.7")}`,
      ]);
    }
    expect(c.modelMap[0]).toEqual({ pattern: alias("glm-5.1"), model: "glm-5.1" });
    expect(c.modelMap[1]).toEqual({ pattern: alias("glm-4.7"), model: "glm-4.7" });
    expect(c.modelMap[2]).toEqual({ pattern: "claude-*", model: "glm-5.1" });
    expect(c.modelMap[3]).toEqual({ pattern: "gpt-*", model: "glm-5.1" });
  });

  it("includes display name in custom list line when different from upstream id", () => {
    const c = buildModelConfig({
      ...baseInput,
      modelIds: ["glm-5.1;GLM 5.1"],
      claudeSupport: true,
      useCustomModels: true,
    });
    expect(c.useCustomModelsList).toBe(true);
    if (c.useCustomModelsList) {
      expect(c.customModelsList).toEqual([`glm-5.1;GLM 5.1;${alias("glm-5.1")}`]);
    }
    expect(c.modelMap[0]).toEqual({ pattern: alias("glm-5.1"), model: "glm-5.1" });
  });

  it("differs alias for same upstream id across provider id or protocol", () => {
    const a = buildModelConfig({
      providerId: "glm-intl-anthropic",
      providerType: "anthropic",
      aliasPrefix: "claude-",
      modelIds: ["glm-5.1"],
      claudeSupport: true,
      useCustomModels: true,
    });
    const b = buildModelConfig({
      providerId: "glm-intl-openai",
      providerType: "openai_chat",
      aliasPrefix: "claude-",
      modelIds: ["glm-5.1"],
      claudeSupport: true,
      useCustomModels: true,
    });
    expect(a.useCustomModelsList && b.useCustomModelsList).toBe(true);
    if (a.useCustomModelsList && b.useCustomModelsList) {
      expect(a.customModelsList[0]).not.toBe(b.customModelsList[0]);
      expect(a.customModelsList[0]).toBe(
        `glm-5.1;;${alias("glm-5.1", "glm-intl-anthropic", "anthropic")}`
      );
      expect(b.customModelsList[0]).toBe(
        `glm-5.1;;${alias("glm-5.1", "glm-intl-openai", "openai_chat")}`
      );
    }
  });

  it("skips fallbacks when claudeSupport is off", () => {
    const c = buildModelConfig({
      ...baseInput,
      modelIds: ["m"],
      claudeSupport: true,
      useCustomModels: true,
    });
    expect(c.modelMap.some((m: ModelMapEntry) => m.pattern === "claude-*")).toBe(true);
    const c2 = buildModelConfig({
      ...baseInput,
      modelIds: ["m"],
      claudeSupport: false,
      useCustomModels: true,
    });
    expect(c2.modelMap.some((m: ModelMapEntry) => m.pattern === "claude-*")).toBe(false);
    expect(c2.modelMap).toEqual([]);
    expect(c2.useCustomModelsList).toBe(true);
    if (c2.useCustomModelsList) {
      expect(c2.customModelsList).toEqual(["m"]);
    }
  });

  it("no alias in customModelsList when claudeSupport is off but useCustomModels is on", () => {
    const c = buildModelConfig({
      ...baseInput,
      modelIds: ["glm-5.1;GLM 5.1"],
      claudeSupport: false,
      useCustomModels: true,
    });
    expect(c.useCustomModelsList).toBe(true);
    if (c.useCustomModelsList) {
      expect(c.customModelsList).toEqual(["glm-5.1;GLM 5.1"]);
    }
    expect(c.modelMap).toEqual([]);
  });

  it("disables custom list but keeps identity mappings when useCustomModels is false", () => {
    const c = buildModelConfig({
      ...baseInput,
      modelIds: ["glm-5.1"],
      claudeSupport: true,
      useCustomModels: false,
    });
    expect(c.useCustomModelsList).toBe(false);
    expect("customModelsList" in c).toBe(false);
    expect(c.modelMap).toEqual([
      { pattern: "claude-*", model: "glm-5.1" },
      { pattern: "gpt-*", model: "glm-5.1" },
      { pattern: "anthropic/glm-5.1", model: "glm-5.1" },
    ]);
  });

  it("parses semicolon for anthropic pattern when custom list off", () => {
    const c = buildModelConfig({
      ...baseInput,
      modelIds: ["glm-5.1;Label"],
      claudeSupport: false,
      useCustomModels: false,
    });
    expect(c.modelMap).toEqual([{ pattern: "anthropic/glm-5.1", model: "glm-5.1" }]);
  });

  it("returns empty model map when useCustomModels is false and no model ids", () => {
    const c = buildModelConfig({
      ...baseInput,
      modelIds: [],
      claudeSupport: false,
      useCustomModels: false,
    });
    expect(c.useCustomModelsList).toBe(false);
    expect(c.modelMap).toEqual([]);
  });
});

describe("generateProviders", () => {
  it("generates two GLM providers for intl + no coding plan with distinct aliases", () => {
    const preset = getPresetById("glm");
    if (!preset) {
      throw new Error("preset glm");
    }
    const out = generateProviders(preset, {
      selections: initSelections(preset),
      apiKey: "k",
      modelIds: ["glm-5.1"],
      claudeSupport: true,
      useCustomModels: true,
    });
    expect(out).toHaveLength(2);
    expect(out[0].baseUrl).toBe("https://api.z.ai/api/anthropic");
    expect(out[0].providerType).toBe("anthropic");
    expect(out[0].id).toBe("glm-intl-anthropic");
    expect(out[1].baseUrl).toBe("https://api.z.ai/api/paas/v4");
    expect(out[1].providerType).toBe("openai_chat");
    expect(out[0].customModelsList?.[0]).not.toBe(out[1].customModelsList?.[0]);
  });

  it("generates Azure single openai provider", () => {
    const preset = getPresetById("azure-openai");
    if (!preset) {
      throw new Error("preset azure");
    }
    const out = generateProviders(preset, {
      selections: {},
      apiKey: "k",
      userBaseUrl: "https://x.cognitiveservices.azure.com/openai/v1",
      modelIds: ["gpt-5.4"],
      claudeSupport: true,
      useCustomModels: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].providerType).toBe("openai");
    expect(out[0].authHeader).toBe("authorization");
    expect(out[0].id).toBe("azure-gpt");
  });

  it("applies Xiaomi authHeader only for token plan", () => {
    const preset = getPresetById("xiaomi");
    if (!preset) {
      throw new Error("preset xiaomi");
    }
    const noToken = generateProviders(preset, {
      selections: { ...initSelections(preset), tokenPlan: false, region: "intl" },
      apiKey: "k",
      modelIds: ["m"],
      claudeSupport: false,
      useCustomModels: true,
    });
    expect(noToken[0].authHeader).toBeUndefined();

    const withToken = generateProviders(preset, {
      selections: { ...initSelections(preset), tokenPlan: true, region: "intl" },
      apiKey: "k",
      modelIds: ["m"],
      claudeSupport: false,
      useCustomModels: true,
    });
    expect(withToken[0].authHeader).toBe("authorization");
  });

  it("generates generic OpenAI Chat provider", () => {
    const preset = getPresetById("generic-openai-chat");
    if (!preset) {
      throw new Error("preset generic-openai-chat");
    }
    const out = generateProviders(preset, {
      selections: {},
      apiKey: "k",
      userBaseUrl: "https://gateway.example/v1",
      modelIds: ["gpt-4o"],
      claudeSupport: true,
      useCustomModels: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].providerType).toBe("openai_chat");
    expect(out[0].baseUrl).toBe("https://gateway.example/v1");
    expect(out[0].id).toBe("openai-chat-upstream");
  });

  it("generates generic Anthropic provider", () => {
    const preset = getPresetById("generic-anthropic");
    if (!preset) {
      throw new Error("preset generic-anthropic");
    }
    const out = generateProviders(preset, {
      selections: {},
      apiKey: "k",
      userBaseUrl: "https://api.anthropic.com",
      modelIds: ["claude-sonnet-4-20250514"],
      claudeSupport: false,
      useCustomModels: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].providerType).toBe("anthropic");
    expect(out[0].baseUrl).toBe("https://api.anthropic.com");
    expect(out[0].id).toBe("anthropic-upstream");
  });

  it("omits customModelsList when useCustomModels is false", () => {
    const preset = getPresetById("generic-openai-chat");
    if (!preset) {
      throw new Error("preset generic-openai-chat");
    }
    const out = generateProviders(preset, {
      selections: {},
      apiKey: "k",
      userBaseUrl: "https://gateway.example/v1",
      modelIds: [],
      claudeSupport: false,
      useCustomModels: false,
    });
    expect(out).toHaveLength(1);
    expect(out[0].useCustomModelsList).toBe(false);
    expect(out[0].customModelsList).toBeUndefined();
    expect(out[0].modelMap).toEqual([]);
  });
});
