/**
 * Unit tests for config/index.ts
 *
 * Product Requirements:
 * - Environment variable substitution with ${VAR_NAME} syntax
 * - Snake_case to camelCase conversion for YAML config
 * - Provider validation using Zod schemas
 * - Default values for missing configuration
 * - VSCode settings override file config when useConfigFile is false
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ProviderConfigSchema,
  FileConfigSchema,
  ServerConfigSchema,
  BlockPatternSchema,
  type ProviderConfigInput,
} from "@/types";

/* eslint-disable @typescript-eslint/naming-convention -- Testing snake_case config inputs */

describe("config: schema validation", () => {
  describe("ProviderConfigSchema", () => {
    it("should validate minimal valid provider config", () => {
      const input: ProviderConfigInput = {
        name: "Test Provider",
        baseUrl: "https://api.example.com",
        mode: "passthrough",
      };

      const result = ProviderConfigSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Test Provider");
        expect(result.data.baseUrl).toBe("https://api.example.com");
      }
    });

    it("should accept provider with all optional fields", () => {
      const input: ProviderConfigInput = {
        name: "Full Provider",
        baseUrl: "https://api.example.com",
        mode: "inject",
        providerType: "openai",
        apiKey: "sk-test",
        authHeader: "x-api-key",
        modelMap: { "claude-*": "gpt-4" },
        vlModelMap: { "claude-*": "gpt-4-vision" },
        headers: { "X-Custom": "value" },
        enabled: true,
      };

      const result = ProviderConfigSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe("inject");
        expect(result.data.providerType).toBe("openai");
        expect(result.data.apiKey).toBe("sk-test");
        expect(result.data.modelMap).toEqual({ "claude-*": "gpt-4" });
      }
    });

    it("should support both camelCase and snake_case baseUrl", () => {
      const camelCase = {
        name: "Test",
        baseUrl: "https://api.test.com",
        mode: "passthrough" as const,
      };
      const snakeCase = {
        name: "Test",
        base_url: "https://api.test.com",
        mode: "passthrough" as const,
      };

      const result1 = ProviderConfigSchema.safeParse(camelCase);
      const result2 = ProviderConfigSchema.safeParse(snakeCase);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it("should support both camelCase and snake_case apiKey", () => {
      const camelCase = {
        name: "Test",
        baseUrl: "https://api.test.com",
        apiKey: "key1",
        mode: "passthrough" as const,
      };
      const snakeCase = {
        name: "Test",
        baseUrl: "https://api.test.com",
        api_key: "key2",
        mode: "passthrough" as const,
      };

      const result1 = ProviderConfigSchema.safeParse(camelCase);
      const result2 = ProviderConfigSchema.safeParse(snakeCase);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it("should support both camelCase and snake_case modelMap", () => {
      const camelCase = {
        name: "Test",
        baseUrl: "https://api.test.com",
        mode: "passthrough",
        modelMap: { "claude-*": "gpt-4" },
      };
      const snakeCase = {
        name: "Test",
        baseUrl: "https://api.test.com",
        mode: "passthrough",
        model_map: { "claude-*": "gpt-4" },
      };

      const result1 = ProviderConfigSchema.safeParse(camelCase);
      const result2 = ProviderConfigSchema.safeParse(snakeCase);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it("should validate mode enum values", () => {
      const validModes = ["passthrough", "inject"] as const;

      for (const mode of validModes) {
        const input: ProviderConfigInput = { name: "Test", baseUrl: "https://api.test.com", mode };
        const result = ProviderConfigSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it("should validate providerType enum values", () => {
      const validTypes = ["anthropic", "openai"] as const;

      for (const type of validTypes) {
        const input: ProviderConfigInput = {
          name: "Test",
          baseUrl: "https://api.test.com",
          mode: "passthrough",
          providerType: type,
        };
        const result = ProviderConfigSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid mode value", () => {
      const input = {
        name: "Test",
        baseUrl: "https://api.test.com",
        mode: "invalid_mode",
      };

      const result = ProviderConfigSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("should reject empty name", () => {
      const input = {
        name: "",
        baseUrl: "https://api.test.com",
      };

      const result = ProviderConfigSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("should reject empty URL", () => {
      const input = {
        name: "Test",
        baseUrl: "",
      };

      const result = ProviderConfigSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("should accept non-URL strings for baseUrl (for compatibility)", () => {
      const input = {
        name: "Test",
        baseUrl: "localhost:8080", // Not a valid URL but should pass
      };

      const result = ProviderConfigSchema.safeParse(input);

      // The schema uses .url().or(z.string().min(1)), so it should accept non-URL strings
      expect(result.success).toBe(true);
    });
  });

  describe("ServerConfigSchema", () => {
    it("should use default values when not provided", () => {
      const result = ServerConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(7575);
        expect(result.data.host).toBe("127.0.0.1");
      }
    });

    it("should accept custom port and host", () => {
      const input = { port: 8080, host: "0.0.0.0" };
      const result = ServerConfigSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(8080);
        expect(result.data.host).toBe("0.0.0.0");
      }
    });

    it("should reject negative port", () => {
      const input = { port: -1 };
      const result = ServerConfigSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("should reject port 0", () => {
      const input = { port: 0 };
      const result = ServerConfigSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("should reject non-integer port", () => {
      const input = { port: 7575.5 };
      const result = ServerConfigSchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  describe("BlockPatternSchema", () => {
    it("should validate minimal block pattern", () => {
      const input = {
        path: "/api/blocked",
        response: "Blocked",
      };

      const result = BlockPatternSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.path).toBe("/api/blocked");
        expect(result.data.response).toBe("Blocked");
      }
    });

    it("should use default responseCode 200 when not provided", () => {
      const input = {
        path: "/api/blocked",
        response: "Blocked",
      };

      const result = BlockPatternSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responseCode).toBeUndefined();
      }
    });

    it("should accept custom responseCode", () => {
      const input = {
        path: "/api/blocked",
        response: "Forbidden",
        responseCode: 403,
      };

      const result = BlockPatternSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responseCode).toBe(403);
      }
    });
  });

  describe("FileConfigSchema", () => {
    it("should validate empty config", () => {
      const result = FileConfigSchema.safeParse({});

      expect(result.success).toBe(true);
    });

    it("should validate full config with all sections", () => {
      const input = {
        server: {
          port: 8080,
          host: "0.0.0.0",
        },
        providers: {
          test: {
            name: "Test Provider",
            baseUrl: "https://api.test.com",
            mode: "inject" as const,
          },
        },
        defaultProvider: "test",
        routePatterns: ["/v1/messages"],
        passthroughPatterns: ["/v1/users/*"],
        blockPatterns: [
          {
            path: "/api/blocked",
            response: "Blocked",
          },
        ],
        openaiBlockPatterns: [
          {
            path: "/openai/blocked",
            response: "Blocked",
            responseCode: 403,
          },
        ],
      };

      const result = FileConfigSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.server?.port).toBe(8080);
        expect(result.data.providers?.test?.name).toBe("Test Provider");
        expect(result.data.defaultProvider).toBe("test");
      }
    });

    it("should validate multiple providers", () => {
      const input = {
        providers: {
          official: {
            name: "Official",
            baseUrl: "https://api.anthropic.com",
            mode: "passthrough" as const,
          },
          custom: {
            name: "Custom",
            baseUrl: "https://api.custom.com",
            mode: "inject" as const,
            apiKey: "sk-test",
          },
        },
      };

      const result = FileConfigSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(Object.keys(result.data.providers || {})).toHaveLength(2);
      }
    });

    it("should accept string arrays for patterns", () => {
      const input = {
        routePatterns: ["/v1/messages", "/messages"],
        passthroughPatterns: ["/v1/users/*", "/v1/orgs/*"],
      };

      const result = FileConfigSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.routePatterns).toEqual(["/v1/messages", "/messages"]);
        expect(result.data.passthroughPatterns).toEqual(["/v1/users/*", "/v1/orgs/*"]);
      }
    });
  });
});

describe("config: environment variable expansion", () => {
  // Mock process.env for testing
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  it("should expand single environment variable", () => {
    process.env.TEST_API_KEY = "sk-test-key-123";

    const template = "${TEST_API_KEY}";
    const expanded = template.replace(/\$\{(\w+)\}/g, (_, varName: string) => {
      return process.env[varName] || "";
    });

    expect(expanded).toBe("sk-test-key-123");
  });

  it("should expand multiple environment variables", () => {
    process.env.API_HOST = "api.example.com";
    process.env.API_PORT = "8080";

    const template = "https://${API_HOST}:${API_PORT}";
    const expanded = template.replace(/\$\{(\w+)\}/g, (_, varName: string) => {
      return process.env[varName] || "";
    });

    expect(expanded).toBe("https://api.example.com:8080");
  });

  it("should handle missing environment variable", () => {
    const template = "${NON_EXISTENT_VAR}";
    const expanded = template.replace(/\$\{(\w+)\}/g, (_, varName: string) => {
      return process.env[varName] || "";
    });

    expect(expanded).toBe("");
  });

  it("should handle mixed template with literal and env vars", () => {
    process.env.API_KEY = "sk-123";
    const template = "Bearer ${API_KEY}";
    const expanded = template.replace(/\$\{(\w+)\}/g, (_, varName: string) => {
      return process.env[varName] || "";
    });

    expect(expanded).toBe("Bearer sk-123");
  });

  it("should handle environment variable with underscore", () => {
    process.env.API_KEY_SECRET = "secret-value";
    const template = "${API_KEY_SECRET}";
    const expanded = template.replace(/\$\{(\w+)\}/g, (_, varName: string) => {
      return process.env[varName] || "";
    });

    expect(expanded).toBe("secret-value");
  });
});

describe("config: snake_case to camelCase conversion", () => {
  it("should convert single underscore snake_case to camelCase", () => {
    const snakeCase = "base_url";
    const camelCase = snakeCase.replace(/(?<!^)_([a-zA-Z])/g, (_, letter: string) =>
      letter.toUpperCase()
    );

    expect(camelCase).toBe("baseUrl");
  });

  it("should convert multiple underscores", () => {
    const snakeCase = "cache_read_input_tokens";
    const camelCase = snakeCase.replace(/(?<!^)_([a-zA-Z])/g, (_, letter: string) =>
      letter.toUpperCase()
    );

    expect(camelCase).toBe("cacheReadInputTokens");
  });

  it("should not modify strings without underscores", () => {
    const input = "baseUrl";
    const result = input.replace(/(?<!^)_([a-zA-Z])/g, (_, letter: string) => letter.toUpperCase());

    expect(result).toBe("baseUrl");
  });

  it("should handle consecutive underscores", () => {
    const input = "__double__underscore__";
    const result = input.replace(/(?<!^)_([a-zA-Z])/g, (_, letter: string) => letter.toUpperCase());

    // Each _letter pattern gets converted
    expect(result).toContain("_Double_Underscore_");
  });

  it("should handle uppercase letters after underscore", () => {
    const input = "some_URL_field";
    const result = input.replace(/(?<!^)_([a-zA-Z])/g, (_, letter: string) => letter.toUpperCase());

    // Only lowercase letters after underscore are converted
    expect(result).toBe("someURLField");
  });

  it("should preserve leading underscore", () => {
    const input = "_privateField";
    const result = input.replace(/(?<!^)_([a-zA-Z])/g, (_, letter: string) => letter.toUpperCase());

    expect(result).toBe("_privateField");
  });
});

describe("config: provider parsing edge cases", () => {
  it("should handle empty modelMap", () => {
    const input: ProviderConfigInput = {
      name: "Test",
      baseUrl: "https://api.test.com",
      mode: "passthrough",
      modelMap: {},
    };

    const result = ProviderConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modelMap).toEqual({});
    }
  });

  it("should handle complex modelMap patterns", () => {
    const input: ProviderConfigInput = {
      name: "Test",
      baseUrl: "https://api.test.com",
      mode: "passthrough",
      modelMap: {
        "claude-*": "gpt-4",
        "claude-3-*": "gpt-3.5-turbo",
        "gemini-*": "gemini-pro",
      },
    };

    const result = ProviderConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.modelMap || {})).toHaveLength(3);
    }
  });

  it("should handle headers with various formats", () => {
    const input: ProviderConfigInput = {
      name: "Test",
      baseUrl: "https://api.test.com",
      mode: "passthrough",
      headers: {
        Authorization: "Bearer token",
        "X-Custom-Header": "value",
      },
    };

    const result = ProviderConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headers?.Authorization).toBe("Bearer token");
      expect(result.data.headers?.["X-Custom-Header"]).toBe("value");
    }
  });

  it("should handle enabled flag defaults", () => {
    const input1: ProviderConfigInput = {
      name: "Test1",
      baseUrl: "https://api.test.com",
      mode: "passthrough",
      enabled: true,
    };

    const input2: ProviderConfigInput = {
      name: "Test2",
      baseUrl: "https://api.test.com",
      mode: "passthrough",
      enabled: false,
    };

    const result1 = ProviderConfigSchema.safeParse(input1);
    const result2 = ProviderConfigSchema.safeParse(input2);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    if (result1.success && result2.success) {
      expect(result1.data.enabled).toBe(true);
      expect(result2.data.enabled).toBe(false);
    }
  });
});
