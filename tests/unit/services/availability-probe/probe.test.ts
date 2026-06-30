import { describe, expect, it } from "vitest";
import { detectAvailabilityProbe } from "@/services/availability-probe/detector";
import { formatAvailabilityProbeResponse } from "@/services/availability-probe/formatter";

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI/Anthropic wire keys in fixtures */

describe("availability-probe detector", () => {
  it("detects max_completion_tokens=1 on /chat/completions", () => {
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: "." }],
        max_completion_tokens: 1,
      })
    );
    const detection = detectAvailabilityProbe(body, "POST", "/chat/completions", "anthropic");
    expect(detection).toEqual({
      model: "gpt-5.4",
      stream: false,
      responseSurface: "openai",
    });
  });

  it("detects max_tokens=1 on Anthropic /v1/messages", () => {
    const body = Buffer.from(
      JSON.stringify({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      })
    );
    const detection = detectAvailabilityProbe(body, "POST", "/v1/messages", "anthropic");
    expect(detection?.responseSurface).toBe("anthropic");
    expect(detection?.stream).toBe(false);
  });

  it("ignores normal token limits", () => {
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 1024,
      })
    );
    expect(detectAvailabilityProbe(body, "POST", "/chat/completions", "openai")).toBeNull();
  });
});

describe("availability-probe formatter", () => {
  it("returns OpenAI chat completion JSON with content '1'", () => {
    const out = formatAvailabilityProbeResponse({
      model: "gpt-5.4",
      stream: false,
      responseSurface: "openai",
    });
    expect(out.statusCode).toBe(200);
    expect(out.headers["Content-Type"]).toBe("application/json");
    const parsed = JSON.parse(out.body) as {
      choices: Array<{ message: { content: string } }>;
    };
    expect(parsed.choices[0]?.message.content).toBe("1");
    expect(out.tokens.outputTokens).toBe(1);
  });

  it("returns Anthropic message JSON with one text block", () => {
    const out = formatAvailabilityProbeResponse({
      model: "claude-sonnet-4-20250514",
      stream: false,
      responseSurface: "anthropic",
    });
    const parsed = JSON.parse(out.body) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(parsed.content[0]).toEqual({ type: "text", text: "1" });
  });

  it("returns SSE for streaming OpenAI chat probes", () => {
    const out = formatAvailabilityProbeResponse({
      model: "gpt-5.4",
      stream: true,
      responseSurface: "openai",
    });
    expect(out.headers["Content-Type"]).toBe("text/event-stream");
    expect(out.body).toContain("chat.completion.chunk");
    expect(out.body).toContain('"content":"1"');
    expect(out.body).toContain("[DONE]");
  });
});
