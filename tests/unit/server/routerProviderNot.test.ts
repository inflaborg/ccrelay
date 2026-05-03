import { describe, it, expect } from "vitest";
import { Router } from "@/server/router";
import type { ConfigManager } from "@/config";
import type { BlockRule, ForwardRule, Provider } from "@/types";

const providers: Record<string, Provider> = {
  official: {
    id: "official",
    name: "Official",
    baseUrl: "https://api.anthropic.com",
    mode: "passthrough",
    providerType: "anthropic",
  },
  other: {
    id: "other",
    name: "Other",
    baseUrl: "https://example.com",
    mode: "passthrough",
    providerType: "openai",
  },
};

function makeRouter(
  currentId: string,
  blockRules: BlockRule[],
  forwardRules: ForwardRule[]
): Router {
  const config = {
    blockRules,
    forwardRules,
    getCurrentProviderId: () => currentId,
    getProvider: (id: string) => providers[id],
    providers,
  };
  return new Router(config as unknown as ConfigManager);
}

describe("Router.resolve providerNot", () => {
  const userBlock: BlockRule = {
    path: "/v1/users/*",
    condition: { providerNot: ["official"] },
    response: "",
    code: 200,
  };
  const pingForward: ForwardRule = { path: "/v1/messages", provider: "auto" };

  it("blocks /v1/users/* when current provider is not official", () => {
    const router = makeRouter("other", [userBlock], [pingForward]);
    const r = router.resolve("/v1/users/abc");
    expect(r.type).toBe("block");
  });

  it("skips providerNot block when current provider is official", () => {
    const router = makeRouter("official", [userBlock], [pingForward]);
    const r = router.resolve("/v1/users/abc");
    expect(r.type).toBe("not_found");
  });

  it("matches anthropic-prefixed paths with same providerNot condition", () => {
    const blk: BlockRule = {
      path: "/anthropic/v1/organizations/*",
      condition: { providerNot: ["official"] },
      response: "",
      code: 200,
    };
    const router = makeRouter("other", [blk], []);
    expect(router.resolve("/anthropic/v1/organizations/x").type).toBe("block");
    const allowed = makeRouter("official", [blk], []);
    expect(allowed.resolve("/anthropic/v1/organizations/x").type).toBe("not_found");
  });
});

describe("Router.resolve providers allowlist", () => {
  it("hits block only when current id is listed in condition.providers", () => {
    const blk: BlockRule = {
      path: "/mirror/*",
      condition: { providers: ["official"] },
      response: "stale",
      code: 418,
    };
    expect(makeRouter("official", [blk], []).resolve("/mirror/x").type).toBe("block");
    expect(makeRouter("other", [blk], []).resolve("/mirror/x").type).toBe("not_found");
  });

  it("honors providers allowlist plus providerNot (both gates)", () => {
    const blk: BlockRule = {
      path: "/x/*",
      condition: { providers: ["official", "other"], providerNot: ["official"] },
      response: "",
      code: 200,
    };
    expect(makeRouter("official", [blk], []).resolve("/x/1").type).toBe("not_found");
    expect(makeRouter("other", [blk], []).resolve("/x/1").type).toBe("block");
    expect(makeRouter("third", [blk], []).resolve("/x/1").type).toBe("not_found");
  });
});
