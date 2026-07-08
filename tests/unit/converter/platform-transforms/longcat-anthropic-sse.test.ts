/* eslint-disable @typescript-eslint/naming-convention */
import { describe, expect, it } from "vitest";
import type { AnthropicSseEventRow } from "@/converter/platform-transforms";
import {
  applyAnthropicSseRowsPlatformTransform,
  transformLongcatAnthropicSseRows,
} from "@/converter/platform-transforms";

describe("transformLongcatAnthropicSseRows", () => {
  it("fills missing numeric usage on message_start", () => {
    const rows: AnthropicSseEventRow[] = [
      {
        data: {
          type: "message_start",
          message: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "LongCat-2.0",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {},
          },
        },
      },
    ];

    const out = transformLongcatAnthropicSseRows(rows);
    expect(out[0].data.message).toMatchObject({
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
  });

  it("preserves existing usage numbers on message_start", () => {
    const rows: AnthropicSseEventRow[] = [
      {
        data: {
          type: "message_start",
          message: {
            usage: {
              input_tokens: 12,
              output_tokens: 3,
              cache_read_input_tokens: 99,
            },
          },
        },
      },
    ];

    const out = transformLongcatAnthropicSseRows(rows);
    expect(out[0].data.message).toMatchObject({
      usage: {
        input_tokens: 12,
        output_tokens: 3,
        cache_read_input_tokens: 99,
        cache_creation_input_tokens: 0,
      },
    });
  });

  it("leaves message_delta usage unchanged", () => {
    const rows: AnthropicSseEventRow[] = [
      {
        data: {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 35, output_tokens: 73, cache_read_input_tokens: 7552 },
        },
      },
    ];

    expect(transformLongcatAnthropicSseRows(rows)).toEqual(rows);
  });
});

describe("applyAnthropicSseRowsPlatformTransform (longcat)", () => {
  it("applies LongCat rule for api.longcat.chat hostname", () => {
    const rows: AnthropicSseEventRow[] = [
      {
        data: {
          type: "message_start",
          message: { usage: {} },
        },
      },
    ];
    const transformed = applyAnthropicSseRowsPlatformTransform(
      rows,
      "https://api.longcat.chat/anthropic/v1/messages"
    );
    expect((transformed[0].data.message as Record<string, unknown>).usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });
});
