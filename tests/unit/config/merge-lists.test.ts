import { describe, expect, it } from "vitest";
import { mergeForwardRuleLists, mergeBlockRuleLists } from "@/config/merge";
import type { BlockRule, ForwardRule } from "@/types";

describe("mergeForwardRuleLists", () => {
  const def: ForwardRule[] = [{ path: "/a", provider: "auto" }];

  it("uses defaults when userRules undefined", () => {
    expect(mergeForwardRuleLists(def, undefined)).toEqual([{ path: "/a", provider: "auto" }]);
  });

  it("returns empty when user explicitly passes empty", () => {
    expect(mergeForwardRuleLists(def, [])).toEqual([]);
  });

  it("appends default paths not in user list", () => {
    expect(mergeForwardRuleLists(def, [{ path: "/b", provider: "x" }])).toEqual([
      { path: "/b", provider: "x" },
      { path: "/a", provider: "auto" },
    ]);
  });
});

describe("mergeBlockRuleLists", () => {
  const def: BlockRule[] = [{ path: "/x", response: "", code: 200 }];

  it("merges by path+condition key", () => {
    const user: BlockRule[] = [{ path: "/y", response: "{}", code: 200 }];
    expect(mergeBlockRuleLists(def, user)).toEqual([
      { path: "/y", response: "{}", code: 200 },
      { path: "/x", response: "", code: 200 },
    ]);
  });
});
