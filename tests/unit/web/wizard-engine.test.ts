import type { ModelMapEntry } from "../../../web/src/types/api";
import { describe, expect, it } from "vitest";
import {
  buildModelConfig,
  generateProviders,
  initSelections,
} from "../../../web/src/features/providers/wizard/engine";
import { getPresetById } from "../../../web/src/features/providers/wizard/presets";

describe("buildModelConfig", () => {
  it("prefixes custom list and adds exact and fallback mappings", () => {
    const c = buildModelConfig(["glm-5.1", "glm-4.7"], true, true);
    expect(c.useCustomModelsList).toBe(true);
    expect(c.modelMappingEnabled).toBe(true);
    if (c.useCustomModelsList) {
      expect(c.customModelsList).toEqual(["anthropic/glm-5.1", "anthropic/glm-4.7"]);
    }
    expect(c.modelMap[0]).toEqual({ pattern: "claude-*", model: "glm-5.1" });
    expect(c.modelMap[1]).toEqual({ pattern: "gpt-*", model: "glm-5.1" });
    expect(c.modelMap[2]).toEqual({ pattern: "anthropic/glm-5.1", model: "glm-5.1" });
    expect(c.modelMap[3]).toEqual({ pattern: "anthropic/glm-4.7", model: "glm-4.7" });
  });

  it("skips fallbacks when claudeSupport is off", () => {
    const c = buildModelConfig(["m"], true, true);
    expect(c.modelMap.some((m: ModelMapEntry) => m.pattern === "claude-*")).toBe(true);
    const c2 = buildModelConfig(["m"], false, true);
    expect(c2.modelMap.some((m: ModelMapEntry) => m.pattern === "claude-*")).toBe(false);
  });

  it("disables custom list but keeps identity mappings when useCustomModels is false", () => {
    const c = buildModelConfig(["glm-5.1"], true, false);
    expect(c.useCustomModelsList).toBe(false);
    expect("customModelsList" in c).toBe(false);
    expect(c.modelMap).toEqual([
      { pattern: "claude-*", model: "glm-5.1" },
      { pattern: "gpt-*", model: "glm-5.1" },
      { pattern: "anthropic/glm-5.1", model: "glm-5.1" },
    ]);
  });

  it("returns empty model map when useCustomModels is false and no model ids", () => {
    const c = buildModelConfig([], false, false);
    expect(c.useCustomModelsList).toBe(false);
    expect(c.modelMap).toEqual([]);
  });
});

describe("generateProviders", () => {
  it("generates two GLM providers for intl + no coding plan", () => {
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
