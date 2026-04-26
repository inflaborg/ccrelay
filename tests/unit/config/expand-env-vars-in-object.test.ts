import { describe, it, expect } from "vitest";
import { expandEnvVarsInObject } from "../../../src/config/index";

/* eslint-disable @typescript-eslint/naming-convention -- YAML / raw config keys are snake_case or arbitrary ids */
describe("expandEnvVarsInObject", () => {
  it("preserves provider map keys with _copy (no _c to C mangling)", () => {
    const raw = {
      providers: {
        "minimax-m2-5_copy": {
          name: "Copy",
          base_url: "https://example.com",
        },
      },
    };
    const out = expandEnvVarsInObject(raw);
    const providers = out.providers as Record<string, { baseUrl?: string }>;
    expect(Object.keys(providers)).toEqual(["minimax-m2-5_copy"]);
    expect(providers["minimax-m2-5_copy"]?.baseUrl).toBe("https://example.com");
  });

  it("still camelCases fields on default_provider and provider bodies", () => {
    const raw = {
      default_provider: "official",
      providers: {
        official: { name: "O", base_url: "u" },
      },
    };
    const out = expandEnvVarsInObject(raw) as unknown as {
      defaultProvider: string;
      providers: Record<string, { baseUrl: string }>;
    };
    expect(out.defaultProvider).toBe("official");
    expect(out.providers.official.baseUrl).toBe("u");
  });
});
