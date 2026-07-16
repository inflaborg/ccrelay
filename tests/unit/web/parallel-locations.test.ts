import { describe, expect, it } from "vitest";
import {
  PARALLEL_ISO_COUNTRY_CODES,
  getParallelLocationOptions,
} from "../../../web/src/features/capabilities/parallel-locations";

describe("getParallelLocationOptions", () => {
  it("includes Auto first and all ISO country codes", () => {
    const options = getParallelLocationOptions("en", "Auto");
    expect(options[0]).toEqual({ value: "auto", label: "Auto" });
    expect(options.length).toBe(PARALLEL_ISO_COUNTRY_CODES.length + 1);
    expect(options.some(o => o.value === "cn")).toBe(true);
    expect(options.some(o => o.value === "us")).toBe(true);
  });

  it("preserves unknown saved location values", () => {
    const options = getParallelLocationOptions("en", "Auto", "zz");
    expect(options.some(o => o.value === "zz")).toBe(true);
  });
});
