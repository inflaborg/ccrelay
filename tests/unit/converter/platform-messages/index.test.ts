/* eslint-disable @typescript-eslint/naming-convention */

import type { OpenAIMessage } from "@/converter/adapters/anthropic-to-openai-chat-request";
import {
  applyPlatformMessageTransforms,
  glmFlattenContentTransform,
} from "@/converter/platform-messages";
import { describe, expect, it } from "vitest";

const GLM_BASE = "https://api.z.ai/api/coding/paas/v4";

describe("glmFlattenContentTransform", () => {
  it("flattens text-only array content to joined string", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "system",
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ];
    const out = glmFlattenContentTransform(messages);
    expect(out).toEqual([
      { role: "system", content: "a\nb" },
      { role: "user", content: "hello" },
    ]);
    expect(messages[0].content).not.toBe(out[0].content);
  });

  it("skips empty text parts when joining", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "system",
        content: [
          { type: "text", text: "x" },
          { type: "text", text: "" },
          { type: "text", text: "y" },
        ],
      },
    ];
    expect(glmFlattenContentTransform(messages)[0].content).toBe("x\ny");
  });

  it("leaves string content unchanged", () => {
    const messages: OpenAIMessage[] = [{ role: "assistant", content: "plain" }];
    expect(glmFlattenContentTransform(messages)).toEqual(messages);
  });

  it("preserves arrays that include non-text parts", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,xxx" },
          },
        ],
      },
    ];
    expect(glmFlattenContentTransform(messages)).toEqual(messages);
  });

  it("flattens tool message when content is single text-only part array", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "tool",
        tool_call_id: "tc_1",
        content: [{ type: "text", text: '{"ok":true}' }],
      },
    ];
    const out = glmFlattenContentTransform(messages);
    expect(out).toEqual([{ role: "tool", tool_call_id: "tc_1", content: '{"ok":true}' }]);
  });

  it("flattens multi-part tool text content array", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "tool",
        tool_call_id: "tc_1",
        content: [
          { type: "text", text: "part1" },
          { type: "text", text: "part2" },
        ],
      },
    ];
    expect(glmFlattenContentTransform(messages)).toEqual([
      { role: "tool", tool_call_id: "tc_1", content: "part1\npart2" },
    ]);
  });
});

describe("applyPlatformMessageTransforms", () => {
  it("applies GLM flatten for api.z.ai baseUrl", () => {
    const messages: OpenAIMessage[] = [{ role: "user", content: [{ type: "text", text: "q" }] }];
    const out = applyPlatformMessageTransforms(messages, GLM_BASE);
    expect(out).toEqual([{ role: "user", content: "q" }]);
  });

  it("applies GLM flatten for open.bigmodel.cn baseUrl", () => {
    const messages: OpenAIMessage[] = [{ role: "user", content: [{ type: "text", text: "q" }] }];
    const out = applyPlatformMessageTransforms(messages, "https://open.bigmodel.cn/api/v1");
    expect(out).toEqual([{ role: "user", content: "q" }]);
  });

  it("is no-op for unknown upstream host", () => {
    const messages: OpenAIMessage[] = [{ role: "user", content: [{ type: "text", text: "q" }] }];
    expect(applyPlatformMessageTransforms(messages, "https://api.example.com/v1")).toEqual(
      messages
    );
  });

  it("handles api.z.ai hostname without path", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: [{ type: "text", text: "one" }] },
    ];
    expect(applyPlatformMessageTransforms(messages, "https://API.Z.AI/")).toEqual([
      { role: "system", content: "one" },
    ]);
  });
});
