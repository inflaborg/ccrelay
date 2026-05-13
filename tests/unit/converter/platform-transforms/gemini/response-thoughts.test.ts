/* eslint-disable @typescript-eslint/naming-convention */

import {
  applyPlatformResponseTransforms,
  geminiThoughtTagsResponseTransform,
} from "@/converter/platform-transforms";
import { convertResponseToAnthropic } from "@/converter/adapters/openai-chat-to-anthropic-response";
import type { OpenAIChatCompletionResponse } from "@/converter/adapters/openai-chat-to-anthropic-response";
import type { AnthropicContentBlock } from "@/converter/adapters/openai-chat-to-anthropic-response";
import { describe, expect, it } from "vitest";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

describe("geminiThoughtTagsResponseTransform", () => {
  it("splits leading thought tags into thinking + text blocks", () => {
    const openaiBody: Record<string, unknown> = {
      choices: [
        {
          message: {
            content: "<thought>internal reasoning</thought>Visible reply",
          },
        },
      ],
    };
    const blocks: AnthropicContentBlock[] = [
      { type: "text", text: "<thought>internal reasoning</thought>Visible reply" },
    ];
    expect(geminiThoughtTagsResponseTransform(openaiBody, blocks)).toEqual([
      { type: "thinking", thinking: "internal reasoning" },
      { type: "text", text: "Visible reply" },
    ]);
  });

  it("returns unchanged when no thought tags", () => {
    const openaiBody: Record<string, unknown> = {
      choices: [{ message: { content: "plain" } }],
    };
    const blocks: AnthropicContentBlock[] = [{ type: "text", text: "plain" }];
    expect(geminiThoughtTagsResponseTransform(openaiBody, blocks)).toEqual(blocks);
  });

  it("returns unchanged when preceding thinking block already has body", () => {
    const raw = "<thought>x</thought>y";
    const openaiBody: Record<string, unknown> = {
      choices: [{ message: { content: raw } }],
    };
    const blocks: AnthropicContentBlock[] = [
      { type: "thinking", thinking: "already", signature: "s" },
      { type: "text", text: raw },
    ];
    expect(geminiThoughtTagsResponseTransform(openaiBody, blocks)).toEqual(blocks);
  });

  it("merges thought body into signature-only thinking before tool_use", () => {
    const raw = "<thought>step 1</thought>Calling tool";
    const openaiBody: Record<string, unknown> = {
      choices: [
        {
          message: {
            content: raw,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "fn", arguments: "{}" },
                extra_content: { google: { thought_signature: "sig-gem" } },
              },
            ],
          },
        },
      ],
    };
    const blocks: AnthropicContentBlock[] = [
      { type: "thinking", thinking: "", signature: "sig-gem" },
      { type: "text", text: raw },
      { type: "tool_use", id: "call_1", name: "fn", input: {} },
    ];
    expect(geminiThoughtTagsResponseTransform(openaiBody, blocks)).toEqual([
      { type: "thinking", thinking: "step 1", signature: "sig-gem" },
      { type: "text", text: "Calling tool" },
      { type: "tool_use", id: "call_1", name: "fn", input: {} },
    ]);
  });

  it("inserts empty text before tool_use when thought has no trailing text", () => {
    const raw = "<thought>only thought</thought>";
    const openaiBody: Record<string, unknown> = {
      choices: [
        {
          message: {
            content: raw,
            tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }],
          },
        },
      ],
    };
    const blocks: AnthropicContentBlock[] = [
      { type: "text", text: raw },
      { type: "tool_use", id: "c1", name: "f", input: {} },
    ];
    expect(geminiThoughtTagsResponseTransform(openaiBody, blocks)).toEqual([
      { type: "thinking", thinking: "only thought" },
      { type: "text", text: "" },
      { type: "tool_use", id: "c1", name: "f", input: {} },
    ]);
  });

  it("prepends thinking with signature from tool_calls when generic convert omitted it", () => {
    const openaiBody: Record<string, unknown> = {
      choices: [
        {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "browser_search", arguments: "{}" },
                extra_content: { google: { thought_signature: "fromGemini123" } },
              },
            ],
          },
        },
      ],
    };
    const blocks: AnthropicContentBlock[] = [
      { type: "text", text: "" },
      { type: "tool_use", id: "call_1", name: "browser_search", input: {} },
    ];
    expect(geminiThoughtTagsResponseTransform(openaiBody, blocks)).toEqual([
      { type: "thinking", thinking: "", signature: "fromGemini123" },
      { type: "text", text: "" },
      { type: "tool_use", id: "call_1", name: "browser_search", input: {} },
    ]);
  });

  it("prepends thinking from tool_calls.function.thought_signature", () => {
    const openaiBody: Record<string, unknown> = {
      choices: [
        {
          message: {
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
        },
      ],
    };
    const blocks: AnthropicContentBlock[] = [
      { type: "text", text: "" },
      { type: "tool_use", id: "call_1", name: "browser_search", input: {} },
    ];
    expect(geminiThoughtTagsResponseTransform(openaiBody, blocks)).toEqual([
      { type: "thinking", thinking: "", signature: "fromFunction123" },
      { type: "text", text: "" },
      { type: "tool_use", id: "call_1", name: "browser_search", input: {} },
    ]);
  });

  it("patches signature from tool_calls onto existing reasoning-only thinking block", () => {
    const openaiBody: Record<string, unknown> = {
      choices: [
        {
          message: {
            reasoning_content: "rc body",
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "f", arguments: "{}" },
                extra_content: { google: { thought_signature: "sig-x" } },
              },
            ],
          },
        },
      ],
    };
    const blocks: AnthropicContentBlock[] = [
      { type: "thinking", thinking: "rc body" },
      { type: "text", text: "" },
      { type: "tool_use", id: "c1", name: "f", input: {} },
    ];
    expect(geminiThoughtTagsResponseTransform(openaiBody, blocks)).toEqual([
      { type: "thinking", thinking: "rc body", signature: "sig-x" },
      { type: "text", text: "" },
      { type: "tool_use", id: "c1", name: "f", input: {} },
    ]);
  });
});

describe("applyPlatformResponseTransforms (Gemini)", () => {
  const originalModel = "claude-3-5-sonnet-20241022";

  it("runs thought-tag transform for generativelanguage host", () => {
    const openai: OpenAIChatCompletionResponse = {
      id: "chatcmpl-g1",
      object: "chat.completion",
      created: 1,
      model: "gemini-2.5-flash",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "<thought>a</thought>b",
          },
          finish_reason: "stop",
        },
      ],
    };
    const body = openai as unknown as Record<string, unknown>;
    const anthropic = convertResponseToAnthropic(openai, originalModel);
    const out = applyPlatformResponseTransforms(body, anthropic.content, `${GEMINI_BASE}/`);
    expect(out).toEqual([
      { type: "thinking", thinking: "a" },
      { type: "text", text: "b" },
    ]);
  });

  it("maps tool_calls thought_signature through platform transform for Gemini host", () => {
    const openai: OpenAIChatCompletionResponse = {
      id: "chatcmpl-g2",
      object: "chat.completion",
      created: 1,
      model: "gemini-2.5-flash",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "fn", arguments: "{}" },
                extra_content: { google: { thought_signature: "sig-g" } },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const body = openai as unknown as Record<string, unknown>;
    const anthropic = convertResponseToAnthropic(openai, originalModel);
    const out = applyPlatformResponseTransforms(body, anthropic.content, `${GEMINI_BASE}/`);
    expect(out).toEqual([
      { type: "thinking", thinking: "", signature: "sig-g" },
      { type: "text", text: "" },
      { type: "tool_use", id: "call_1", name: "fn", input: {} },
    ]);
  });

  it("does not run transform for non-Gemini upstream", () => {
    const openai: OpenAIChatCompletionResponse = {
      id: "x",
      object: "chat.completion",
      created: 1,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "<thought>fake</thought>rest" },
          finish_reason: "stop",
        },
      ],
    };
    const body = openai as unknown as Record<string, unknown>;
    const anthropic = convertResponseToAnthropic(openai, originalModel);
    const out = applyPlatformResponseTransforms(
      body,
      anthropic.content,
      "https://api.openai.com/v1"
    );
    expect(out).toEqual([{ type: "text", text: "<thought>fake</thought>rest" }]);
  });
});
