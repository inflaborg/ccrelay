import { describe, it, expect } from "vitest";
import { getDefaultRoutingSettings } from "@/config";

describe("getDefaultRoutingSettings", () => {
  it("matches bundled defaults: prefixed forward rules and providerNot admin blocks", () => {
    const r = getDefaultRoutingSettings();
    expect(r.forward.some(x => x.path === "/openai/models")).toBe(true);
    expect(r.forward.some(x => x.path === "/anthropic/v1/messages")).toBe(true);
    const users = r.block.find(x => x.path === "/v1/users/*");
    expect(users?.condition?.providerNot).toEqual(["official"]);
    expect(r.block.some(x => x.path === "/anthropic/v1/organizations/*")).toBe(true);
  });
});
