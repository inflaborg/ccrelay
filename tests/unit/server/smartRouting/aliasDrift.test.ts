import { describe, expect, it } from "vitest";
import type { Provider, SmartRoutingConfig } from "@/types";
import { collectAliasDrifts, applyAliasDriftUpdates } from "@/server/smartRouting/aliasDrift";
import { computeCanonicalAliasHash } from "@/server/smartRouting/aliasHash";

const sr: SmartRoutingConfig = {
  enabled: true,
  aliasPrefix: "claude-",
  modelsCache: { ttlSeconds: 600, refreshOnStart: true, onUpstreamFail: "stale" },
  bareModelFallback: { mode: "first-match" },
};

function provider(id: string, lines: string[]): Provider {
  return {
    id,
    name: id,
    baseUrl: "https://example.com",
    mode: "inject",
    providerType: "anthropic",
    enabled: true,
    useCustomModelsList: true,
    customModelsList: lines,
  };
}

describe("aliasDrift", () => {
  it("returns zero drift when alias equals id or canonical", () => {
    const canonical = computeCanonicalAliasHash("p", "anthropic", "glm-5.1");
    const providers = {
      p: provider("p", ["glm-5.1", `glm-5.1;Name;${canonical}`]),
    };
    expect(collectAliasDrifts(providers, sr)).toHaveLength(0);
  });

  it("flags collision when old alias repeats across providers", () => {
    const providers = {
      cn: provider("cn", ["glm-5.1;CN;claude-abc12345"]),
      global: provider("global", ["glm-5.1;Global;claude-abc12345"]),
    };
    const drifts = collectAliasDrifts(providers, sr);
    expect(drifts).toHaveLength(2);
    expect(drifts.every(d => d.collision)).toBe(true);
    expect(drifts[0].collisionPeers?.length).toBe(1);
  });

  it("applyAliasDriftUpdates rewrites third segment only", () => {
    const next = applyAliasDriftUpdates(
      ["glm-5.1;GLM;old-alias"],
      [{ lineIndex: 0, newAlias: "claude-deadbeef" }]
    );
    expect(next[0]).toBe("glm-5.1;GLM;claude-deadbeef");
  });
});
