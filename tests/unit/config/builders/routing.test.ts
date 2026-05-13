import { describe, expect, it } from "vitest";
import { buildRoutingFromMerged } from "@/config/builders/routing";

describe("buildRoutingFromMerged", () => {
  it("maps forward and block from merged routing", () => {
    const r = buildRoutingFromMerged({
      forward: [{ path: "/a", provider: "auto" }],
      block: [{ path: "/b", response: "{}", code: 200 }],
    });
    expect(r.forward).toEqual([{ path: "/a", provider: "auto" }]);
    expect(r.block).toEqual([{ path: "/b", response: "{}", code: 200 }]);
  });

  it("treats undefined routing as empty lists", () => {
    const r = buildRoutingFromMerged(undefined);
    expect(r.forward).toEqual([]);
    expect(r.block).toEqual([]);
  });
});
