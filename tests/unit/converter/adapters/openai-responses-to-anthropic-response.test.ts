import { describe, it, expect } from "vitest";
import {
  convertResponsesApiJsonToAnthropicMessageResponse,
  isOpenAIResponsesApiResultBody,
} from "@/converter/adapters/openai-responses-to-anthropic-response";

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI Responses wire field names in fixtures */

describe("convertResponsesApiJsonToAnthropicMessageResponse", () => {
  it("maps message output_text to text only (hosted web search shaping is platform-transform)", () => {
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

    expect(isOpenAIResponsesApiResultBody(body)).toBe(true);

    const anth = convertResponsesApiJsonToAnthropicMessageResponse(body, "claude-sonnet");
    expect(anth.type).toBe("message");
    expect(anth.role).toBe("assistant");
    expect(anth.model).toBe("gpt-5.4");
    expect(anth.usage.input_tokens).toBe(100);
    expect(anth.usage.output_tokens).toBe(20);

    expect(anth.content).toEqual([{ type: "text", text: "It is sunny." }]);
  });

  it("returns empty text block when output is missing", () => {
    const anth = convertResponsesApiJsonToAnthropicMessageResponse(
      { object: "response", output: [] },
      "m"
    );
    expect(anth.content).toEqual([{ type: "text", text: "" }]);
  });
});
