import { describe, it, expect } from "vitest";
import {
  buildModelsListFallback,
  buildOpenAIModelsListFromProvider,
  buildAnthropicModelsListFromProvider,
} from "@/converter/modelsFallback";
import type { Provider } from "@/types";

function prov(over: Partial<Provider> & Pick<Provider, "id" | "providerType">): Provider {
  return {
    name: "n",
    baseUrl: "https://x",
    mode: "passthrough",
    headers: {},
    ...over,
  };
}

describe("buildModelsListFallback", () => {
  it("auto: openai provider -> OpenAI shape", () => {
    const j = buildModelsListFallback(prov({ id: "x", providerType: "openai", modelsListFormat: "auto" }));
    expect(j).toHaveProperty("object", "list");
    expect(Array.isArray((j as { data: unknown[] }).data)).toBe(true);
  });

  it("auto: anthropic provider -> Anthropic shape", () => {
    const j = buildModelsListFallback(prov({ id: "x", providerType: "anthropic", modelsListFormat: "auto" }));
    expect(j).toHaveProperty("data");
    expect(j).toHaveProperty("has_more", false);
    expect((j as { data: { id: string }[] }).data[0]).toHaveProperty("type", "model");
  });

  it("explicit openai on anthropic-type provider", () => {
    const j = buildModelsListFallback(
      prov({ id: "x", providerType: "anthropic", modelsListFormat: "openai" })
    );
    expect(j).toHaveProperty("object", "list");
  });
});

describe("buildOpenAIModelsListFromProvider", () => {
  it("shows pattern and model ids", () => {
    const j = buildOpenAIModelsListFromProvider(
      prov({
        id: "p",
        providerType: "openai",
        modelMap: [{ pattern: "*", model: "m1" }],
      })
    );
    expect(j.data[0].id).toBe("*");
    expect(j.data[1].id).toBe("m1");
    expect(j.data).toHaveLength(2);
  });

  it("deduplicates when pattern equals model", () => {
    const j = buildOpenAIModelsListFromProvider(
      prov({
        id: "p",
        providerType: "openai",
        modelMap: [{ pattern: "gpt-4o", model: "gpt-4o" }],
      })
    );
    expect(j.data).toHaveLength(1);
    expect(j.data[0].id).toBe("gpt-4o");
  });
});

describe("buildAnthropicModelsListFromProvider", () => {
  it("includes pagination fields", () => {
    const j = buildAnthropicModelsListFromProvider(
      prov({ id: "p", providerType: "anthropic", modelMap: [{ pattern: "*", model: "claude-x" }] })
    );
    expect(j.first_id).toBe("*");
    expect(j.last_id).toBe("claude-x");
    expect(j.has_more).toBe(false);
    expect(j.data).toHaveLength(2);
  });
});
