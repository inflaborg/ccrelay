/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from "vitest";
import {
  createStreamingState,
  processStreamingChunk,
  createSseLineBuffer,
} from "@/converter/streaming/openai-chat-stream-to-responses";
import { extractResponsesEcho } from "@/converter/adapters/openai-responses-to-chat";

function chunk(delta: Record<string, unknown>, finishReason?: string | null): string {
  return JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "gpt-4o",
    choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
  });
}

function extractTypes(events: string[]): string[] {
  const types: string[] = [];
  for (const e of events) {
    const match = e.match(/"type":"([^"]+)"/);
    if (match) {
      types.push(match[1]);
    }
  }
  return types;
}

describe("createStreamingState", () => {
  it("returns initial state with resp_ and msg_ prefixed ids", () => {
    const s = createStreamingState();
    expect(s.responseId.startsWith("resp_")).toBe(true);
    expect(s.messageId.startsWith("msg_")).toBe(true);
    expect(s.phase).toBe("initial");
    expect(s.seq).toBe(0);
    expect(s.accumulatedText).toBe("");
  });
});

describe("processStreamingChunk", () => {
  it("handles basic text streaming", () => {
    const state = createStreamingState();

    // First chunk: role only — defer output_item until content arrives ("created" phase)
    const e1 = processStreamingChunk(state, chunk({ role: "assistant", content: "" }));
    expect(extractTypes(e1)).toEqual(["response.created", "response.in_progress"]);

    // Content delta opens message output item, content_part, then streams text
    const e2 = processStreamingChunk(state, chunk({ content: "Hello" }));
    expect(extractTypes(e2)).toEqual([
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
    ]);

    // More content
    const e3 = processStreamingChunk(state, chunk({ content: " world" }));
    expect(extractTypes(e3)).toEqual(["response.output_text.delta"]);
    expect(state.accumulatedText).toBe("Hello world");

    // Finish reason — close items; defer completed until [DONE]
    const e4 = processStreamingChunk(state, chunk({}, "stop"));
    expect(extractTypes(e4)).toEqual([
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
    ]);
    expect(state.phase).toBe("finished");

    const e5 = processStreamingChunk(state, "[DONE]");
    expect(extractTypes(e5)).toContain("response.completed");
    expect(e5[e5.length - 1].trim()).toBe("data: [DONE]");
    expect(state.phase).toBe("done");
  });

  it("MiMo-style: role prelude then reasoning then assistant text before finish", () => {
    const state = createStreamingState();

    processStreamingChunk(
      state,
      chunk({
        role: "assistant",
        content: "",
        reasoning_content: null,
      })
    );
    expect(state.phase).toBe("created");

    let types = extractTypes(
      processStreamingChunk(state, chunk({ content: null, reasoning_content: "Thought A" }))
    );
    expect(types[0]).toBe("response.output_item.added");
    expect(types[1]).toBe("response.reasoning_text.delta");

    types = extractTypes(
      processStreamingChunk(state, chunk({ content: null, reasoning_content: "Thought B" }))
    );
    expect(types).toEqual(["response.reasoning_text.delta"]);

    types = extractTypes(
      processStreamingChunk(state, chunk({ content: "Answer", reasoning_content: null }))
    );
    expect(types).toContain("response.reasoning_text.done");
    expect(types).toContain("response.output_item.done");
    expect(types).toContain("response.output_item.added");
    expect(types).toContain("response.content_part.added");
    expect(types).toContain("response.output_text.delta");

    types = extractTypes(processStreamingChunk(state, chunk({}, "stop")));
    expect(types).toContain("response.output_text.done");
    expect(types).toContain("response.content_part.done");
    expect(types).toContain("response.output_item.done");
    expect(types).not.toContain("response.completed");
    expect(state.phase).toBe("finished");
    extractTypes(processStreamingChunk(state, "[DONE]"));
    expect(state.phase).toBe("done");
    expect(state.accumulatedReasoning).toBe("Thought AThought B");
    expect(state.accumulatedText).toBe("Answer");
  });

  it("enters reasoning when first chunk carries role with reasoning_content (no prelude gap)", () => {
    const state = createStreamingState();
    const e1 = processStreamingChunk(
      state,
      chunk({
        role: "assistant",
        content: "",
        reasoning_content: "think first",
      })
    );
    const t1 = extractTypes(e1);
    expect(t1[0]).toBe("response.created");
    expect(t1[1]).toBe("response.in_progress");
    expect(t1[2]).toBe("response.output_item.added");
    expect(t1[3]).toBe("response.reasoning_text.delta");
    expect(state.phase).toBe("reasoning");
  });

  it("emits reasoning output_item.done with reasoning_text content and empty summary", () => {
    const state = createStreamingState();
    const reasoningId = state.reasoningId;
    processStreamingChunk(state, chunk({ role: "assistant", content: "" }));
    processStreamingChunk(state, chunk({ reasoning_content: "why" }));
    const events = processStreamingChunk(state, chunk({ content: "hi" }));
    const reasoningDoneEvent = events.find(
      (e: string) =>
        e.includes('"type":"response.output_item.done"') &&
        e.includes(reasoningId) &&
        e.includes('"type":"reasoning"')
    );
    expect(reasoningDoneEvent).toBeDefined();
    expect(reasoningDoneEvent).toContain('"summary":[]');
    expect(reasoningDoneEvent).toContain('"type":"reasoning_text"');
    expect(reasoningDoneEvent).not.toContain('"type":"summary_text"');
    expect(reasoningDoneEvent).not.toContain('"type":"output_text"');
  });

  it("streams reasoning_content with reasoning_text events, not summary or message text events", () => {
    const state = createStreamingState();
    processStreamingChunk(state, chunk({ role: "assistant", content: "" }));

    const deltaEvents = processStreamingChunk(state, chunk({ reasoning_content: "why" }));
    expect(extractTypes(deltaEvents)).toEqual([
      "response.output_item.added",
      "response.reasoning_text.delta",
    ]);
    expect(deltaEvents.join("")).not.toContain("response.content_part.added");
    expect(deltaEvents.join("")).not.toContain("response.output_text.delta");
    expect(deltaEvents.join("")).not.toContain("response.reasoning_summary");

    const doneEvents = processStreamingChunk(state, "[DONE]");
    const doneTypes = extractTypes(doneEvents);
    expect(doneTypes).toContain("response.reasoning_text.done");
    expect(doneEvents.join("")).not.toContain("response.content_part.done");
    expect(doneEvents.join("")).not.toContain("response.output_text.done");
    expect(doneEvents.join("")).not.toContain("response.reasoning_summary");
  });

  it("handles finish_reason after role-only prelude (created) with empty output", () => {
    const state = createStreamingState();
    processStreamingChunk(state, chunk({ role: "assistant", content: "" }));
    expect(state.phase).toBe("created");
    const e = processStreamingChunk(state, chunk({}, "stop"));
    expect(extractTypes(e)).toEqual([]);
    expect(state.phase).toBe("finished");
    expect(extractTypes(processStreamingChunk(state, "[DONE]"))).toContain("response.completed");
    expect(state.phase).toBe("done");
  });

  it("handles provider that omits role chunk", () => {
    const state = createStreamingState();

    // Content directly without role
    const e1 = processStreamingChunk(state, chunk({ content: "Hi" }));
    expect(extractTypes(e1)[0]).toBe("response.created");
    expect(extractTypes(e1)[1]).toBe("response.in_progress");
    expect(extractTypes(e1)[2]).toBe("response.output_item.added");
    expect(extractTypes(e1)[3]).toBe("response.content_part.added");
    expect(extractTypes(e1)[4]).toBe("response.output_text.delta");
    expect(state.phase).toBe("text");
  });

  it("handles tool call streaming", () => {
    const state = createStreamingState();

    // role
    processStreamingChunk(state, chunk({ role: "assistant", content: "" }));

    // Some text first
    processStreamingChunk(state, chunk({ content: "Let me search." }));

    // Tool call start
    const eToolStart = processStreamingChunk(
      state,
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_abc",
            type: "function",
            function: { name: "web_search", arguments: "" },
          },
        ],
      })
    );
    // Should close the text item first, then add the tool call item
    const toolStartTypes = extractTypes(eToolStart);
    expect(toolStartTypes).toContain("response.output_text.done");
    expect(toolStartTypes).toContain("response.output_item.done");
    expect(toolStartTypes).toContain("response.output_item.added");
    expect(state.phase).toBe("tool");

    // Tool call argument delta
    const eArg = processStreamingChunk(
      state,
      chunk({
        tool_calls: [
          {
            index: 0,
            function: { arguments: '{"query":"' },
          },
        ],
      })
    );
    expect(extractTypes(eArg)).toEqual(["response.function_call_arguments.delta"]);

    // More argument delta
    processStreamingChunk(
      state,
      chunk({
        tool_calls: [
          {
            index: 0,
            function: { arguments: 'test"}' },
          },
        ],
      })
    );
    expect(state.toolCalls[0].arguments).toBe('{"query":"test"}');

    // Finish
    const eFinish = processStreamingChunk(state, chunk({}, "stop"));
    const finishTypes = extractTypes(eFinish);
    expect(finishTypes).toContain("response.function_call_arguments.done");
    expect(finishTypes).toContain("response.output_item.done");
    expect(finishTypes).not.toContain("response.completed");
    expect(extractTypes(processStreamingChunk(state, "[DONE]"))).toContain("response.completed");
  });

  it("handles multiple tool calls", () => {
    const state = createStreamingState();

    processStreamingChunk(state, chunk({ role: "assistant", content: "" }));

    // First tool call
    processStreamingChunk(
      state,
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "fn_a", arguments: "" },
          },
        ],
      })
    );

    // Second tool call (different index)
    const e2 = processStreamingChunk(
      state,
      chunk({
        tool_calls: [
          {
            index: 1,
            id: "call_2",
            type: "function",
            function: { name: "fn_b", arguments: "" },
          },
        ],
      })
    );
    // Should add second tool call item
    expect(extractTypes(e2)).toContain("response.output_item.added");
    expect(state.toolCalls.length).toBe(2);
    expect(state.toolCalls[0].name).toBe("fn_a");
    expect(state.toolCalls[1].name).toBe("fn_b");

    // Finish
    const eFinish = processStreamingChunk(state, chunk({}, "tool_calls"));
    // Should close both tool calls
    const finishTypes = extractTypes(eFinish);
    const doneItems = finishTypes.filter(t => t === "response.output_item.done");
    expect(doneItems.length).toBe(2);
    expect(finishTypes).not.toContain("response.completed");
    expect(extractTypes(processStreamingChunk(state, "[DONE]"))).toContain("response.completed");
  });

  it("handles [DONE] sentinel", () => {
    const state = createStreamingState();

    // Incomplete stream — no finish_reason
    processStreamingChunk(state, chunk({ role: "assistant", content: "" })); // -> created
    processStreamingChunk(state, chunk({ content: "partial" })); // -> text + deltas

    // [DONE] should flush completion
    const events = processStreamingChunk(state, "[DONE]");
    const types = extractTypes(events);
    expect(types).toContain("response.output_text.done");
    expect(types).toContain("response.output_item.done");
    expect(types).toContain("response.completed");
    expect(events[events.length - 1].trim()).toBe("data: [DONE]");
    expect(state.phase).toBe("done");
  });

  it("handles [DONE] when nothing was received", () => {
    const state = createStreamingState();
    const events = processStreamingChunk(state, "[DONE]");
    const types = extractTypes(events);
    expect(types).toContain("response.created");
    expect(types).toContain("response.in_progress");
    expect(types).toContain("response.completed");
    expect(state.phase).toBe("done");
  });

  it("handles empty content chunk", () => {
    const state = createStreamingState();
    processStreamingChunk(state, chunk({ role: "assistant", content: "" }));

    // Empty content string — should not emit delta
    const events = processStreamingChunk(state, chunk({ content: "" }));
    expect(events.length).toBe(0);
  });

  it("tracks usage when finish_reason arrives before trailing usage-only chunk", () => {
    const state = createStreamingState();
    processStreamingChunk(state, chunk({ role: "assistant", content: "" }));
    processStreamingChunk(state, chunk({ content: "hi" }));

    processStreamingChunk(state, chunk({}, "stop"));
    expect(state.phase).toBe("finished");

    const usageOnly = JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "gpt-4o",
      choices: [],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 17920 },
        completion_tokens_details: { reasoning_tokens: 34 },
      },
    });
    expect(processStreamingChunk(state, usageOnly)).toEqual([]);
    expect(state.usage).toEqual({
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 17920 },
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 34 },
      total_tokens: 150,
    });

    const doneEvents = processStreamingChunk(state, "[DONE]");
    const completedEvent = doneEvents.find((e: string) => e.includes("response.completed"));
    expect(completedEvent).toBeDefined();
    expect(completedEvent).toContain('"input_tokens":100');
    expect(completedEvent).toContain('"cached_tokens":17920');
    expect(completedEvent).toContain('"reasoning_tokens":34');
  });

  it("tracks usage when finish and usage are in one chunk", () => {
    const state = createStreamingState();
    processStreamingChunk(state, chunk({ role: "assistant", content: "" }));

    const usageChunk = JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "gpt-4o",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    processStreamingChunk(state, usageChunk);
    expect(state.usage?.input_tokens).toBe(100);
    const doneEvents = processStreamingChunk(state, "[DONE]");
    const completedEvent = doneEvents.find((e: string) => e.includes("response.completed"));
    expect(completedEvent).toBeDefined();
    expect(completedEvent).toContain('"input_tokens":100');
  });

  it("ignores malformed JSON", () => {
    const state = createStreamingState();
    const events = processStreamingChunk(state, "not valid json{{{");
    expect(events).toEqual([]);
  });

  it("emits sequence numbers in order", () => {
    const state = createStreamingState();

    // Collect all events from a complete stream (excluding [DONE])
    const allEvents: string[] = [];
    allEvents.push(...processStreamingChunk(state, chunk({ role: "assistant", content: "" })));
    allEvents.push(...processStreamingChunk(state, chunk({ content: "test content" })));
    allEvents.push(...processStreamingChunk(state, chunk({}, "stop")));
    allEvents.push(...processStreamingChunk(state, "[DONE]"));

    // Filter out [DONE] which has no sequence_number
    const jsonEvents = allEvents.filter((e: string) => !e.includes("[DONE]"));
    for (let i = 0; i < jsonEvents.length; i++) {
      expect(jsonEvents[i]).toContain(`"sequence_number":${i}`);
    }
  });

  it("echoes Responses request tools/reasoning into response.created shells", () => {
    const echo = extractResponsesEcho({
      tools: [{ type: "function", name: "my_fn", parameters: { type: "object" } }],
      reasoning: { effort: "medium", summary: "detailed" },
      truncation: "auto",
    });
    const state = createStreamingState({ echo });
    const ev = processStreamingChunk(state, chunk({ role: "assistant", content: "" }));
    const block = ev[0];
    const dataLine =
      block
        .split("\n")
        .find((l: string) => l.startsWith("data:"))
        ?.slice("data:".length)
        .trim() ?? "{}";
    const parsed = JSON.parse(dataLine) as {
      response?: { tools?: unknown[]; reasoning?: unknown; truncation?: string };
    };
    expect(parsed.response?.tools).toHaveLength(1);
    expect((parsed.response?.reasoning as { effort?: string }).effort).toBe("medium");
    expect(parsed.response?.truncation).toBe("auto");
  });
});

describe("createSseLineBuffer", () => {
  it("handles complete lines", () => {
    const lines: string[] = [];
    const buf = createSseLineBuffer((line: string) => lines.push(line));
    buf.feed(Buffer.from("data: hello\n\ndata: world\n\n"));
    expect(lines).toEqual(["data: hello", "data: world"]);
  });

  it("handles split across chunks", () => {
    const lines: string[] = [];
    const buf = createSseLineBuffer((line: string) => lines.push(line));
    buf.feed(Buffer.from("data: hel"));
    buf.feed(Buffer.from("lo\n\ndata: world\n\n"));
    expect(lines).toEqual(["data: hello", "data: world"]);
  });

  it("handles multiple lines in one chunk", () => {
    const lines: string[] = [];
    const buf = createSseLineBuffer((line: string) => lines.push(line));
    buf.feed(Buffer.from("data: a\n\ndata: b\n\ndata: c\n\n"));
    expect(lines).toEqual(["data: a", "data: b", "data: c"]);
  });

  it("flushes remaining buffer", () => {
    const lines: string[] = [];
    const buf = createSseLineBuffer((line: string) => lines.push(line));
    buf.feed(Buffer.from("data: partial"));
    expect(lines).toEqual([]);
    buf.flush();
    expect(lines).toEqual(["data: partial"]);
  });

  it("skips empty lines", () => {
    const lines: string[] = [];
    const buf = createSseLineBuffer((line: string) => lines.push(line));
    buf.feed(Buffer.from("\n\ndata: hello\n\n\n\ndata: world\n\n"));
    expect(lines).toEqual(["data: hello", "data: world"]);
  });
});
