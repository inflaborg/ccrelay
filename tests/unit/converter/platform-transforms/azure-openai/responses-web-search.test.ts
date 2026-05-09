import { describe, it, expect } from "vitest";
import {
  azureResponsesWebSearchResponseTransform,
  responsesJsonOutputHasHostedWebSearchSignals,
} from "@/converter/platform-transforms/azure-openai/responses-web-search";

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI Responses wire field names in fixtures */

describe("azureResponsesWebSearchResponseTransform", () => {
  it("maps web_search_call + message with citations to Anthropic blocks", () => {
    const body = {
      object: "response",
      id: "resp_test",
      model: "gpt-5.4",
      output: [
        {
          type: "web_search_call",
          id: "ws_abc",
          status: "completed",
          action: { type: "search", query: "weather today" },
        },
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "It is sunny.",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://example.com/w",
                  title: "Weather",
                  start_index: 0,
                  end_index: 5,
                },
              ],
            },
          ],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    };

    expect(responsesJsonOutputHasHostedWebSearchSignals(body)).toBe(true);

    const structural = [{ type: "text" as const, text: "It is sunny." }];
    const merged = azureResponsesWebSearchResponseTransform(body, structural);

    const types = merged.map(b => b.type);
    expect(types).toContain("server_tool_use");
    expect(types).toContain("web_search_tool_result");
    expect(types).toContain("text");

    const st = merged.find(b => b.type === "server_tool_use");
    expect(st && st.type === "server_tool_use" && st.name).toBe("web_search");
    if (st && st.type === "server_tool_use") {
      expect(st.id).toBe("ws_abc");
      expect(st.input).toEqual({ query: "weather today" });
    }
  });

  it("passes through structural content when output has no web search signals", () => {
    const body = {
      object: "response",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hello." }],
        },
      ],
    };
    expect(responsesJsonOutputHasHostedWebSearchSignals(body)).toBe(false);
    const structural = [{ type: "text" as const, text: "Hello." }];
    expect(azureResponsesWebSearchResponseTransform(body, structural)).toEqual(structural);
  });
});
