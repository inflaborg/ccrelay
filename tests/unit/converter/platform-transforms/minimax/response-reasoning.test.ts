/* eslint-disable @typescript-eslint/naming-convention */

import type { AnthropicContentBlock } from "@/converter/adapters/openai-chat-to-anthropic-response";
import {
  applyPlatformResponseTransforms,
  minimaxReasoningDetailsResponseTransform,
} from "@/converter/platform-transforms";
import { describe, expect, it } from "vitest";

const MINIMAX_BASE = "https://api.minimax.io/v1/chat/completions";

function bodyWithReasoningDetails(
  details: Array<Record<string, unknown>>
): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: "Hello",
          reasoning_details: details,
        },
      },
    ],
  };
}

describe("minimaxReasoningDetailsResponseTransform", () => {
  it("prepends thinking from reasoning_details text entries", () => {
    const body = bodyWithReasoningDetails([{ text: "step a" }, { text: "step b" }]);
    const blocks: AnthropicContentBlock[] = [{ type: "text", text: "Hello" }];
    const out = minimaxReasoningDetailsResponseTransform(body, blocks);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: "thinking", thinking: "step a\n\nstep b" });
    expect(out[1]).toEqual({ type: "text", text: "Hello" });
  });

  it("no-ops when reasoning_details is absent", () => {
    const body: Record<string, unknown> = {
      choices: [{ message: { role: "assistant", content: "Hi" } }],
    };
    const blocks: AnthropicContentBlock[] = [{ type: "text", text: "Hi" }];
    expect(minimaxReasoningDetailsResponseTransform(body, blocks)).toBe(blocks);
  });

  it("no-ops when reasoning_details is empty", () => {
    const body = bodyWithReasoningDetails([]);
    const blocks: AnthropicContentBlock[] = [{ type: "text", text: "x" }];
    expect(minimaxReasoningDetailsResponseTransform(body, blocks)).toBe(blocks);
  });

  it("skips entries without text and no-ops when no text remains", () => {
    const body = bodyWithReasoningDetails([{ foo: 1 }, { text: "" }]);
    const blocks: AnthropicContentBlock[] = [{ type: "text", text: "x" }];
    expect(minimaxReasoningDetailsResponseTransform(body, blocks)).toBe(blocks);
  });

  it("does not duplicate when a thinking block already exists", () => {
    const body = bodyWithReasoningDetails([{ text: "from details" }]);
    const blocks: AnthropicContentBlock[] = [
      { type: "thinking", thinking: "already" },
      { type: "text", text: "Hello" },
    ];
    const out = minimaxReasoningDetailsResponseTransform(body, blocks);
    expect(out).toBe(blocks);
    expect(out).toHaveLength(2);
  });
});

describe("applyPlatformResponseTransforms (MiniMax)", () => {
  it("runs minimax reasoning transform for api.minimax.io", () => {
    const body = bodyWithReasoningDetails([{ text: "r" }]);
    const blocks: AnthropicContentBlock[] = [{ type: "text", text: "Hello" }];
    const out = applyPlatformResponseTransforms(body, blocks, MINIMAX_BASE);
    expect(out[0]).toEqual({ type: "thinking", thinking: "r" });
    expect(out[1]).toEqual({ type: "text", text: "Hello" });
  });

  it("runs for api.minimaxi.com", () => {
    const body = bodyWithReasoningDetails([{ text: "cn" }]);
    const blocks: AnthropicContentBlock[] = [{ type: "text", text: "x" }];
    const out = applyPlatformResponseTransforms(
      body,
      blocks,
      "https://api.minimaxi.com/v1/chat/completions"
    );
    expect(out[0]).toEqual({ type: "thinking", thinking: "cn" });
  });
});
