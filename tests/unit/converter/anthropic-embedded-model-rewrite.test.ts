import { describe, it, expect } from "vitest";
import { rewriteEmbeddedModelAliasInAnthropicBody } from "@/converter/anthropic-embedded-model-rewrite";

/* eslint-disable @typescript-eslint/naming-convention */

describe("converter: anthropic-embedded-model-rewrite", () => {
  const alias = "claude-93e5ab20";
  const mapped = "claude-sonnet-4-20250514";

  it("rewrites alias in string system", () => {
    const input = {
      model: mapped,
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
      system: `<env>Model: ${alias}</env>\nYou are powered by the model ${alias}.`,
    };
    const body = Buffer.from(JSON.stringify(input), "utf-8");
    const out = rewriteEmbeddedModelAliasInAnthropicBody(body, alias, mapped);
    const parsed = JSON.parse(out.toString("utf-8")) as typeof input;

    expect(parsed.system).toBe(
      `<env>Model: ${mapped}</env>\nYou are powered by the model ${mapped}.`
    );
  });

  it("rewrites alias inside text blocks and preserves cache_control", () => {
    const input = {
      model: mapped,
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
      system: [
        {
          type: "text",
          text: `Model: ${alias}`,
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
        { type: "text", text: `Powered by ${alias}.` },
      ],
    };
    const body = Buffer.from(JSON.stringify(input), "utf-8");
    const out = rewriteEmbeddedModelAliasInAnthropicBody(body, alias, mapped);
    const parsed = JSON.parse(out.toString("utf-8")) as typeof input;

    expect(parsed.system).toEqual([
      {
        type: "text",
        text: `Model: ${mapped}`,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
      { type: "text", text: `Powered by ${mapped}.` },
    ]);
  });

  it("returns original buffer when from equals to", () => {
    const input = {
      model: alias,
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
      system: `Model: ${alias}`,
    };
    const body = Buffer.from(JSON.stringify(input), "utf-8");
    const out = rewriteEmbeddedModelAliasInAnthropicBody(body, alias, alias);

    expect(out).toBe(body);
  });

  it("returns original buffer when system has no alias mention", () => {
    const input = {
      model: mapped,
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
      system: "You are a helpful assistant.",
    };
    const body = Buffer.from(JSON.stringify(input), "utf-8");
    const out = rewriteEmbeddedModelAliasInAnthropicBody(body, alias, mapped);

    expect(out).toBe(body);
  });

  it("does not rewrite alias mentions in messages", () => {
    const input = {
      model: mapped,
      max_tokens: 1024,
      messages: [{ role: "user", content: `Use model ${alias}` }],
      system: `Model: ${alias}`,
    };
    const body = Buffer.from(JSON.stringify(input), "utf-8");
    const out = rewriteEmbeddedModelAliasInAnthropicBody(body, alias, mapped);
    const parsed = JSON.parse(out.toString("utf-8")) as typeof input;

    expect(parsed.system).toBe(`Model: ${mapped}`);
    expect(parsed.messages[0].content).toBe(`Use model ${alias}`);
  });

  it("uses word boundaries and avoids partial id matches", () => {
    const input = {
      model: mapped,
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
      system: `prefix-${alias}-suffix should stay; exact ${alias} should change`,
    };
    const body = Buffer.from(JSON.stringify(input), "utf-8");
    const out = rewriteEmbeddedModelAliasInAnthropicBody(body, alias, mapped);
    const parsed = JSON.parse(out.toString("utf-8")) as typeof input;

    expect(parsed.system).toBe(`prefix-${alias}-suffix should stay; exact ${mapped} should change`);
  });
});
