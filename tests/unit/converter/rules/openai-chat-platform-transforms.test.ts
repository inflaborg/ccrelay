import { describe, expect, it } from "vitest";
import { resolveOpenAICompatForAnthropicToOpenAI } from "@/converter/rules/openai-chat-platform-transforms";
import type { Provider } from "@/types";

function p(
  partial: Partial<Provider> & Pick<Provider, "id" | "name" | "baseUrl" | "mode" | "providerType">
): Provider {
  const { id, name, baseUrl, mode, providerType, ...rest } = partial;
  return {
    id,
    name,
    baseUrl,
    mode,
    providerType,
    ...rest,
  };
}

describe("resolveOpenAICompatForAnthropicToOpenAI", () => {
  it("returns azure_openai only when explicitly set", () => {
    expect(
      resolveOpenAICompatForAnthropicToOpenAI(
        p({
          id: "x",
          name: "x",
          baseUrl: "https://api.openai.com/v1",
          mode: "passthrough",
          providerType: "openai",
          openaiCompat: "azure_openai",
        })
      )
    ).toBe("azure_openai");
  });

  it("returns default when set to default", () => {
    expect(
      resolveOpenAICompatForAnthropicToOpenAI(
        p({
          id: "x",
          name: "x",
          baseUrl: "https://example.cognitiveservices.azure.com/",
          mode: "passthrough",
          providerType: "openai",
          openaiCompat: "default",
        })
      )
    ).toBe("default");
  });

  it("returns default when openaiCompat is omitted (no URL inference)", () => {
    expect(
      resolveOpenAICompatForAnthropicToOpenAI(
        p({
          id: "x",
          name: "x",
          baseUrl:
            "https://foo.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-02-15-preview",
          mode: "passthrough",
          providerType: "openai",
        })
      )
    ).toBe("default");
  });
});
