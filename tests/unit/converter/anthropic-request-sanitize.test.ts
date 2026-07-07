import { describe, it, expect } from "vitest";
import {
  stripBillingHeaderFromAnthropicBody,
  sanitizeAnthropicOutboundBody,
  isBillingHeaderBlock,
} from "@/converter/anthropic-request-sanitize";

/* eslint-disable @typescript-eslint/naming-convention */

const BILLING_TEXT =
  "x-anthropic-billing-header: cc_version=2.1.177.e2d; cc_entrypoint=local-agent; cch=c76d1;";

describe("converter: anthropic-request-sanitize", () => {
  describe("isBillingHeaderBlock", () => {
    it("matches pure billing header with dynamic cc_version and cch", () => {
      expect(isBillingHeaderBlock(BILLING_TEXT)).toBe(true);
      expect(
        isBillingHeaderBlock(
          "x-anthropic-billing-header: cc_version=9.9.999.abc; cc_entrypoint=local-agent; cch=deadbeef;"
        )
      ).toBe(true);
    });

    it("rejects header prefix followed by real content", () => {
      expect(isBillingHeaderBlock(`${BILLING_TEXT}\nYou are a helpful assistant.`)).toBe(false);
      expect(isBillingHeaderBlock(`${BILLING_TEXT} extra instructions`)).toBe(false);
    });

    it("rejects key=value shape without cc_version or cch", () => {
      expect(isBillingHeaderBlock("x-anthropic-billing-header: cc_entrypoint=local-agent;")).toBe(
        false
      );
    });

    it("rejects non-string input", () => {
      expect(isBillingHeaderBlock(null)).toBe(false);
      expect(isBillingHeaderBlock(42)).toBe(false);
    });
  });

  describe("stripBillingHeaderFromAnthropicBody", () => {
    it("removes billing block from system array and preserves other blocks", () => {
      const input = {
        model: "claude-3",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
        system: [
          { type: "text", text: BILLING_TEXT },
          {
            type: "text",
            text: "You are a Claude agent.",
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
      };
      const body = Buffer.from(JSON.stringify(input), "utf-8");
      const out = stripBillingHeaderFromAnthropicBody(body);
      const parsed = JSON.parse(out.toString("utf-8")) as typeof input;

      expect(parsed.system).toHaveLength(1);
      expect(parsed.system?.[0]).toEqual({
        type: "text",
        text: "You are a Claude agent.",
        cache_control: { type: "ephemeral", ttl: "1h" },
      });
    });

    it("deletes system field when billing block is the only entry", () => {
      const input = {
        model: "claude-3",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
        system: [{ type: "text", text: BILLING_TEXT }],
      };
      const body = Buffer.from(JSON.stringify(input), "utf-8");
      const out = stripBillingHeaderFromAnthropicBody(body);
      const parsed = JSON.parse(out.toString("utf-8")) as Record<string, unknown>;

      expect(parsed.system).toBeUndefined();
    });

    it("returns original buffer when no billing block is present", () => {
      const input = {
        model: "claude-3",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
        system: [{ type: "text", text: "You are helpful." }],
      };
      const body = Buffer.from(JSON.stringify(input), "utf-8");
      const out = stripBillingHeaderFromAnthropicBody(body);

      expect(out).toBe(body);
    });

    it("does not remove block that starts with billing header but includes real content", () => {
      const mixed = `${BILLING_TEXT}\nReal system instructions here.`;
      const input = {
        model: "claude-3",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
        system: [{ type: "text", text: mixed }],
      };
      const body = Buffer.from(JSON.stringify(input), "utf-8");
      const out = stripBillingHeaderFromAnthropicBody(body);

      expect(out).toBe(body);
    });

    it("removes string system when entire string is billing header", () => {
      const input = {
        model: "claude-3",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
        system: BILLING_TEXT,
      };
      const body = Buffer.from(JSON.stringify(input), "utf-8");
      const out = stripBillingHeaderFromAnthropicBody(body);
      const parsed = JSON.parse(out.toString("utf-8")) as Record<string, unknown>;

      expect(parsed.system).toBeUndefined();
    });

    it("does not strip string system when billing header is followed by real content", () => {
      const input = {
        model: "claude-3",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
        system: `${BILLING_TEXT}\nReal prompt`,
      };
      const body = Buffer.from(JSON.stringify(input), "utf-8");
      const out = stripBillingHeaderFromAnthropicBody(body);

      expect(out).toBe(body);
    });

    it("returns original buffer for invalid JSON", () => {
      const body = Buffer.from("not-json", "utf-8");
      expect(stripBillingHeaderFromAnthropicBody(body)).toBe(body);
    });

    it("returns original buffer when system field is absent", () => {
      const input = {
        model: "claude-3",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
      };
      const body = Buffer.from(JSON.stringify(input), "utf-8");
      expect(stripBillingHeaderFromAnthropicBody(body)).toBe(body);
    });
  });

  describe("sanitizeAnthropicOutboundBody", () => {
    it("strips billing header and unsupported reasoning fields for haiku", () => {
      const input = {
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
        system: [{ type: "text", text: BILLING_TEXT }],
        thinking: { type: "enabled", budget_tokens: 1024 },
        output_config: { effort: "medium" },
      };
      const body = Buffer.from(JSON.stringify(input), "utf-8");
      const out = sanitizeAnthropicOutboundBody(body);
      const parsed = JSON.parse(out.toString("utf-8")) as Record<string, unknown>;

      expect(parsed.system).toBeUndefined();
      expect(parsed.thinking).toBeUndefined();
      expect(parsed.output_config).toBeUndefined();
    });

    it("preserves reasoning fields for sonnet", () => {
      const input = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
      };
      const body = Buffer.from(JSON.stringify(input), "utf-8");
      const out = sanitizeAnthropicOutboundBody(body);
      const parsed = JSON.parse(out.toString("utf-8")) as Record<string, unknown>;

      expect(parsed.thinking).toEqual({ type: "adaptive" });
      expect(parsed.output_config).toEqual({ effort: "medium" });
    });
  });
});
