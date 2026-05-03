import { describe, it, expect } from "vitest";
import {
  isLocalProxyAnthropicBase,
  isLocalProxyCodexBase,
  parseTomlLite,
} from "@/api/clientConfig";

describe("clientConfig URL helpers", () => {
  it("isLocalProxyAnthropicBase requires localhost/127.0.0.1, port, and /anthropic path", () => {
    expect(isLocalProxyAnthropicBase("http://127.0.0.1:7575/anthropic", 7575)).toBe(true);
    expect(isLocalProxyAnthropicBase("http://localhost:7575/anthropic/", 7575)).toBe(true);
    expect(isLocalProxyAnthropicBase("http://127.0.0.1:7575", 7575)).toBe(false);
    expect(isLocalProxyAnthropicBase("http://127.0.0.1:9999", 7575)).toBe(false);
  });

  it("isLocalProxyCodexBase requires /openai path", () => {
    expect(isLocalProxyCodexBase("http://127.0.0.1:7575/openai", 7575)).toBe(true);
    expect(isLocalProxyCodexBase("http://localhost:7575/openai/", 7575)).toBe(true);
    expect(isLocalProxyCodexBase("http://127.0.0.1:7575/v1", 7575)).toBe(false);
    expect(isLocalProxyCodexBase("http://127.0.0.1:7575", 7575)).toBe(false);
  });
});

describe("parseTomlLite", () => {
  it("reads model_provider and [model_providers.ccrelay]", () => {
    const raw = `model = "m"
model_provider = "ccrelay"
[model_providers.ccrelay]
base_url = "http://127.0.0.1:7575/openai"
`;
    const t = parseTomlLite(raw);
    expect(t.top.model_provider).toBe("ccrelay");
    expect(t.sections["model_providers.ccrelay"]?.base_url).toBe("http://127.0.0.1:7575/openai");
  });
});
