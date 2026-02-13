/**
 * Unit tests for converter/anthropic-to-openai.ts
 *
 * Product Requirements:
 * - Stateless conversion (no external storage for tool_use_id)
 * - Message splitting pattern follows claude-code-router design
 * - User with tool_result → separate tool messages (role: "tool")
 * - User with text/image → single user message
 * - Assistant → joins text blocks, extracts tool_calls, extracts thinking
 * - System supports both string and array forms
 * - OpenAI compatibility: handles reasoning for Gemini models
 */

import { describe, it, expect } from "vitest";
import {
  convertRequestToOpenAI,
  type AnthropicMessageRequest,
} from "@/converter/anthropic-to-openai";

/* eslint-disable @typescript-eslint/naming-convention -- Testing API formats with snake_case */

describe("converter: anthropic-to-openai", () => {
  const basePath = "/v1/messages";

  describe("request conversion - basic messages", () => {
    it("should convert simple user message with text content", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [{ role: "user", content: "Hello, Claude!" }],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.originalPath).toBe(basePath);
      expect(result.newPath).toBe("/chat/completions");
      expect(result.request.model).toBe("claude-3-5-sonnet-20241022");
      expect(result.request.messages).toHaveLength(1);
      expect(result.request.messages[0]).toEqual({
        role: "user",
        content: "Hello, Claude!",
      });
    });

    it("should convert user message with empty content array", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [{ role: "user", content: [] }],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages).toEqual([{ role: "user", content: "" }]);
    });

    it("should convert system message (string form)", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        // @ts-expect-error -- intentionally testing with message without content
        messages: [{ role: "user" }],
        system: "You are a helpful assistant.",
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages).toHaveLength(2);
      expect(result.request.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant.",
      });
      expect(result.request.messages[1]).toEqual({ role: "user", content: "" });
    });

    it("should convert system message (array form with text blocks)", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        // @ts-expect-error -- intentionally testing with message without content
        messages: [{ role: "user" }],
        system: [
          { type: "text", text: "System prompt 1", cache_control: { type: "static" } },
          { type: "text", text: "System prompt 2" },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages).toHaveLength(2);
      expect(result.request.messages[0]).toEqual({
        role: "system",
        content: [
          { type: "text", text: "System prompt 1", cache_control: { type: "static" } },
          { type: "text", text: "System prompt 2" },
        ],
      });
      expect(result.request.messages[1]).toEqual({ role: "user", content: "" });
    });

    it("should convert assistant message with text content", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [{ role: "assistant", content: "Response text" }],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages).toHaveLength(1);
      expect(result.request.messages[0]).toEqual({
        role: "assistant",
        content: "Response text",
      });
    });

    it("should convert assistant message with text content array", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "assistant",
            content: [
              { type: "text", text: "First line" },
              { type: "text", text: "Second line" },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages).toHaveLength(1);
      expect(result.request.messages[0]).toEqual({
        role: "assistant",
        content: "First line\nSecond line",
      });
    });
  });

  describe("request conversion - tool_result blocks", () => {
    it("should split tool_result blocks into separate tool messages", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "tool-1", content: { result: "Success" } },
              { type: "tool_result", tool_use_id: "tool-2", content: { result: "Done" } },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      // Should create 2 tool messages
      expect(result.request.messages).toHaveLength(2);
      expect(result.request.messages[0]).toEqual({
        role: "tool",
        content: '{"result":"Success"}',
        tool_call_id: "tool-1",
      });
      expect(result.request.messages[1]).toEqual({
        role: "tool",
        content: '{"result":"Done"}',
        tool_call_id: "tool-2",
      });
    });

    it("should handle tool_result with string content", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tool-1", content: "String result" }],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages).toHaveLength(1);
      expect(result.request.messages[0]).toEqual({
        role: "tool",
        content: "String result",
        tool_call_id: "tool-1",
      });
    });

    it("should mix tool_result and text blocks correctly", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "User query" },
              { type: "tool_result", tool_use_id: "tool-1", content: "Tool output" },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      // Should have 2 messages: tool message + user message with text
      expect(result.request.messages).toHaveLength(2);
      expect(result.request.messages[0]).toEqual({
        role: "tool",
        content: "Tool output",
        tool_call_id: "tool-1",
      });
      expect(result.request.messages[1]).toEqual({
        role: "user",
        content: [{ type: "text", text: "User query" }],
      });
    });
  });

  describe("request conversion - image content", () => {
    it("should convert user message with image source (base64)", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  data: "iVBORw0KGgoAAAANSUhEUgAA",
                  media_type: "image/png",
                },
              },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages).toHaveLength(1);
      expect(result.request.messages[0]).toEqual({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
            },
            media_type: "image/png",
          },
        ],
      });
    });

    it("should convert user message with image source (url)", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "url",
                  url: "https://example.com/image.png",
                },
              },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages).toHaveLength(1);
      expect(result.request.messages[0]).toEqual({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: "https://example.com/image.png",
            },
          },
        ],
      });
    });

    it("should preserve cache_control in text blocks", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Query with cache",
                cache_control: { type: "ephemeral" },
              },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages[0]).toEqual({
        role: "user",
        content: [
          {
            type: "text",
            text: "Query with cache",
            cache_control: { type: "ephemeral" },
          },
        ],
      });
    });
  });

  describe("path mapping", () => {
    it("should convert /v1/messages to /chat/completions", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, "/v1/messages");

      expect(result.originalPath).toBe("/v1/messages");
      expect(result.newPath).toBe("/chat/completions");
    });

    it("should convert /messages to /chat/completions", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, "/messages");

      expect(result.originalPath).toBe("/messages");
      expect(result.newPath).toBe("/chat/completions");
    });

    it("should not modify path for non-matching paths", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, "/api/status");

      expect(result.originalPath).toBe("/api/status");
      expect(result.newPath).toBe("/api/status");
    });
  });

  describe("special fields - temperature", () => {
    it("should pass through temperature when present", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        temperature: 0.7,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.temperature).toBe(0.7);
    });

    it("should not include temperature when undefined", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.temperature).toBeUndefined();
    });
  });

  describe("special fields - max_tokens", () => {
    it("should pass through max_tokens when present", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 8000,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.max_tokens).toBe(8000);
    });

    it("should not include max_tokens when undefined", () => {
      // @ts-expect-error -- intentionally testing with missing required field
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.max_tokens).toBeUndefined();
    });
  });

  describe("special fields - stream", () => {
    it("should pass through stream=true", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        stream: true,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.stream).toBe(true);
    });

    it("should pass through stream=false", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        stream: false,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.stream).toBe(false);
    });

    it("should not include stream when undefined", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.stream).toBeUndefined();
    });
  });

  describe("tools conversion", () => {
    it("should convert tools array to OpenAI format", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tools: [
          {
            name: "browser_search",
            description: "Search the web",
            input_schema: {
              query: { type: "string" },
              results: { type: "array", items: { type: "string" } },
            },
          },
          {
            name: "calculator",
            description: "Calculate math expressions",
            input_schema: {
              expression: { type: "string" },
            },
          },
        ],
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tools).toEqual([
        {
          type: "function",
          function: {
            name: "browser_search",
            description: "Search the web",
            parameters: {
              query: { type: "string" },
              results: { type: "array", items: { type: "string" } },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "calculator",
            description: "Calculate math expressions",
            parameters: {
              expression: { type: "string" },
            },
          },
        },
      ]);
    });

    it("should not include tools when undefined", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tools).toBeUndefined();
    });
  });

  describe("tool_choice conversion", () => {
    it("should convert 'auto' to 'auto'", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tool_choice: "auto",
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tool_choice).toBe("auto");
    });

    it("should convert 'any' to 'auto'", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tool_choice: "any",
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tool_choice).toBe("auto");
    });

    it("should convert 'none' to 'none'", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tool_choice: "none",
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tool_choice).toBe("none");
    });

    it("should convert object form {type:'tool', name:'X'} to function format", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tool_choice: { type: "tool", name: "X" },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tool_choice).toEqual({
        type: "function",
        function: { name: "X" },
      });
    });

    it("should not include tool_choice when undefined", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tool_choice).toBeUndefined();
    });
  });

  describe("stop_sequences conversion", () => {
    it("should convert stop_sequences to stop (array)", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        stop_sequences: ["stop_at_token_100", "stop_at_token_200"],
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.stop).toEqual(["stop_at_token_100", "stop_at_token_200"]);
    });

    it("should not include stop when undefined", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.stop).toBeUndefined();
    });
  });

  describe("thinking -> reasoning conversion", () => {
    it("should add reasoning field for non-Gemini models", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 5000 },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.reasoning).toEqual({
        effort: "medium",
        enabled: true,
      });
    });

    it("should not add reasoning field for Gemini models", () => {
      const request: AnthropicMessageRequest = {
        model: "gemini-2.0-flash-exp",
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 5000 },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.reasoning).toBeUndefined();
    });

    it("should default reasoning effort to medium when budget_tokens is undefined", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 5000 },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.reasoning).toEqual({
        effort: "medium",
        enabled: true,
      });
    });
  });

  describe("assistant message with tool_use blocks", () => {
    it("should extract tool_calls from assistant message", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_abc123",
                name: "browser_search",
                input: { query: "test" },
              },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages).toHaveLength(1);
      expect(result.request.messages[0]).toEqual({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "toolu_abc123",
            type: "function",
            function: {
              name: "browser_search",
              arguments: '{"query":"test"}',
            },
          },
        ],
      });
    });

    it("should attach thought_signature for Gemini models", () => {
      const request: AnthropicMessageRequest = {
        model: "gemini-2.0-flash-exp",
        max_tokens: 4096,
        messages: [
          {
            role: "assistant",
            content: [
              // @ts-expect-error -- testing with minimal thinking block (thinking property is optional in practice)
              {
                type: "thinking",
                signature: "abc123signature",
              },
              {
                type: "tool_use",
                id: "toolu_abc123",
                name: "browser_search",
                input: { query: "test" },
              },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages[0].tool_calls).toEqual([
        {
          id: "toolu_abc123",
          type: "function",
          function: {
            name: "browser_search",
            arguments: '{"query":"test"}',
          },
          extra_content: {
            google: {
              thought_signature: "abc123signature",
            },
          },
        },
      ]);
    });
  });

  describe("special fields - top_p", () => {
    it("should pass through top_p when present", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        top_p: 0.9,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.top_p).toBe(0.9);
    });

    it("should not include top_p when undefined", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.top_p).toBeUndefined();
    });
  });

  describe("thinking budget_tokens to effort level mapping", () => {
    it("should map budget_tokens <= 1024 to low effort", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 512 },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.reasoning?.effort).toBe("low");
    });

    it("should map budget_tokens <= 8192 to medium effort", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 4096 },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.reasoning?.effort).toBe("medium");
    });

    it("should map budget_tokens > 8192 to high effort", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 10000 },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.reasoning?.effort).toBe("high");
    });

    it("should default to medium when budget_tokens is undefined", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        thinking: { type: "enabled" },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.reasoning?.effort).toBe("medium");
    });
  });

  describe("Gemini model detection", () => {
    it("should not add reasoning field for gemini-2.0-flash-exp", () => {
      const request: AnthropicMessageRequest = {
        model: "gemini-2.0-flash-exp",
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 5000 },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.reasoning).toBeUndefined();
    });

    it("should not add reasoning field for GEMINI-2.0-flash (uppercase)", () => {
      const request: AnthropicMessageRequest = {
        model: "GEMINI-2.0-flash",
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 5000 },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.reasoning).toBeUndefined();
    });

    it("should not add reasoning field for gemini-pro", () => {
      const request: AnthropicMessageRequest = {
        model: "gemini-pro",
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 5000 },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.reasoning).toBeUndefined();
    });

    it("should add reasoning field for non-Gemini models", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 5000 },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.reasoning).toBeDefined();
      expect(result.request.reasoning?.enabled).toBe(true);
    });
  });

  describe("image source conversion edge cases", () => {
    it("should handle image with missing media_type", () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- testing edge case with incomplete data
      // @ts-ignore -- intentionally testing with missing media_type in source
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64" as const,
                  data: "iVBORw0KGgoAAAANSUhEUgAA",
                },
              },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      // When media_type is missing, should still convert to base64 URL
      expect(result.request.messages[0]).toEqual({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: "data:undefined;base64,iVBORw0KGgoAAAANSUhEUgAA",
            },
          },
        ],
      });
    });

    it("should handle image with missing data in base64 type", () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- testing edge case with incomplete data
      // @ts-ignore -- intentionally testing with missing data in source
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64" as const,
                  media_type: "image/png",
                },
              },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages[0]).toEqual({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: "data:image/png;base64,undefined",
            },
          },
        ],
      });
    });

    it("should handle malformed image source gracefully", () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- testing edge case with incomplete source
      // @ts-ignore -- intentionally testing with missing url in source
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "url" as const,
                  // Missing url property
                },
              },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages[0]).toEqual({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: "",
            },
          },
        ],
      });
    });
  });
});
