import { describe, it, expect } from "vitest";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

describe("BodyProcessor singleLeadingSystem", () => {
  function makeRouting(singleLeadingSystem?: boolean): RoutingContext {
    const provider: Provider = {
      id: "qwen",
      name: "Qwen",
      baseUrl: "https://example.com/v1",
      mode: "inject",
      providerType: "openai_chat",
      apiKey: "k",
      ...(singleLeadingSystem ? { singleLeadingSystem: true } : {}),
    };
    return {
      blocked: false,
      method: "POST",
      path: "/openai/v1/responses",
      provider,
      clientHeaders: {},
      headers: {},
      targetUrl: "https://example.com/v1/responses",
      targetPath: "/responses",
      targetQuery: "",
      isRouted: false,
      isOpenAIProvider: true,
      clientSurface: "openai_responses",
    };
  }

  const raw = {
    model: "Qwen3.6",
    input: [
      { type: "message", role: "developer", content: "You are Codex." },
      { type: "message", role: "user", content: "environment" },
      { type: "message", role: "system", content: "timezone" },
      { type: "message", role: "user", content: "hi" },
    ],
  };

  function messagesOf(singleLeadingSystem?: boolean): { role: string; content: string }[] {
    const routing = makeRouting(singleLeadingSystem);
    const result = new BodyProcessor().process(Buffer.from(JSON.stringify(raw)), routing, false);
    const body = JSON.parse(result.body.toString("utf-8")) as {
      messages: { role: string; content: string }[];
    };
    return body.messages;
  }

  it("leaves interleaved system messages in place when the option is off", () => {
    expect(messagesOf(false).map(m => m.role)).toEqual(["system", "user", "system", "user"]);
    expect(messagesOf(false)[2]?.content).toBe("timezone");
  });

  it("merges system and developer into one leading system when the option is on", () => {
    expect(messagesOf(true)).toEqual([
      { role: "system", content: "You are Codex.\n\ntimezone" },
      { role: "user", content: "environment" },
      { role: "user", content: "hi" },
    ]);
  });
});
