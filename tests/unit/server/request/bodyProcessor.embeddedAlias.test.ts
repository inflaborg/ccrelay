import { describe, it, expect } from "vitest";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

/* eslint-disable @typescript-eslint/naming-convention */

describe("BodyProcessor embedded model alias rewrite", () => {
  const alias = "claude-93e5ab20";
  const upstreamModel = "claude-sonnet-4-20250514";

  const anthropicUpstream: Provider = {
    id: "official",
    name: "Official",
    baseUrl: "https://api.anthropic.com",
    mode: "passthrough",
    providerType: "anthropic",
    apiKey: "sk",
    modelMap: [{ pattern: alias, model: upstreamModel }],
  };

  function makeRouting(overrides: Partial<RoutingContext>): RoutingContext {
    return {
      blocked: false,
      method: "POST",
      path: "/anthropic/v1/messages",
      provider: anthropicUpstream,
      clientHeaders: {},
      headers: {},
      targetUrl: "https://api.anthropic.com/v1/messages",
      targetPath: "/v1/messages",
      targetQuery: "",
      isRouted: false,
      isOpenAIProvider: false,
      clientSurface: "anthropic",
      ...overrides,
    };
  }

  function makeAliasRequestBody(): Buffer {
    return Buffer.from(
      JSON.stringify({
        model: alias,
        max_tokens: 1024,
        messages: [{ role: "user", content: "hello" }],
        system: [
          { type: "text", text: `<env>Model: ${alias}</env>` },
          { type: "text", text: `You are powered by the model ${alias}.` },
        ],
      }),
      "utf-8"
    );
  }

  it("rewrites hashed alias mentions in system after model mapping", () => {
    const routing = makeRouting({ provider: anthropicUpstream });
    const proc = new BodyProcessor();
    const result = proc.process(makeAliasRequestBody(), routing, false);

    const parsed = JSON.parse(result.body.toString("utf-8")) as {
      model: string;
      system?: { text: string }[];
    };
    expect(parsed.model).toBe(upstreamModel);
    expect(parsed.system?.[0].text).toBe(`<env>Model: ${upstreamModel}</env>`);
    expect(parsed.system?.[1].text).toBe(`You are powered by the model ${upstreamModel}.`);
    expect(JSON.stringify(parsed)).not.toContain(alias);
  });

  it("does not rewrite non-alias model renames", () => {
    const provider: Provider = {
      ...anthropicUpstream,
      modelMap: [{ pattern: "claude-3-5-sonnet-20241022", model: upstreamModel }],
    };
    const body = Buffer.from(
      JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hello" }],
        system: "You are powered by the model claude-3-5-sonnet-20241022.",
      }),
      "utf-8"
    );
    const result = new BodyProcessor().process(body, makeRouting({ provider }), false);
    const parsed = JSON.parse(result.body.toString("utf-8")) as {
      model: string;
      system: string;
    };

    expect(parsed.model).toBe(upstreamModel);
    expect(parsed.system).toBe("You are powered by the model claude-3-5-sonnet-20241022.");
  });
});
