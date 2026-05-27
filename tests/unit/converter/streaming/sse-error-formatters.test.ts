import { describe, it, expect } from "vitest";
import {
  extractUpstreamSseError,
  formatAnthropicSseError,
  formatOpenAIChatSseError,
  formatOpenAIResponsesSseError,
} from "@/converter/streaming/sse-formatters";

function parseSseBlocks(sse: string): string[] {
  return sse.split("\n\n").filter(b => b.trim().length > 0);
}

function parseResponsesDataEvents(sse: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const block of parseSseBlocks(sse)) {
    if (block.trim() === "data: [DONE]") {
      continue;
    }
    const dataLine = block.split("\n").find(l => l.startsWith("data: "));
    if (!dataLine) {
      continue;
    }
    const json = dataLine.slice("data: ".length).trimStart();
    out.push(JSON.parse(json) as Record<string, unknown>);
  }
  return out;
}

describe("extractUpstreamSseError", () => {
  it("parses error from SSE data line", () => {
    const body =
      'data: {"error":{"message":"webSearchEnabled is false","type":"invalid_request_error"}}\n\n';
    const err = extractUpstreamSseError(body, 400);
    expect(err.message).toBe("webSearchEnabled is false");
    expect(err.code).toBe("400");
    expect(err.type).toBe("invalid_request_error");
  });

  it("parses error from plain JSON body", () => {
    const body = JSON.stringify({ error: { message: "rate limited", code: "429" } });
    const err = extractUpstreamSseError(body, 429);
    expect(err.message).toBe("rate limited");
    expect(err.code).toBe("429");
  });

  it("falls back to truncated body when unparseable", () => {
    const err = extractUpstreamSseError("upstream exploded", 502);
    expect(err.message).toBe("upstream exploded");
    expect(err.code).toBe("502");
  });
});

describe("formatAnthropicSseError", () => {
  it("emits error and message_stop events with valid JSON", () => {
    const sse = formatAnthropicSseError(400, "bad request", "invalid_request_error");
    expect(sse).toContain("event: error\n");
    expect(sse).toContain("event: message_stop\n");
    const errorBlock = parseSseBlocks(sse).find(b => b.startsWith("event: error"));
    expect(errorBlock).toBeDefined();
    const dataLine = errorBlock!.split("\n").find(l => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length)) as {
      type: string;
      error: { type: string; message: string };
    };
    expect(parsed.type).toBe("error");
    expect(parsed.error.type).toBe("invalid_request_error");
    expect(parsed.error.message).toBe("bad request");
  });
});

describe("formatOpenAIChatSseError", () => {
  it("ends with data error and [DONE]", () => {
    const sse = formatOpenAIChatSseError(400, "webSearchEnabled is false", "400");
    const blocks = parseSseBlocks(sse);
    expect(blocks[0]).toMatch(/^data: /);
    const parsed = JSON.parse(blocks[0].slice("data: ".length)) as {
      error: { message: string; code: string; type: string };
    };
    expect(parsed.error.message).toBe("webSearchEnabled is false");
    expect(parsed.error.code).toBe("400");
    expect(parsed.error.type).toBe("server_error");
    expect(sse.trim().endsWith("data: [DONE]")).toBe(true);
  });
});

describe("formatOpenAIResponsesSseError", () => {
  it("emits lifecycle, top-level error, response.failed, and [DONE] with monotonic sequence_number", () => {
    const sse = formatOpenAIResponsesSseError(400, "webSearchEnabled is false", "400", "mimo-v2");
    const events = parseResponsesDataEvents(sse);
    const seqs = events.map(e => e.sequence_number as number);
    for (let i = 1; i < seqs.length; i++) {
      const prev = seqs[i - 1];
      if (prev !== undefined) {
        expect(seqs[i]).toBeGreaterThan(prev);
      }
    }
    expect(events.some(e => e.type === "response.created")).toBe(true);
    expect(events.some(e => e.type === "response.in_progress")).toBe(true);
    expect(events.some(e => e.type === "response.failed")).toBe(true);

    const failed = events.find(e => e.type === "response.failed") as {
      response?: { status?: string; error?: { message?: string; code?: string } };
    };
    expect(failed?.response?.status).toBe("failed");
    expect(failed?.response?.error?.message).toBe("webSearchEnabled is false");
    expect(failed?.response?.error?.code).toBe("400");

    expect(sse).toContain("event: error\n");
    const errorBlock = parseSseBlocks(sse).find(b => b.startsWith("event: error"));
    expect(errorBlock).toBeDefined();
    const errorData = errorBlock!.split("\n").find(l => l.startsWith("data: "))!;
    const topError = JSON.parse(errorData.slice("data: ".length)) as {
      type: string;
      message: string;
      code: string;
    };
    expect(topError.type).toBe("error");
    expect(topError.message).toBe("webSearchEnabled is false");
    expect(topError.code).toBe("400");

    expect(sse.trim().endsWith("data: [DONE]")).toBe(true);
  });
});
