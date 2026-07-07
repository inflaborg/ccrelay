import { describe, expect, it } from "vitest";
import { resolveModelMeta, listModelFamilies } from "@/converter/model-meta/registry";
import { GLOBAL_UNKNOWN_MODEL_META } from "@/converter/model-meta/defaults";

describe("resolveModelMeta", () => {
  it("matches claude-haiku family with reasoning disabled", () => {
    const meta = resolveModelMeta("claude-haiku-4-5", { vendor: "anthropic" });
    expect(meta.id).toBe("claude-haiku");
    expect(meta.reasoning.supportsEffort).toBe(false);
    expect(meta.reasoning.supportsThinking).toBe(false);
    expect(meta.vision.enabled).toBe(true);
  });

  it("matches claude-sonnet family with reasoning enabled", () => {
    const meta = resolveModelMeta("claude-sonnet-4-20250514", { vendor: "anthropic" });
    expect(meta.id).toBe("claude-sonnet");
    expect(meta.reasoning.supportsEffort).toBe(true);
    expect(meta.reasoning.supportsAdaptiveThinking).toBe(true);
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

  it("uses conservative unknown fallback for unrecognized ids", () => {
    const meta = resolveModelMeta("totally-unknown-model-xyz");
    expect(meta.id).toBe(GLOBAL_UNKNOWN_MODEL_META.id);
    expect(meta.reasoning.supportsEffort).toBe(false);
    expect(meta.reasoning.supportsThinking).toBe(false);
  });

  it("uses vendor default when family missing but vendor hint provided", () => {
    const meta = resolveModelMeta("custom-deployment-name", { vendor: "anthropic" });
    expect(meta.vendor).toBe("anthropic");
    expect(meta.reasoning.supportsEffort).toBe(true);
  });

  it("lists all registered families", () => {
    expect(listModelFamilies().length).toBeGreaterThan(5);
  });
});
