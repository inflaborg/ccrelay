import { describe, expect, it } from "vitest";
import {
  isOpenAIResponsesSseBody,
  reconstructOpenAIResponsesFromSseLogBody,
} from "../../../web/src/features/logs/reconstructOpenAIResponsesSseMessage";

describe("reconstructOpenAIResponsesFromSseLogBody", () => {
  it("returns not_openai_responses_sse for Chat Completions chunks", () => {
    const sse = 'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"hi"}}]}';
    expect(isOpenAIResponsesSseBody(sse)).toBe(false);
    const r = reconstructOpenAIResponsesFromSseLogBody(sse);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("not_openai_responses_sse");
    }
  });

  it("extracts response from response.completed", () => {
    const sse = [
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_1","object":"response","status":"in_progress","output":[]}}',
      "event: response.completed",
      'data: {"type":"response.completed","response":{"id":"resp_1","object":"response","status":"completed","output":[{"type":"reasoning","id":"rs_1","content":[{"type":"reasoning_text","text":"think"}]},{"type":"message","id":"msg_1","role":"assistant","content":[{"type":"output_text","text":"hello"}]}],"usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}',
      "data: [DONE]",
    ].join("\n\n");

    const r = reconstructOpenAIResponsesFromSseLogBody(sse);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.message.id).toBe("resp_1");
    expect(r.message.status).toBe("completed");
    const output = r.message.output as Record<string, unknown>[];
    expect(output).toHaveLength(2);
    expect(output[0].type).toBe("reasoning");
    expect(output[1].type).toBe("message");
    const usage = r.message.usage as Record<string, unknown>;
    expect(usage.total_tokens).toBe(3);
  });

  it("falls back to output_item.done when response.completed is missing", () => {
    const sse = [
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_2","object":"response","model":"gpt","status":"in_progress","output":[]}}',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"rs_2","status":"completed","content":[{"type":"reasoning_text","text":"why"}]}}',
      'data: {"type":"response.output_item.done","output_index":1,"item":{"type":"message","id":"msg_2","role":"assistant","status":"completed","content":[{"type":"output_text","text":"ok"}]}}',
    ].join("\n\n");

    const r = reconstructOpenAIResponsesFromSseLogBody(sse);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.message.id).toBe("resp_2");
    const output = r.message.output as Record<string, unknown>[];
    expect(output).toHaveLength(2);
    expect((output[1].content as Record<string, unknown>[])[0].text).toBe("ok");
  });
});
