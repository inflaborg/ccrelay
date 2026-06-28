import { describe, expect, it } from "vitest";
import {
  openaiChatUsesMaxCompletionTokens,
  resolveOpenAiChatUsesMaxCompletionTokens,
  assignOpenAiChatMaxOutput,
  normalizeOpenAiChatMaxOutputFields,
  ensureOpenAiChatStreamUsageIncluded,
} from "@/converter/rules/openai-chat-model-rules";
import type { OpenAIMessageRequest } from "@/converter/adapters/anthropic-to-openai-chat-request";

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI wire field names in test fixtures */

describe("openaiChatUsesMaxCompletionTokens", () => {
  it("is true for gpt-5 family", () => {
    expect(openaiChatUsesMaxCompletionTokens("gpt-5")).toBe(true);
    expect(openaiChatUsesMaxCompletionTokens("gpt-5.1")).toBe(true);
    expect(openaiChatUsesMaxCompletionTokens("GPT-5-MINI")).toBe(true);
  });

  it("is true for o-series ids", () => {
    expect(openaiChatUsesMaxCompletionTokens("o1")).toBe(true);
    expect(openaiChatUsesMaxCompletionTokens("o3-mini")).toBe(true);
    expect(openaiChatUsesMaxCompletionTokens("O4-preview")).toBe(true);
  });

  it("is false for gpt-4 and claude-style ids", () => {
    expect(openaiChatUsesMaxCompletionTokens("gpt-4o")).toBe(false);
    expect(openaiChatUsesMaxCompletionTokens("gpt-4.1")).toBe(false);
    expect(openaiChatUsesMaxCompletionTokens("claude-3-5-sonnet-20241022")).toBe(false);
  });

  it("does not match random o in the middle of id", () => {
    expect(openaiChatUsesMaxCompletionTokens("foo-o3-bar")).toBe(false);
  });
});

describe("assignOpenAiChatMaxOutput", () => {
  it("sets max_completion_tokens and clears max_tokens for gpt-5", () => {
    const req: OpenAIMessageRequest = {
      model: "gpt-5",
      messages: [],
      max_tokens: 99,
    };
    assignOpenAiChatMaxOutput(req, 1234);
    expect(req.max_completion_tokens).toBe(1234);
    expect(req.max_tokens).toBeUndefined();
  });

  it("sets max_tokens and clears max_completion_tokens for gpt-4o", () => {
    const req: OpenAIMessageRequest = {
      model: "gpt-4o",
      messages: [],
      max_completion_tokens: 99,
    };
    assignOpenAiChatMaxOutput(req, 2000);
    expect(req.max_tokens).toBe(2000);
    expect(req.max_completion_tokens).toBeUndefined();
  });

  it("uses client model hint when upstream model is an Azure deployment name", () => {
    const req: OpenAIMessageRequest = {
      model: "my-gpt5-prod",
      messages: [],
    };
    assignOpenAiChatMaxOutput(req, 8000, "gpt-5.4");
    expect(req.max_completion_tokens).toBe(8000);
    expect(req.max_tokens).toBeUndefined();
  });
});

describe("resolveOpenAiChatUsesMaxCompletionTokens", () => {
  it("falls back to client model hint for deployment names", () => {
    expect(resolveOpenAiChatUsesMaxCompletionTokens("my-deploy", "gpt-5-mini")).toBe(true);
    expect(resolveOpenAiChatUsesMaxCompletionTokens("my-deploy", "gpt-4o")).toBe(false);
  });
});

describe("normalizeOpenAiChatMaxOutputFields", () => {
  it("maps max_tokens to max_completion_tokens for gpt-5 passthrough bodies", () => {
    const body: Record<string, unknown> = {
      model: "gpt-5.4",
      messages: [],
      max_tokens: 4096,
    };
    normalizeOpenAiChatMaxOutputFields(body);
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.max_tokens).toBeUndefined();
  });

  it("maps max_tokens using client hint when model is an Azure deployment", () => {
    const body: Record<string, unknown> = {
      model: "prod-gpt5-eastus",
      messages: [],
      max_tokens: 8192,
    };
    normalizeOpenAiChatMaxOutputFields(body, "gpt-5.4-mini");
    expect(body.max_completion_tokens).toBe(8192);
    expect(body.max_tokens).toBeUndefined();
  });

  it("keeps max_tokens for gpt-4o", () => {
    const body: Record<string, unknown> = {
      model: "gpt-4o",
      messages: [],
      max_tokens: 2048,
    };
    normalizeOpenAiChatMaxOutputFields(body);
    expect(body.max_tokens).toBe(2048);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("prefers max_completion_tokens when both are present", () => {
    const body: Record<string, unknown> = {
      model: "gpt-5",
      messages: [],
      max_tokens: 100,
      max_completion_tokens: 500,
    };
    normalizeOpenAiChatMaxOutputFields(body);
    expect(body.max_completion_tokens).toBe(500);
    expect(body.max_tokens).toBeUndefined();
  });
});
/* eslint-enable @typescript-eslint/naming-convention */

describe("ensureOpenAiChatStreamUsageIncluded", () => {
  /* eslint-disable @typescript-eslint/naming-convention -- OpenAI wire field names in test fixtures */
  it("adds stream_options.include_usage when stream is true", () => {
    const body: Record<string, unknown> = {
      model: "gpt-5.4",
      stream: true,
      messages: [],
    };
    ensureOpenAiChatStreamUsageIncluded(body);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("sets include_usage on existing stream_options", () => {
    const body: Record<string, unknown> = {
      model: "gpt-5.4",
      stream: true,
      stream_options: { include_obfuscation: false },
      messages: [],
    };
    ensureOpenAiChatStreamUsageIncluded(body);
    expect(body.stream_options).toEqual({ include_obfuscation: false, include_usage: true });
  });

  it("leaves body unchanged when include_usage is already true", () => {
    const body: Record<string, unknown> = {
      model: "gpt-5.4",
      stream: true,
      stream_options: { include_usage: true },
      messages: [],
    };
    ensureOpenAiChatStreamUsageIncluded(body);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("no-op when stream is false", () => {
    const body: Record<string, unknown> = {
      model: "gpt-5.4",
      stream: false,
      messages: [],
    };
    ensureOpenAiChatStreamUsageIncluded(body);
    expect(body.stream_options).toBeUndefined();
  });
  /* eslint-enable @typescript-eslint/naming-convention */
});
