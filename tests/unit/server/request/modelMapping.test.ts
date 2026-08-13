import { describe, expect, it } from "vitest";
import { matchModel } from "@/server/request/modelMapping";
import type { ModelMapEntry } from "@/types";

describe("matchModel", () => {
  it("prefers identity exact match over gpt-* wildcard", () => {
    const mapWithIdentity: ModelMapEntry[] = [
      { pattern: "claude-abc001", model: "glm-5.1" },
      { pattern: "glm-5.1", model: "glm-5.1" },
      { pattern: "glm-4.7", model: "glm-4.7" },
      { pattern: "claude-*", model: "glm-5.1" },
      { pattern: "gpt-*", model: "glm-5.1" },
    ];
    expect(matchModel("glm-4.7", mapWithIdentity)?.targetModel).toBe("glm-4.7");
    expect(matchModel("gpt-5.4-mini", mapWithIdentity)?.targetModel).toBe("glm-5.1");
  });

  it("maps gpt-* wildcard to first model when no identity rule exists", () => {
    const mapWithoutGptIdentity: ModelMapEntry[] = [
      { pattern: "claude-abc001", model: "glm-5.1" },
      { pattern: "glm-5.1", model: "glm-5.1" },
      { pattern: "glm-4.7", model: "glm-4.7" },
      { pattern: "claude-*", model: "glm-5.1" },
      { pattern: "gpt-*", model: "glm-5.1" },
    ];
    expect(matchModel("gpt-5.4-mini", mapWithoutGptIdentity)?.targetModel).toBe("glm-5.1");
  });

  it("prefers Claude family wildcards over claude-* catch-all", () => {
    const map: ModelMapEntry[] = [
      { pattern: "claude-haiku-*", model: "glm-4.6" },
      { pattern: "claude-sonnet-*", model: "glm-4.7" },
      { pattern: "claude-opus-*", model: "glm-5.1" },
      { pattern: "claude-*", model: "glm-5.1" },
      { pattern: "gpt-*", model: "glm-5.1" },
    ];
    expect(matchModel("claude-haiku-4-5", map)?.targetModel).toBe("glm-4.6");
    expect(matchModel("claude-sonnet-4-6", map)?.targetModel).toBe("glm-4.7");
    expect(matchModel("claude-opus-4-6", map)?.targetModel).toBe("glm-5.1");
    expect(matchModel("claude-3-5-sonnet-20241022", map)?.targetModel).toBe("glm-5.1");
  });

  it("maps to self when identity rule exists for gpt model id", () => {
    const mapWithGptIdentity: ModelMapEntry[] = [
      { pattern: "glm-5.1", model: "glm-5.1" },
      { pattern: "gpt-5.4-mini", model: "gpt-5.4-mini" },
      { pattern: "gpt-*", model: "glm-5.1" },
    ];
    expect(matchModel("gpt-5.4-mini", mapWithGptIdentity)?.targetModel).toBe("gpt-5.4-mini");
  });
});
