import { describe, expect, it, afterEach } from "vitest";
import { expandEnvVars } from "@/config/env";

describe("expandEnvVars", () => {
  afterEach(() => {
    delete process.env.FOO_TEST_ENV;
  });

  it("substitutes ${VAR} from process.env", () => {
    process.env.FOO_TEST_ENV = "bar";
    expect(expandEnvVars("x-${FOO_TEST_ENV}-y")).toBe("x-bar-y");
  });

  it("uses empty string for missing vars", () => {
    expect(expandEnvVars("x-${FOO_TEST_ENV}-y")).toBe("x--y");
  });

  it("leaves plain strings unchanged", () => {
    expect(expandEnvVars("plain")).toBe("plain");
  });
});
