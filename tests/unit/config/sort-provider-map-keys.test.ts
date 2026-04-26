import { describe, it, expect } from "vitest";
import {
  sortProviderMapKeys,
  resolveProviderKeyInMap,
  providerIdFuzzyBaseForDuplicateKey,
} from "../../../src/config/index";

describe("sortProviderMapKeys", () => {
  it("returns empty object for empty input", () => {
    expect(sortProviderMapKeys({})).toEqual({});
  });

  it("places official first, then sorts other ids by en locale with numeric: true", () => {
    const input: Record<string, { n: number }> = {
      zeta: { n: 1 },
      official: { n: 0 },
      alpha: { n: 3 },
    };
    input["item-2"] = { n: 2 };
    const out = sortProviderMapKeys(input);
    expect(Object.keys(out)).toEqual(["official", "alpha", "item-2", "zeta"]);
    expect(out.official).toEqual({ n: 0 });
    expect(out.alpha).toEqual({ n: 3 });
  });

  it("sorts all keys when official is absent", () => {
    const input: Record<string, number> = { b: 1, a: 2 };
    input["10"] = 3;
    input["2"] = 4;
    const out = sortProviderMapKeys(input);
    expect(Object.keys(out)).toEqual(["2", "10", "a", "b"]);
  });

  it("preserves values without cloning deep contents", () => {
    const inner = { x: 1 };
    const out = sortProviderMapKeys({ b: inner, a: inner });
    expect(out.a).toBe(out.b);
  });
});

describe("resolveProviderKeyInMap", () => {
  it("matches exact id", () => {
    expect(resolveProviderKeyInMap(["a", "b"], "a")).toBe("a");
  });

  it("decodes percent-encoded path segment to match key", () => {
    expect(resolveProviderKeyInMap(["p/1"], "p%2F1")).toBe("p/1");
  });

  it("resolves case when only one key differs by case", () => {
    const k = "local-hysp-llm-routerCopy";
    expect(resolveProviderKeyInMap([k], "local-hysp-llm-routercopy")).toBe(k);
  });

  it("maps _copy yaml key to camel Copy path id (user report)", () => {
    const yamlKey = "local-hysp-llm-router_copy";
    const urlId = "local-hysp-llm-routerCopy";
    expect(providerIdFuzzyBaseForDuplicateKey(yamlKey)).toBe(
      providerIdFuzzyBaseForDuplicateKey(urlId)
    );
    expect(resolveProviderKeyInMap([yamlKey, "other"], urlId)).toBe(yamlKey);
  });

  it("when source and _copy both exist, Copy request maps only to duplicate key", () => {
    const keys = ["minimax-m2-5", "minimax-m2-5_copy", "other"];
    expect(resolveProviderKeyInMap(keys, "minimax-m2-5Copy")).toBe("minimax-m2-5_copy");
  });
});
