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

  it("maps Responses cache read and write into Anthropic usage", () => {
    const body = {
      object: "response",
      id: "resp_cache",
      model: "gpt-6-sol-1",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
      usage: {
        input_tokens: 100180,
        input_tokens_details: {
          cache_write_tokens: 63,
          cached_tokens: 100114,
        },
        output_tokens: 894,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 101074,
      },
    };

    const anth = convertResponsesApiJsonToAnthropicMessageResponse(body, "claude");
    expect(anth.usage).toEqual({
      input_tokens: 3,
      output_tokens: 894,
      cache_read_input_tokens: 100114,
      cache_creation_input_tokens: 63,
    });
  });

  it("subtracts cached_tokens when the upstream reports no cache write", () => {
    const body = {
      object: "response",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
      usage: {
        input_tokens: 1200,
        output_tokens: 340,
        input_tokens_details: { cached_tokens: 800 },
      },
    };

    const anth = convertResponsesApiJsonToAnthropicMessageResponse(body, "m");
    expect(anth.usage).toEqual({
      input_tokens: 400,
      output_tokens: 340,
      cache_read_input_tokens: 800,
    });
  });

  it("returns empty text block when output is missing", () => {
    const anth = convertResponsesApiJsonToAnthropicMessageResponse(
      { object: "response", output: [] },
      "m"
    );
    expect(anth.content).toEqual([{ type: "text", text: "" }]);
  });
});
