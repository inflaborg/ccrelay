/* eslint-disable @typescript-eslint/naming-convention -- wire JSON uses snake_case */
import { describe, it, expect } from "vitest";
import {
  convertOpenAIModelsToAnthropic,
  convertAnthropicModelsToOpenAI,
  isModelsListUpstreamPath,
  isOpenAIModelsListJson,
  isAnthropicModelsListJson,
} from "@/converter/modelsFallback";

describe("isModelsListUpstreamPath", () => {
  it("recognizes rewritten OpenAI /models paths (query stripped)", () => {
    expect(isModelsListUpstreamPath("/models")).toBe(true);
    expect(isModelsListUpstreamPath("/v1/models")).toBe(true);
    expect(isModelsListUpstreamPath("/models?limit=1")).toBe(true);
    expect(isModelsListUpstreamPath("/chat/completions")).toBe(false);
  });
});

describe("isOpenAIModelsListJson / isAnthropicModelsListJson", () => {
  it("requires object list plus data array for OpenAI shape guard", () => {
    expect(
      isOpenAIModelsListJson({
        object: "list",
        data: [],
      })
    ).toBe(true);
    expect(isOpenAIModelsListJson({ data: [{ id: "x" }] })).toBe(false);
    expect(isOpenAIModelsListJson({ object: "foo", data: [] })).toBe(false);
  });

  it("requires data array for Anthropic minimal guard", () => {
    expect(isAnthropicModelsListJson({ data: [] })).toBe(true);
    expect(isAnthropicModelsListJson({})).toBe(false);
  });
});

describe("convertOpenAIModelsToAnthropic / convertAnthropicModelsToOpenAI", () => {
  it("converts OpenAI list to Anthropic list", () => {
    const a = convertOpenAIModelsToAnthropic({
      object: "list",
      data: [
        {
          id: "m",
          object: "model",
          created: 1,
          owned_by: "x",
        },
      ],
    });
    expect(a.data[0].id).toBe("m");
    expect(a.data[0].type).toBe("model");
    expect(a.first_id).toBe("m");
    expect(a.last_id).toBe("m");
    expect(a.has_more).toBe(false);
  });

  it("converts Anthropic list to OpenAI list", () => {
    const o = convertAnthropicModelsToOpenAI({
      data: [{ id: "n", type: "model", display_name: "N" }],
      first_id: "n",
      has_more: false,
      last_id: "n",
    });
    expect(o.object).toBe("list");
    expect(o.data[0].id).toBe("n");
    expect(o.data[0].object).toBe("model");
  });
});
