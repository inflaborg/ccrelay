import { describe, expect, it } from "vitest";
import { reconstructMessageFromSseLogBody } from "../../../web/src/features/logs/reconstructAnthropicSseMessage";

describe("reconstructMessageFromSseLogBody", () => {
  it("returns not_sse for plain JSON string", () => {
    const r = reconstructMessageFromSseLogBody('{"foo":1}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("not_sse");
    }
  });

  it("reconstructs tool_use input built only from input_json_delta", () => {
    const sse = [
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"m","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu1","name":"calc","input":null}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\""}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":":1}"}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
      'data: {"type":"message_stop"}',
    ].join("\n");

    const r = reconstructMessageFromSseLogBody(sse);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.message.id).toBe("msg_1");
    expect(Array.isArray(r.message.content)).toBe(true);
    const content = r.message.content as Record<string, unknown>[];
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("tool_use");
    expect(content[0].name).toBe("calc");
    expect(content[0].input).toEqual({ a: 1 });
    expect((r.message.usage as Record<string, unknown>).output_tokens).toBe(5);
    expect(r.message.stop_reason).toBe("end_turn");
  });

  it("merges text_delta into text block and preserves web_search_tool_result block", () => {
    const sse = [
      'data: {"type":"message_start","message":{"id":"msg_x","type":"message","role":"assistant","model":"glm","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srv1","name":"web_search","input":{"query":"headlines"}}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"web_search_tool_result","tool_use_id":"srv1","content":[{"type":"web_search_result","url":"https://apnews.com","title":"AP","encrypted_content":"brief"}]}}',
      'data: {"type":"content_block_stop","index":1}',
      'data: {"type":"content_block_start","index":2,"content_block":{"type":"text","text":""}}',
      'data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"Hello "}}',
      'data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"world"}}',
      'data: {"type":"content_block_stop","index":2}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":283}}',
    ].join("\n");

    const r = reconstructMessageFromSseLogBody(sse);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    const content = r.message.content as Record<string, unknown>[];
    expect(content).toHaveLength(3);
    expect(content[0].type).toBe("server_tool_use");
    expect(content[1].type).toBe("web_search_tool_result");
    expect(content[2].type).toBe("text");
    expect(content[2].text).toBe("Hello world");
    expect((r.message.usage as Record<string, unknown>).output_tokens).toBe(283);
  });

  it("reconstructs message when body starts with SSE comment/heartbeat lines", () => {
    const sse = [
      ": PROCESSING",
      "",
      "event: message_start",
      'data: {"type":"message_start","message":{"id":"msg_cffd7471f8fb476c9d190d60","type":"message","role":"assistant","model":"mimo-v2.5-pro","content":[],"usage":{"input_tokens":0,"output_tokens":0}}}',
      "event: content_block_start",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"The user keeps clicking"},"index":0}',
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":" on the same file"},"index":0}',
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":". Let me just"},"index":0}',
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":" present it."},"index":0}',
      "event: content_block_stop",
      'data: {"type":"content_block_stop","index":0}',
      "event: content_block_start",
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_b4b2758d69f34de9b9431fdf","name":"mcp__cowork__present_files","input":{}}}',
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"files\\": [{\\"file_path\\": \\"/tmp/report.md\\"}]}"},"index":1}',
      "event: content_block_stop",
      'data: {"type":"content_block_stop","index":1}',
      "event: message_delta",
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":491,"output_tokens":188,"cache_read_input_tokens":158272}}',
      "event: message_stop",
      'data: {"type":"message_stop"}',
    ].join("\n");

    const r = reconstructMessageFromSseLogBody(sse);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.message.id).toBe("msg_cffd7471f8fb476c9d190d60");
    expect(r.message.stop_reason).toBe("tool_use");
    const content = r.message.content as Record<string, unknown>[];
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("thinking");
    expect(content[0].thinking).toBe(
      "The user keeps clicking on the same file. Let me just present it."
    );
    expect(content[1].type).toBe("tool_use");
    expect(content[1].name).toBe("mcp__cowork__present_files");
    const toolInput = content[1].input as { files: Record<string, unknown>[] };
    expect(toolInput.files).toHaveLength(1);
    expect(toolInput.files[0]["file_path"]).toBe("/tmp/report.md");
    expect((r.message.usage as Record<string, unknown>).cache_read_input_tokens).toBe(158272);
  });

  it("marks incomplete blocks with _incomplete", () => {
    const sse = [
      'data: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","model":"x","content":[]}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"hi"}}',
    ].join("\n");
    const r = reconstructMessageFromSseLogBody(sse);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    const content = r.message.content as Record<string, unknown>[];
    expect(content[0]._incomplete).toBe(true);
    expect(content[0].text).toBe("hi");
  });
});
