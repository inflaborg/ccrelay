import { describe, expect, it } from "vitest";
import type { Provider, SmartRoutingModelRule } from "@/types";
import { matchSmartRoutingModelRules } from "@/server/smartRouting/resolveModelRules";

const providers: Record<string, Provider> = {
  a: {
    id: "a",
    name: "A",
    baseUrl: "https://a.example",
    mode: "passthrough",
    providerType: "anthropic",
    enabled: true,
  },
  b: {
    id: "b",
    name: "B",
    baseUrl: "https://b.example",
    mode: "passthrough",
    providerType: "openai",
    enabled: true,
  },
  off: {
    id: "off",
    name: "Off",
    baseUrl: "https://off.example",
    mode: "passthrough",
    providerType: "anthropic",
    enabled: false,
  },
};

function getProvider(id: string): Provider | undefined {
  return providers[id];
}

describe("matchSmartRoutingModelRules", () => {
  const rules: SmartRoutingModelRule[] = [
    { pattern: "exact-id", provider: "a", model: "upstream-a" },
    { pattern: "gpt-*", provider: "b", model: "gpt-4o" },
    { pattern: "disabled-rule", provider: "a", model: "x", enabled: false },
    { pattern: "missing-provider", provider: "nope", model: "y" },
    { pattern: "disabled-target", provider: "off", model: "z" },
  ];

  it("returns null for empty rules or blank model", () => {
    expect(matchSmartRoutingModelRules("m", undefined, getProvider)).toBeNull();
    expect(matchSmartRoutingModelRules("  ", rules, getProvider)).toBeNull();
  });

  it("matches exact pattern first", () => {
    expect(matchSmartRoutingModelRules("exact-id", rules, getProvider)).toEqual({
      providerId: "a",
      upstreamModelId: "upstream-a",
    });
  });

  it("matches wildcard with first matching rule order", () => {
    expect(matchSmartRoutingModelRules("gpt-foo", rules, getProvider)).toEqual({
      providerId: "b",
      upstreamModelId: "gpt-4o",
    });
  });

  it("skips disabled rules and invalid providers", () => {
    expect(matchSmartRoutingModelRules("disabled-rule", rules, getProvider)).toBeNull();
    expect(matchSmartRoutingModelRules("missing-provider", rules, getProvider)).toBeNull();
    expect(matchSmartRoutingModelRules("disabled-target", rules, getProvider)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchSmartRoutingModelRules("unknown", rules, getProvider)).toBeNull();
  });
});
