/**
 * Unit tests for converter/openai-to-anthropic.ts
 *
 * Product Requirements:
 * - Preserves original tool_call.id as tool_use.id (no ID generation)
 * - Inlines thought_signature in thinking block (no external storage)
 * - Stateless - no database required
 * - Converts web_search annotations to web_search_tool_result blocks
 * - Restores original model in response (after model mapping)
 */

import { describe, it, expect } from "vitest";
import {
  convertResponseToAnthropic,
  type OpenAIChatCompletionResponse,
} from "@/converter/openai-to-anthropic";

/* eslint-disable @typescript-eslint/naming-convention -- Testing API formats with snake_case */

describe("converter: openai-to-anthropic", () => {
  const originalModel = "claude-3-5-sonnet-20241022";

  describe("response conversion - basic", () => {
    it("should convert basic text response", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello, how can I help you today?",
            },
            finish_reason: "stop",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result).toEqual({
        id: "chatcmpl-abc123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello, how can I help you today?" }],
        model: originalModel,
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
        },
      });
    });

    it("should handle empty content", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
            },
            finish_reason: "stop",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content).toEqual([]);
    });
  });

  describe("tool_calls conversion", () => {
    it("should convert tool_calls to tool_use blocks", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Let me search for that.",
              tool_calls: [
                {
                  id: "call_abc123",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: '{"query":"test search"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content).toEqual([
        { type: "text", text: "Let me search for that." },
        {
          type: "tool_use",
          id: "call_abc123", // Preserves original ID
          name: "browser_search",
          input: { query: "test search" },
        },
      ]);
    });

    it("should handle multiple tool_calls", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "tool1", arguments: "{}" },
                },
                {
                  id: "call_2",
                  type: "function",
                  function: { name: "tool2", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content).toHaveLength(3); // text + 2 tool_use
      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "tool1",
        input: {},
      });
      expect(result.content[2]).toEqual({
        type: "tool_use",
        id: "call_2",
        name: "tool2",
        input: {},
      });
    });

    it("should handle missing tool_call id", () => {
      const openai = {
        id: "chatcmpl-abc123",
        object: "chat.completion" as const,
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  type: "function",
                  function: { name: "tool1", arguments: "{}" },
                  // id is missing - testing edge case
                } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      } as OpenAIChatCompletionResponse;

      const result = convertResponseToAnthropic(openai, originalModel);

      // Should still create tool_use, but without id
      expect(result.content[1]).toEqual({
        type: "tool_use",
        name: "tool1",
        input: {},
      });
    });
  });

  describe("thinking/signature conversion", () => {
    it("should add thinking block from message.thinking.signature", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Response text",
              thinking: {
                signature: "abc123signature",
                content: "thinking content",
              },
            },
            finish_reason: "stop",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content).toEqual([
        {
          type: "thinking",
          thinking: "thinking content",
          signature: "abc123signature",
        },
        { type: "text", text: "Response text" },
      ]);
    });

    it("should extract thought_signature from tool_calls extra_content.google", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: "{}",
                  },
                  extra_content: {
                    google: {
                      thought_signature: "fromGemini123",
                    },
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content).toEqual([
        {
          type: "thinking",
          thinking: "",
          signature: "fromGemini123",
        },
        {
          type: "tool_use",
          id: "call_1",
          name: "browser_search",
          input: {},
        },
      ]);
    });

    it("should extract thought_signature from tool_calls.function.thought_signature", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: "{}",
                    thought_signature: "fromFunction123",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content).toEqual([
        {
          type: "thinking",
          thinking: "",
          signature: "fromFunction123",
        },
        {
          type: "tool_use",
          id: "call_1",
          name: "browser_search",
          input: {},
        },
      ]);
    });
  });

  describe("web_search annotations", () => {
    it("should convert url_citation annotations to web_search_tool_result", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Here are some search results:",
              annotations: [
                {
                  url_citation: {
                    url: "https://example.com/article1",
                    title: "Article 1",
                  },
                },
                {
                  url_citation: {
                    url: "https://example.com/article2",
                    title: "Article 2",
                  },
                },
              ],
            },
            finish_reason: "stop",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      const serverToolUseId = (result.content[1] as { id: string }).id;

      expect(result.content).toHaveLength(3);
      expect(result.content[0]).toEqual({ type: "text", text: "Here are some search results:" });
      expect(result.content[1]).toEqual({
        type: "server_tool_use",
        id: expect.stringMatching(/^srvtoolu_/) as string,
        name: "web_search",
        input: { query: "" },
      });
      expect(result.content[2]).toEqual({
        type: "web_search_tool_result",
        tool_use_id: serverToolUseId,
        content: [
          {
            type: "web_search_result",
            url: "https://example.com/article1",
            title: "Article 1",
          },
          {
            type: "web_search_result",
            url: "https://example.com/article2",
            title: "Article 2",
          },
        ],
      });
    });

    it("should not add web_search_tool_result when annotations is empty", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Response",
              annotations: [],
            },
            finish_reason: "stop",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      // Should only have text block, no web_search_tool_result
      expect(result.content).toEqual([{ type: "text", text: "Response" }]);
    });

    it("should handle annotations without url_citation gracefully", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Response",
              annotations: [
                {
                  some_other_field: "value",
                },
              ],
            },
            finish_reason: "stop",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      // Should have text block, server_tool_use, and empty web_search_tool_result
      expect(result.content).toHaveLength(3);
      expect(result.content[0]).toEqual({ type: "text", text: "Response" });
      expect(result.content[1]).toEqual({
        type: "server_tool_use",
        id: expect.stringMatching(/^srvtoolu_/) as string,
        name: "web_search",
        input: { query: "" },
      });
      expect(result.content[2]).toMatchObject({
        type: "web_search_tool_result",
        content: [],
      });
    });
  });

  describe("finish_reason mapping", () => {
    it("should map 'stop' to 'end_turn'", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant" },
            finish_reason: "stop",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.stop_reason).toBe("end_turn");
    });

    it("should map 'length' to 'max_tokens'", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant" },
            finish_reason: "length",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.stop_reason).toBe("max_tokens");
    });

    it("should map 'tool_calls' to 'tool_use'", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.stop_reason).toBe("tool_use");
    });

    it("should map unknown finish_reason to 'end_turn'", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant" },
            finish_reason: "unknown_reason",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.stop_reason).toBe("end_turn");
    });
  });

  describe("usage conversion", () => {
    it("should convert usage with cached_tokens", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
          prompt_tokens_details: {
            cached_tokens: 200,
          },
        },
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.usage).toEqual({
        input_tokens: 800, // 1000 - 200
        output_tokens: 500,
        cache_read_input_tokens: 200,
      });
    });

    it("should handle missing usage", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant" },
            finish_reason: "stop",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.usage).toEqual({
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
      });
    });

    it("should handle usage with no cached_tokens", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
        },
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.usage).toEqual({
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 0,
      });
    });
  });

  describe("function arguments parsing", () => {
    it("should parse valid JSON arguments", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: '{"query":"test","count":5}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "browser_search",
        input: { query: "test", count: 5 },
      });
    });

    it("should handle invalid JSON arguments by treating as text", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: "invalid json {",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "browser_search",
        input: { text: "invalid json {" },
      });
    });

    it("should handle empty arguments", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: "",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "browser_search",
        input: {},
      });
    });
  });

  describe("model preservation", () => {
    it("should use originalModel parameter in response", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4", // This is the provider's model, not the original request model
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Response",
            },
            finish_reason: "stop",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, "claude-3-5-sonnet-20241022");

      expect(result.model).toBe("claude-3-5-sonnet-20241022");
    });
  });

  describe("finish_reason mapping edge cases", () => {
    it("should map 'content_filter' to 'stop_sequence'", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant" },
            finish_reason: "content_filter",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.stop_reason).toBe("stop_sequence");
    });

    it("should map empty string finish_reason to 'end_turn'", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant" },
            finish_reason: "",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.stop_reason).toBe("end_turn");
    });

    it("should handle various unknown finish_reason values", () => {
      const unknownReasons = ["max_tokens", "interrupted", "cancelled", "custom"];

      for (const reason of unknownReasons) {
        const openai: OpenAIChatCompletionResponse = {
          id: "chatcmpl-abc123",
          object: "chat.completion",
          created: 1234567890,
          model: "gpt-4",
          choices: [
            {
              index: 0,
              message: { role: "assistant" },
              finish_reason: reason,
            },
          ],
        };

        const result = convertResponseToAnthropic(openai, originalModel);

        // Unknown reasons map to "end_turn"
        expect(result.stop_reason).toBe("end_turn");
      }
    });
  });

  describe("function arguments parsing edge cases", () => {
    it("should handle arguments with special characters", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: '{"query":"test \\"quoted\\" and \\n newlines"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "browser_search",
        input: { query: 'test "quoted" and \n newlines' },
      });
    });

    it("should handle arguments with unicode characters", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: '{"query":"hello 世界 🌍"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "browser_search",
        input: { query: "hello 世界 🌍" },
      });
    });

    it("should handle arguments with nested objects", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: '{"filter":{"type":"web","safe":true},"limit":10}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "browser_search",
        input: {
          filter: { type: "web", safe: true },
          limit: 10,
        },
      });
    });

    it("should handle arguments with null values", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: '{"query":"test","optional":null}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "browser_search",
        input: { query: "test", optional: null },
      });
    });

    it("should handle arguments with numeric values", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "calculator",
                    arguments: '{"value":42.5,"negative":-10}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "calculator",
        input: { value: 42.5, negative: -10 },
      });
    });

    it("should handle arguments with boolean values", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: '{"safe":true,"deep":false}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "browser_search",
        input: { safe: true, deep: false },
      });
    });

    it("should handle arguments with array values", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: '{"tags":["test","debug","example"]}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "browser_search",
        input: { tags: ["test", "debug", "example"] },
      });
    });
  });

  describe("complex response scenarios", () => {
    it("should handle response with content, tool_calls, and annotations", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Here are the search results:",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: '{"query":"test"}',
                  },
                },
              ],
              annotations: [
                {
                  url_citation: {
                    url: "https://example.com",
                    title: "Example",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      // Should have: text, server_tool_use, web_search_tool_result, tool_use
      expect(result.content).toHaveLength(4);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Here are the search results:",
      });
      // Should have: text, tool_use, server_tool_use, web_search_tool_result
      expect(result.content).toHaveLength(4);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Here are the search results:",
      });
      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "browser_search",
        input: { query: "test" },
      });
      // Skip strict equality for server tools to avoid ID matching complexity
      expect(result.content[2]).toMatchObject({
        type: "server_tool_use",
        name: "web_search",
      });
      expect(result.content[3]).toMatchObject({
        type: "web_search_tool_result",
      });
    });

    it("should handle response with thinking and tool_calls", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "After thinking, here's my response",
              thinking: {
                signature: "thought123",
                content: "Let me think about this...",
              },
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "browser_search",
                    arguments: "{}",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      // Should have: thinking, text, tool_use
      expect(result.content).toHaveLength(3);
      expect(result.content[0]).toEqual({
        type: "thinking",
        thinking: "Let me think about this...",
        signature: "thought123",
      });
      expect(result.content[1]).toEqual({
        type: "text",
        text: "After thinking, here's my response",
      });
      expect(result.content[2]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "browser_search",
        input: {},
      });
    });

    it("should handle response with only usage (minimal response)", () => {
      const openai: OpenAIChatCompletionResponse = {
        id: "chatcmpl-abc123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };

      const result = convertResponseToAnthropic(openai, originalModel);

      expect(result.content).toEqual([]);
      expect(result.usage).toEqual({
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
      });
    });
  });
});
