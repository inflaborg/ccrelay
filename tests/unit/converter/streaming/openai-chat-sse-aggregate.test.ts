/* eslint-disable @typescript-eslint/naming-convention */
import { describe, expect, it } from "vitest";
import {
  aggregateOpenAiChatSseToCompletion,
  extractResponsesObjectFromSse,
} from "@/converter/streaming/openai-chat-sse-aggregate";

const COMPLETION = {
  id: "chatcmpl-9",
  object: "chat.completion",
  created: 1,
  model: "gpt-x",
  choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
};

function sse(objs: unknown[], done = true): string {
  return (
    objs.map(o => `data: ${JSON.stringify(o)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : "")
  );
}

describe("aggregateOpenAiChatSseToCompletion", () => {
  it("returns a plain chat.completion JSON body as-is", () => {
    expect(aggregateOpenAiChatSseToCompletion(JSON.stringify(COMPLETION))).toEqual(COMPLETION);
  });

  it("accepts a full chat.completion wrapped in a single data: line", () => {
    expect(aggregateOpenAiChatSseToCompletion(sse([COMPLETION]))).toEqual(COMPLETION);
  });

  it("folds chunk deltas (text, reasoning, tool calls, usage)", () => {
    const body = sse([
      {
        id: "c1",
        model: "gpt-x",
        created: 5,
        choices: [{ index: 0, delta: { role: "assistant" } }],
      },
      { id: "c1", choices: [{ index: 0, delta: { reasoning_content: "hmm " } }] },
      { id: "c1", choices: [{ index: 0, delta: { content: "Hi " } }] },
      { id: "c1", choices: [{ index: 0, delta: { content: "there" } }] },
      {
        id: "c1",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "f", arguments: '{"x"' },
                },
              ],
            },
          },
        ],
      },
      {
        id: "c1",
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] } },
        ],
      },
      { id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      {
        id: "c1",
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      },
    ]);

    const out = aggregateOpenAiChatSseToCompletion(body);
    expect(out).not.toBeNull();
    expect(out!.id).toBe("c1");
    expect(out!.model).toBe("gpt-x");
    expect(out!.usage?.prompt_tokens).toBe(10);
    const choice = out!.choices[0];
    expect(choice.finish_reason).toBe("tool_calls");
    expect(choice.message.content).toBe("Hi there");
    expect(choice.message.reasoning_content).toBe("hmm ");
    expect(choice.message.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "f", arguments: '{"x":1}' } },
    ]);
  });

  it("handles CRLF-free bodies missing [DONE]", () => {
    const out = aggregateOpenAiChatSseToCompletion(
      sse(
        [{ id: "c2", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] }],
        false
      )
    );
    expect(out?.choices[0].message.content).toBe("ok");
  });

  it("returns null for error-only payloads", () => {
    expect(aggregateOpenAiChatSseToCompletion(sse([{ error: { message: "bad key" } }]))).toBeNull();
    expect(aggregateOpenAiChatSseToCompletion("")).toBeNull();
  });
});

describe("extractResponsesObjectFromSse", () => {
  it("pulls the response object from response.completed", () => {
    const resp = { id: "resp_1", object: "response", status: "completed", output: [] };
    const body =
      `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { ...resp, status: "in_progress" } })}\n\n` +
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: resp })}\n\n`;
    expect(extractResponsesObjectFromSse(body)).toEqual(resp);
  });

  it("returns a plain Responses JSON body", () => {
    const resp = { id: "resp_2", object: "response", output: [] };
    expect(extractResponsesObjectFromSse(JSON.stringify(resp))).toEqual(resp);
  });

  it("returns null when no final response is present", () => {
    expect(extractResponsesObjectFromSse('data: {"type":"response.created"}\n\n')).toBeNull();
  });
});
