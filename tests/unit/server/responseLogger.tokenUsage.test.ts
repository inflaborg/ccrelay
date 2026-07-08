/* eslint-disable @typescript-eslint/naming-convention */
// API response fields use snake_case (prompt_tokens, input_tokens, etc.)

import { describe, it, expect } from "vitest";
import { extractTokenUsage } from "../../../packages/core/src/server/responseLogger";

describe("server: responseLogger token usage extraction", () => {
  it("extracts longcat mixed usage fields with zero placeholders", () => {
    const body = JSON.stringify({
      usage: {
        effectiveCachedTokens: 56320,
        completion_tokens: 127,
        prompt_tokens: 56836,
        total_tokens: 56963,
        completion_tokens_details: {
          reasoning_tokens: 32,
        },
        prompt_tokens_details: {
          cached_tokens: 56320,
          audio_tokens: 0,
          image_tokens: 0,
          video_tokens: 0,
          text_tokens: 0,
        },
        cache_write_tokens: 0,
        cache_read_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        output_tokens_details: null,
        cached_tokens: 0,
      },
    });

    expect(extractTokenUsage(body)).toEqual({
      inputTokens: 56836,
      outputTokens: 127,
      cacheTokens: 56320,
    });
  });

  it("extracts OpenAI Responses usage including cached tokens", () => {
    const body = JSON.stringify({
      usage: {
        input_tokens: 1200,
        output_tokens: 340,
        total_tokens: 1540,
        input_tokens_details: {
          cached_tokens: 800,
        },
        output_tokens_details: {
          reasoning_tokens: 120,
        },
      },
    });

    expect(extractTokenUsage(body)).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      cacheTokens: 800,
    });
  });

  it("extracts OpenAI Chat usage", () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: {
          cached_tokens: 25,
        },
      },
    });

    expect(extractTokenUsage(body)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheTokens: 25,
    });
  });

  it("extracts Anthropic usage from message envelope", () => {
    const body = JSON.stringify({
      message: {
        usage: {
          input_tokens: 90,
          output_tokens: 40,
          cache_read_input_tokens: 30,
        },
      },
    });

    expect(extractTokenUsage(body)).toEqual({
      inputTokens: 120,
      outputTokens: 40,
      cacheTokens: 30,
    });
  });

  it("extracts Anthropic top-level usage as total prompt input", () => {
    const body = JSON.stringify({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 400,
      },
    });

    expect(extractTokenUsage(body)).toEqual({
      inputTokens: 500,
      outputTokens: 50,
      cacheTokens: 400,
    });
  });

  it("accumulates usage from SSE chunks", () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      'data: {"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}',
      'data: {"usage":{"prompt_tokens":200,"completion_tokens":80,"total_tokens":280,"prompt_tokens_details":{"cached_tokens":60}}}',
      "data: [DONE]",
    ].join("\n");

    expect(extractTokenUsage(body)).toEqual({
      inputTokens: 200,
      outputTokens: 80,
      cacheTokens: 60,
    });
  });

  it("returns zeros when all usage fields are explicitly zero", () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        prompt_tokens_details: {
          cached_tokens: 0,
        },
        input_tokens_details: {
          cached_tokens: 0,
        },
        cache_read_input_tokens: 0,
        effectiveCachedTokens: 0,
      },
    });

    expect(extractTokenUsage(body)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
    });
  });
});
