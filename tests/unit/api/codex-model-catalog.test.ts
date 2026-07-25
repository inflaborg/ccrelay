import { describe, it, expect } from "vitest";
import type { Provider } from "@/types";
import {
  buildCodexModelCatalogJson,
  collectCodexModelsFromProvider,
  ensureCodexModelCatalogJsonField,
  isCcrelayCatalogPointer,
  isCodexPointingAtCcrelay,
  removeOwnedCodexModelCatalogJsonField,
  CCRELAY_CODEX_MODEL_CATALOG_FILENAME,
} from "@/api/codexModelCatalog";

function provider(partial: Partial<Provider> & Pick<Provider, "id" | "name">): Provider {
  return {
    baseUrl: "https://example.com",
    mode: "passthrough",
    providerType: "openai",
    ...partial,
  };
}

describe("collectCodexModelsFromProvider", () => {
  it("uses customModelsList id and displayName", () => {
    const models = collectCodexModelsFromProvider(
      provider({
        id: "ds",
        name: "DeepSeek",
        customModelsList: [
          "deepseek-v4-pro;DeepSeek V4 Pro",
          "deepseek-v4-flash;DeepSeek V4 Flash",
          "deepseek-v4-pro;dup ignored",
          "",
        ],
      })
    );
    expect(models).toEqual([
      { slug: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
      { slug: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash" },
    ]);
  });

  it("falls back to exact modelMap patterns when no customModelsList", () => {
    const models = collectCodexModelsFromProvider(
      provider({
        id: "x",
        name: "X",
        modelMap: [
          { pattern: "my-exact-model", model: "upstream" },
          { pattern: "claude-*", model: "upstream" },
        ],
      })
    );
    expect(models).toEqual([{ slug: "my-exact-model", displayName: "my-exact-model" }]);
  });

  it("always includes fallbackModel", () => {
    const models = collectCodexModelsFromProvider(
      provider({ id: "x", name: "X", customModelsList: ["a"] }),
      "fallback-id"
    );
    expect(models.map(m => m.slug)).toEqual(["a", "fallback-id"]);
  });
});

describe("buildCodexModelCatalogJson", () => {
  it("emits required Codex catalog fields", () => {
    const catalog = buildCodexModelCatalogJson([
      { slug: "m1", displayName: "Model One" },
      { slug: "m2", displayName: "Model Two" },
    ]);
    expect(catalog.models).toHaveLength(2);
    const entry = catalog.models[0] as Record<string, unknown>;
    expect(entry.slug).toBe("m1");
    expect(entry.display_name).toBe("Model One");
    expect(entry.visibility).toBe("list");
    expect(entry.shell_type).toBe("shell_command");
    expect(typeof entry.base_instructions).toBe("string");
    expect(Array.isArray(entry.supported_reasoning_levels)).toBe(true);
    expect(entry.input_modalities).toEqual(["text"]);
    expect(entry.truncation_policy).toEqual({ mode: "tokens", limit: 10000 });
  });
});

describe("codex catalog TOML helpers", () => {
  it("detects ccrelay pointer and provider", () => {
    expect(isCcrelayCatalogPointer(CCRELAY_CODEX_MODEL_CATALOG_FILENAME)).toBe(true);
    expect(isCcrelayCatalogPointer("/tmp/.codex/ccrelay-model-catalog.json")).toBe(true);
    expect(isCcrelayCatalogPointer("other.json")).toBe(false);
    expect(isCodexPointingAtCcrelay(`model_provider = "ccrelay"\nmodel = "x"\n`)).toBe(true);
    expect(isCodexPointingAtCcrelay(`model_provider = "openai"\n`)).toBe(false);
  });

  it("ensures model_catalog_json field", () => {
    const input = `model = "m"
model_provider = "ccrelay"

[model_providers.ccrelay]
name = "CCRelay"
`;
    const out = ensureCodexModelCatalogJsonField(input);
    expect(out).toContain(`model_catalog_json = "${CCRELAY_CODEX_MODEL_CATALOG_FILENAME}"`);
    expect(out.indexOf("model_catalog_json")).toBeGreaterThan(out.indexOf("model_provider"));
  });

  it("removes only CCRelay-owned model_catalog_json", () => {
    const owned = `model_catalog_json = "ccrelay-model-catalog.json"\nmodel = "x"\n`;
    expect(removeOwnedCodexModelCatalogJsonField(owned)).toBe(`model = "x"\n`);

    const other = `model_catalog_json = "my-custom.json"\nmodel = "x"\n`;
    expect(removeOwnedCodexModelCatalogJsonField(other)).toBe(other);
  });
});
