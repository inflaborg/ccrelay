import { describe, it, expect } from "vitest";
import { azureWebSearchRequestOverride } from "@/converter/platform-transforms/azure-openai/request-override";

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI wire fixtures */

describe("azureWebSearchRequestOverride", () => {
  it("converts Chat JSON with hosted web_search tool to Responses body and /responses path", () => {
    const chatBody = {
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "web_search" }],
    };
    const out = azureWebSearchRequestOverride(chatBody, "/chat/completions");
    expect(out).not.toBeNull();
    if (!out) {
      return;
    }
    expect(out.path).toBe("/responses");
    expect(out.responseFormat).toBe("responses");
    expect(out.body.stream).toBe(false);
    expect(out.body.model).toBe("gpt-5.4");
  });

  it("strips max_uses from web_search for Azure Responses tools (type + user_location only)", () => {
    const chatBody = {
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { type: "web_search", max_uses: 8 },
        {
          type: "web_search",
          user_location: { type: "approximate", country: "IN" },
        },
      ],
    };
    const out = azureWebSearchRequestOverride(chatBody, "/chat/completions");
    expect(out?.body.tools).toEqual([
      { type: "web_search" },
      {
        type: "web_search",
        user_location: { type: "approximate", country: "IN" },
      },
    ]);
  });

  it("returns null when no web_search tool", () => {
    expect(
      azureWebSearchRequestOverride({ model: "x", messages: [] }, "/chat/completions")
    ).toBeNull();
  });
});
