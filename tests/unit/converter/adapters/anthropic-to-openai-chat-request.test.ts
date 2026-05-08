/**
 * Unit tests for converter/adapters/anthropic-to-openai-chat-request.ts
 *
 * Product Requirements:
 * - Stateless conversion (no external storage for tool_use_id)
 * - Message splitting (tool_result → separate tool messages)
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
} from "@/converter/adapters/anthropic-to-openai-chat-request";

/* eslint-disable @typescript-eslint/naming-convention -- Testing API formats with snake_case */

describe("converter: anthropic-to-openai-chat-request", () => {
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
        messages: [{ role: "user" }] as AnthropicMessageRequest["messages"],
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
        messages: [{ role: "user" }] as AnthropicMessageRequest["messages"],
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
      expect(result.request.max_completion_tokens).toBeUndefined();
    });

    it("maps max_tokens to max_completion_tokens for gpt-5 models", () => {
      const request: AnthropicMessageRequest = {
        model: "gpt-5-mini",
        max_tokens: 32000,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.max_completion_tokens).toBe(32000);
      expect(result.request.max_tokens).toBeUndefined();
    });

    it("maps max_tokens to max_completion_tokens for o-series models", () => {
      const request: AnthropicMessageRequest = {
        model: "o3",
        max_tokens: 10000,
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.max_completion_tokens).toBe(10000);
      expect(result.request.max_tokens).toBeUndefined();
    });

    it("should not include max_tokens when undefined", () => {
      const request = {
        model: "claude-3-5-sonnet-20241022",
        messages: [],
      } as unknown as AnthropicMessageRequest;

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

    it("maps Anthropic server tool definitions to OpenAI-hosted tools (passthrough web_search)", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 5,
          },
          {
            name: "client_fn",
            description: "client",
            input_schema: { type: "object", properties: {} },
          },
        ],
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tools).toEqual([
        {
          type: "web_search",
          max_uses: 5,
        },
        {
          type: "function",
          function: {
            name: "client_fn",
            description: "client",
            parameters: { type: "object", properties: {} },
          },
        },
      ]);
    });

    it("GLM provider baseUrl nests web_search envelope for Anthropic→Chat", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 5,
          },
          {
            name: "client_fn",
            description: "client",
            input_schema: { type: "object", properties: {} },
          },
        ],
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath, {
        providerBaseUrl: "https://api.z.ai/",
      });

      expect(result.request.tools).toEqual([
        {
          type: "web_search",
          web_search: { enable: true, max_uses: 5 },
        },
        {
          type: "function",
          function: {
            name: "client_fn",
            description: "client",
            parameters: { type: "object", properties: {} },
          },
        },
      ]);
    });

    it("preserves tool_choice when only hosted/server tools exist", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tool_choice: { type: "auto" },
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
          },
        ],
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tools).toEqual([{ type: "web_search" }]);
      expect(result.request.tool_choice).toBe("auto");
    });

    it("maps code_execution_<version> server tools to Chat code_interpreter", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [],
        tools: [
          {
            type: "code_execution_20250522",
            name: "code_execution",
            storage_limit_mb: 200,
          },
        ],
      };
      const result = convertRequestToOpenAI(request, basePath);
      expect(result.request.tools).toEqual([{ type: "code_interpreter", storage_limit_mb: 200 }]);
    });
  });

  describe("server tool blocks in message history", () => {
    it("should embed server_tool_use and server tool results in assistant content as JSON lines", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "assistant",
            content: [
              { type: "text", text: "Ok." },
              {
                type: "server_tool_use",
                id: "s1",
                name: "web_search",
                input: { q: "a" },
              },
              {
                type: "web_search_tool_result",
                tool_use_id: "s1",
                content: { hits: 1 },
              },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages).toHaveLength(1);
      const content = result.request.messages[0].content as string;
      expect(content.startsWith("Ok.\n")).toBe(true);
      expect(content).toContain(
        JSON.stringify({
          type: "server_tool_use",
          id: "s1",
          name: "web_search",
          input: { q: "a" },
        })
      );
      expect(content).toContain(
        JSON.stringify({
          type: "web_search_tool_result",
          tool_use_id: "s1",
          content: { hits: 1 },
        })
      );
    });

    it("should add opaque server-tool text parts alongside user multimodal content", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Refs:" },
              {
                type: "server_tool_use",
                id: "s2",
                name: "web_search",
                input: {},
              },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.messages[0].role).toBe("user");
      const parts = result.request.messages[0].content as Array<{ type: string; text?: string }>;
      expect(parts[0]).toEqual({ type: "text", text: "Refs:" });
      expect(parts[1]).toEqual({
        type: "text",
        text: JSON.stringify({
          type: "server_tool_use",
          id: "s2",
          name: "web_search",
          input: {},
        }),
      });
    });
  });

  describe("tool_choice conversion", () => {
    /** OpenAI `tool_choice` is only emitted when at least one client function tool exists. */
    const clientToolForChoice: AnthropicMessageRequest["tools"] = [
      {
        name: "stub_for_tool_choice",
        description: "",
        input_schema: { type: "object", properties: {} },
      },
    ];

    it("should convert { type: 'auto' } to 'auto'", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tools: clientToolForChoice,
        tool_choice: { type: "auto" },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tool_choice).toBe("auto");
    });

    it("should convert { type: 'any' } to 'required'", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tools: clientToolForChoice,
        tool_choice: { type: "any" },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tool_choice).toBe("required");
    });

    it("should convert { type: 'none' } to 'none'", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tools: clientToolForChoice,
        tool_choice: { type: "none" },
        messages: [],
      };

      const result = convertRequestToOpenAI(request, basePath);

      expect(result.request.tool_choice).toBe("none");
    });

    it("should convert object form {type:'tool', name:'X'} to function format", () => {
      const request: AnthropicMessageRequest = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tools: [
          {
            name: "X",
            description: "",
            input_schema: { type: "object", properties: {} },
          },
        ],
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
        effort: "high",
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
        effort: "high",
        enabled: true,
      });
    });
  });

  describe("Azure OpenAI compat (openaiCompat)", () => {
    it("strips reasoning, cache_control, assistant thinking, and tool extra_content", () => {
      const request: AnthropicMessageRequest = {
        model: "gpt-4",
        max_tokens: 256,
        thinking: { type: "adaptive", budget_tokens: 1024 },
        system: [{ type: "text", text: "system-a", cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "hi",
                cache_control: { type: "ephemeral" },
              },
            ],
          },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "t1", signature: "sig1" },
              { type: "text", text: "yo" },
              {
                type: "tool_use",
                id: "call_1",
                name: "noop",
                input: {},
              },
            ],
          },
        ],
      };

      const result = convertRequestToOpenAI(request, basePath, { openaiCompat: "azure_openai" });

      expect(result.request.reasoning).toBeUndefined();
      const systemMsg = result.request.messages[0];
      expect(systemMsg.role).toBe("system");
      expect(Array.isArray(systemMsg.content)).toBe(true);
      expect((systemMsg.content as { cache_control?: unknown }[])[0].cache_control).toBeUndefined();
      expect((systemMsg.content as { text: string }[])[0].text).toBe("system-a");

      const userMsg = result.request.messages[1];
      expect((userMsg.content as { cache_control?: unknown }[])[0].cache_control).toBeUndefined();

      const asst = result.request.messages[2];
      expect(asst.thinking).toBeUndefined();
      expect(asst.tool_calls?.[0].extra_content).toBeUndefined();
      expect(asst.tool_calls?.[0].function.name).toBe("noop");
    });

    it("does not strip reasoning when openaiCompat is default", () => {
      const request: AnthropicMessageRequest = {
        model: "gpt-4",
        max_tokens: 100,
        thinking: { type: "enabled" },
        messages: [],
      };
      const r = convertRequestToOpenAI(request, basePath, { openaiCompat: "default" });
      expect(r.request.reasoning).toEqual({ effort: "medium", enabled: true });
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
              {
                type: "thinking",
                signature: "abc123signature",
              } as never,
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

      // Incomplete base64 (missing media_type) → empty URL, no invalid data: URL
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
              url: "",
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
