/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from "vitest";
import { convertChatCompletionToResponses } from "@/converter/adapters/openai-chat-to-responses";
import type { OpenAIChatCompletionResponse } from "@/converter/adapters/openai-chat-to-anthropic-response";

describe("convertChatCompletionToResponses", () => {
  it("produces response object and output for text", () => {
    const chat: OpenAIChatCompletionResponse = {
      id: "chatcmpl-x",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello" },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    };
    const r = convertChatCompletionToResponses(chat, "gpt-4o");
    expect(r.object).toBe("response");
    expect(r.model).toBe("gpt-4o");
    expect(r.status).toBe("completed");
    expect(r.id.startsWith("resp_")).toBe(true);
    expect(r.usage).toEqual({
      input_tokens: 1,
      output_tokens: 2,
      total_tokens: 3,
    });
    expect(Array.isArray(r.output)).toBe(true);
  });

  it("maps reasoning_content to reasoning_text when thinking.content is absent", () => {
    const chat: OpenAIChatCompletionResponse = {
      id: "chatcmpl-rc",
      object: "chat.completion",
      created: 1700000000,
      model: "deepseek-reasoner",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            reasoning_content: "CoT here",
            content: "Answer",
          },
          finish_reason: "stop",
        },
      ],
    };
    const r = convertChatCompletionToResponses(chat, "deepseek-reasoner");
    const outMsg = r.output[0] as {
      type: string;
      content?: { type: string; text: string }[];
    };
    expect(outMsg.type).toBe("message");
    const rt = outMsg.content?.find(c => c.type === "reasoning_text");
    expect(rt?.text).toBe("CoT here");
    const ot = outMsg.content?.find(c => c.type === "output_text");
    expect(ot?.text).toBe("Answer");
  });
});

describe("message content as array (provider multipart)", () => {
  it("joins text parts into output_text for convertChatCompletionToResponses", () => {
    const chat = {
      id: "chatcmpl-x",
      object: "chat.completion" as const,
      created: 1700000000,
      model: "m",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant" as const,
            content: [
              { type: "text" as const, text: "Hel" },
              { type: "text" as const, text: "lo" },
            ] as unknown as string,
          },
          finish_reason: "stop" as const,
        },
      ],
    };
    const r = convertChatCompletionToResponses(chat, "m");
    const outMsg = r.output[0] as {
      type: string;
      content?: { type: string; text: string }[];
    };
    expect(outMsg.type).toBe("message");
    const textPart = outMsg.content?.find(c => c.type === "output_text");
    expect(textPart?.text).toBe("Hello");
  });
});
