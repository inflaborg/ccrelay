import { describe, expect, it } from "vitest";
import { resolveModelMeta, listModelFamilies } from "@/converter/model-meta/registry";
import { GLOBAL_UNKNOWN_MODEL_META } from "@/converter/model-meta/defaults";

describe("resolveModelMeta", () => {
  it("matches claude-haiku family with reasoning disabled", () => {
    const meta = resolveModelMeta("claude-haiku-4-5", { vendor: "anthropic" });
    expect(meta.id).toBe("claude-haiku");
    expect(meta.reasoning.supportsEffort).toBe(false);
    expect(meta.reasoning.supportsThinking).toBe(false);
    expect(meta.anthropic?.supportsSystemRoleInMessages).toBe(false);
    expect(meta.vision.enabled).toBe(true);
    expect(meta.input.modalities).toEqual(["text", "image"]);
  });

  it("matches claude-sonnet family with reasoning enabled", () => {
    const meta = resolveModelMeta("claude-sonnet-4-20250514", { vendor: "anthropic" });
    expect(meta.id).toBe("claude-sonnet");
    expect(meta.reasoning.supportsEffort).toBe(true);
    expect(meta.reasoning.supportsAdaptiveThinking).toBe(true);
    expect(meta.anthropic?.supportsSystemRoleInMessages).not.toBe(false);
    expect(meta.anthropic?.supportsContextManagement).toBe(false);
    expect(meta.anthropic?.supportsStructuredOutputs).toBe(false);
  });

  it("matches gpt-5 max_completion_tokens family", () => {
    const meta = resolveModelMeta("gpt-5.2", { vendor: "openai" });
    expect(meta.id).toBe("gpt-5");
    expect(meta.openaiChat?.usesMaxCompletionTokens).toBe(true);
  });

  it("matches o-series via regex", () => {
    expect(resolveModelMeta("o3-mini", { vendor: "openai" }).id).toBe("o-series");
    expect(resolveModelMeta("o4-mini", { vendor: "openai" }).id).toBe("o-series");
  });

  it("matches gemini 2.5 flash disable thinking", () => {
    const meta = resolveModelMeta("gemini-2.5-flash", { vendor: "gemini" });
    expect(meta.gemini?.canDisableThinking).toBe(true);
    expect(meta.gemini?.is25Family).toBe(true);
  });

  it("matches gemini 2.5 pro without disable thinking", () => {
    const meta = resolveModelMeta("gemini-2.5-pro", { vendor: "gemini" });
    expect(meta.gemini?.canDisableThinking).toBe(false);
  });

  it("matches gemini 3+ without disable thinking", () => {
    const meta = resolveModelMeta("gemini-3-flash-preview", { vendor: "gemini" });
    expect(meta.id).toBe("gemini-3-plus");
    expect(meta.gemini?.canDisableThinking).toBe(false);
  });

  it("matches deepseek reasoner", () => {
    const meta = resolveModelMeta("deepseek-reasoner", { vendor: "deepseek" });
    expect(meta.deepseek?.isReasoner).toBe(true);
  });

  it("matches glm family for Anthropic-compatible upstream", () => {
    const meta = resolveModelMeta("glm-4.7");
    expect(meta.id).toBe("glm");
    expect(meta.reasoning.supportsAdaptiveThinking).toBe(false);
    expect(meta.reasoning.mapAdaptiveThinkingToEnabled).toBe(true);
    expect(meta.anthropic?.supportsSystemRoleInMessages).toBe(false);
    expect(meta.anthropic?.supportsDeferLoading).toBe(false);
    expect(meta.input.modalities).toEqual(["text"]);
  });

  it("matches glm-5v-turbo as vision multimodal", () => {
    const meta = resolveModelMeta("glm-5v-turbo");
    expect(meta.id).toBe("glm-vision");
    expect(meta.input.modalities).toEqual(["text", "image"]);
  });

  it("matches LongCat-2.0 as multimodal", () => {
    const meta = resolveModelMeta("LongCat-2.0");
    expect(meta.id).toBe("longcat");
    expect(meta.input.modalities).toEqual(["text", "image"]);
  });

  it("matches mimo-v2.5 image and mimo-v2.5-pro text-only", () => {
    expect(resolveModelMeta("mimo-v2.5").id).toBe("mimo-v2.5");
    expect(resolveModelMeta("mimo-v2.5").input.modalities).toEqual(["text", "image"]);
    expect(resolveModelMeta("mimo-v2.5-pro").id).toBe("mimo-v2.5-pro");
    expect(resolveModelMeta("mimo-v2.5-pro").input.modalities).toEqual(["text"]);
  });

  it("matches gemini 3.x series as multimodal", () => {
    for (const id of [
      "gemini-2.5-flash",
      "gemini-3.1-flash",
      "gemini-3.1-pro",
      "gemini-3.5-flash",
      "gemini-3.6-flash",
    ]) {
      expect(resolveModelMeta(id, { vendor: "gemini" }).input.modalities).toEqual([
        "text",
        "image",
      ]);
    }
  });

  it("matches grok-4.x as multimodal", () => {
    for (const id of ["grok-4.1", "grok-4.20", "grok-4.3", "grok-4.5"]) {
      const meta = resolveModelMeta(id);
      expect(meta.id).toBe("grok");
      expect(meta.input.modalities).toEqual(["text", "image"]);
    }
  });

  it("uses conservative unknown fallback for unrecognized ids", () => {
    const meta = resolveModelMeta("totally-unknown-model-xyz");
    expect(meta.id).toBe(GLOBAL_UNKNOWN_MODEL_META.id);
    expect(meta.reasoning.supportsEffort).toBe(false);
    expect(meta.reasoning.supportsThinking).toBe(false);
    expect(meta.input.modalities).toEqual(["text"]);
    expect(meta.vision.enabled).toBe(false);
  });

  it("matches kimi k2.6 and kimi-k3 as multimodal", () => {
    for (const id of ["kimi-k2.6", "kimi-k3", "kimi-k3-preview"]) {
      const meta = resolveModelMeta(id);
      expect(meta.id).toBe("kimi");
      expect(meta.input.modalities).toEqual(["text", "image"]);
      expect(meta.vision.enabled).toBe(true);
    }
  });

  it("keeps gpt-3.5 text-only while other gpt-* are multimodal", () => {
    expect(resolveModelMeta("gpt-3.5-turbo").input.modalities).toEqual(["text"]);
    expect(resolveModelMeta("gpt-4.1").input.modalities).toEqual(["text", "image"]);
  });

  it("uses vendor default when family missing but vendor hint provided", () => {
    const meta = resolveModelMeta("custom-deployment-name", { vendor: "anthropic" });
    expect(meta.vendor).toBe("anthropic");
    expect(meta.reasoning.supportsEffort).toBe(true);
    expect(meta.anthropic?.supportsSystemRoleInMessages).toBe(true);
    expect(meta.anthropic?.supportsContextManagement).toBe(false);
    expect(meta.anthropic?.supportsStructuredOutputs).toBe(false);
    expect(meta.input.modalities).toContain("image");
  });

  it("lists all registered families", () => {
    expect(listModelFamilies().length).toBeGreaterThan(5);
  });
});
