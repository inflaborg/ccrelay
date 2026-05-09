/* eslint-disable @typescript-eslint/naming-convention */
import { describe, expect, it } from "vitest";
import type { AnthropicSseEventRow } from "@/converter/platform-transforms";
import {
  applyAnthropicSseRowsPlatformTransform,
  parseAnthropicSseRows,
  parseGlmToolResultAsSearchEntries,
  serializeAnthropicSseRows,
  transformGlmAnthropicSearchSseRows,
} from "@/converter/platform-transforms";

describe("parseGlmToolResultAsSearchEntries", () => {
  it("unwraps GLM [[...]] JSON", () => {
    const raw = JSON.stringify([
      [{ title: "A", link: "https://a", content: "snippet", refer: "ref_1" }],
    ]);
    const hits = parseGlmToolResultAsSearchEntries(raw);
    expect(hits).toEqual([{ title: "A", link: "https://a", content: "snippet", refer: "ref_1" }]);
  });

  it("returns null on invalid JSON", () => {
    expect(parseGlmToolResultAsSearchEntries("not json")).toBeNull();
  });
});

describe("parseAnthropicSseRows / serializeAnthropicSseRows", () => {
  it("round-trips a minimal event", () => {
    const text = `event: ping\ndata: {"type":"ping"}\n\n`;
    const rows = parseAnthropicSseRows(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventName).toBe("ping");
    expect(rows[0].data.type).toBe("ping");
    expect(serializeAnthropicSseRows(rows).trimEnd()).toBe(text.trimEnd());
  });
});

describe("transformGlmAnthropicSearchSseRows", () => {
  it("rewrites web_search_prime + tool_result into web_search_tool_result", () => {
    const toolResultJson = JSON.stringify([[{ title: "T1", link: "https://u1", content: "S1" }]]);
    const rows: AnthropicSseEventRow[] = [
      {
        data: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "server_tool_use",
            id: "call_1",
            name: "web_search_prime",
            input: {},
          },
        },
      },
      {
        data: {
          type: "content_block_stop",
          index: 0,
        },
      },
      {
        data: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_result",
            tool_use_id: "call_1",
          },
        },
      },
      {
        data: {
          type: "content_block_delta",
          index: 1,
          delta: { content: toolResultJson },
        },
      },
      {
        data: {
          type: "content_block_stop",
          index: 1,
        },
      },
    ];

    const out = transformGlmAnthropicSearchSseRows(rows);
    const serverUse = out.find(
      r =>
        r.data.type === "content_block_start" &&
        (r.data.content_block as Record<string, unknown>).type === "server_tool_use"
    );
    expect(serverUse?.data.content_block).toMatchObject({
      type: "server_tool_use",
      name: "web_search",
      id: "call_1",
    });
    const ws = out.find(
      r =>
        r.data.type === "content_block_start" &&
        (r.data.content_block as Record<string, unknown>).type === "web_search_tool_result"
    );
    expect(ws).toBeDefined();
    const block = ws!.data.content_block as Record<string, unknown>;
    expect(block.tool_use_id).toBe("call_1");
    const content = block.content as Record<string, unknown>[];
    expect(content[0]).toMatchObject({
      type: "web_search_result",
      url: "https://u1",
      title: "T1",
      encrypted_content: "S1",
    });
  });

  it("rewrites web_search_prime in GLM text_delta prose to match normalized tool name", () => {
    const rows: AnthropicSseEventRow[] = [
      {
        data: {
          type: "content_block_delta",
          index: 1,
          delta: {
            type: "text_delta",
            text: "**Tool: web_search_prime**\nOutput: web_search_prime_result_summary: []",
          },
        },
      },
    ];
    const out = transformGlmAnthropicSearchSseRows(rows);
    expect((out[0].data.delta as Record<string, unknown>).text).toBe(
      "**Tool: web_search**\nOutput: web_search_result_summary: []"
    );
  });
});

describe("applyAnthropicSseRowsPlatformTransform", () => {
  it("no-ops for unrelated baseUrl", () => {
    const rows: AnthropicSseEventRow[] = [{ data: { type: "ping" } }];
    expect(applyAnthropicSseRowsPlatformTransform(rows, "https://api.openai.com")).toEqual(rows);
  });

  it("applies GLM rule for api.z.ai hostname", () => {
    const rows: AnthropicSseEventRow[] = [
      {
        data: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "server_tool_use",
            id: "call_1",
            name: "web_search_prime",
          },
        },
      },
    ];
    const transformed = applyAnthropicSseRowsPlatformTransform(rows, "https://api.z.ai/v1");
    const cb = transformed[0].data.content_block as Record<string, unknown>;
    expect(cb.name).toBe("web_search");
  });
});
