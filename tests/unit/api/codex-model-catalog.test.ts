import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect } from "vitest";
import type { Provider } from "@/types";
import {
  buildCodexModelCatalogJson,
  codexModelCatalogPath,
  collectCodexModelsFromProvider,
  collectCodexModelsFromSmartRouting,
  ensureCodexModelCatalogJsonField,
  isCcrelayCatalogPointer,
  isCodexPointingAtCcrelay,
  readCodexCatalogPrimaryModel,
  removeOwnedCodexModelCatalogJsonField,
  writeCodexModelCatalog,
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
      { slug: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", protocol: "openai" },
      { slug: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash", protocol: "openai" },
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
    expect(models).toEqual([
      { slug: "my-exact-model", displayName: "my-exact-model", protocol: "openai" },
    ]);
  });

  it("always includes fallbackModel", () => {
    const models = collectCodexModelsFromProvider(
      provider({ id: "x", name: "X", customModelsList: ["a"] }),
      "fallback-id"
    );
    expect(models.map(m => m.slug)).toEqual(["a", "fallback-id"]);
  });
});

describe("collectCodexModelsFromSmartRouting", () => {
  it("lists every routed model by provider, not a single provider list", () => {
    const models = collectCodexModelsFromSmartRouting(
      [
        {
          publicId: "llm-router-dev:gpt-6-astra",
          aliasHash: "claude-9932558f",
          providerId: "llm-router-dev",
          providerDisplayName: "llm-router-dev",
          protocol: "openai",
          upstreamModelId: "gpt-6-astra",
          displayName: "gpt-6-astra",
          source: "custom",
          fetchedAt: 0,
        },
        {
          publicId: "llm-router-su-gpt:gpt-6-sol",
          aliasHash: "claude-af9440a3",
          providerId: "llm-router-su-gpt",
          protocol: "openai",
          upstreamModelId: "gpt-6-sol",
          source: "custom",
          fetchedAt: 0,
        },
      ],
      "gpt-6-sol"
    );
    expect(models.map(m => m.slug)).toEqual([
      "llm-router-dev:gpt-6-astra",
      "llm-router-su-gpt:gpt-6-sol",
      "gpt-6-sol",
    ]);
    expect(models[0]?.displayName).toBe("llm-router-dev · gpt-6-astra");
  });

  it("uses the model display name when the provider prefix is off", () => {
    const models = collectCodexModelsFromSmartRouting(
      [
        {
          publicId: "llm-router-dev:gpt-6-astra",
          aliasHash: "claude-9932558f",
          providerId: "llm-router-dev",
          providerDisplayName: "Dev Router",
          protocol: "openai",
          upstreamModelId: "gpt-6-astra",
          displayName: "gpt-6-astra",
          source: "custom",
          fetchedAt: 0,
        },
      ],
      undefined,
      { includeProviderPrefix: false }
    );
    expect(models[0]?.displayName).toBe("gpt-6-astra");
  });
});

describe("buildCodexModelCatalogJson", () => {
  it("emits required Codex catalog fields", () => {
    const catalog = buildCodexModelCatalogJson([
      { slug: "m1", displayName: "Model One" },
      { slug: "m2", displayName: "Model Two" },
    ]);
    expect(catalog.catalog_schema_version).toBe(4);
    const entry = catalog.models[0] as Record<string, unknown>;
    expect(entry.slug).toBe("m1");
    expect(entry.display_name).toBe("Model One");
    expect(entry.visibility).toBe("list");
    expect(entry.shell_type).toBe("shell_command");
    expect(typeof entry.base_instructions).toBe("string");
    expect(entry.default_reasoning_level).toBe("high");
    expect(entry.supported_reasoning_levels).toEqual([
      { effort: "low", description: "Fast responses with lighter reasoning" },
      {
        effort: "medium",
        description: "Balances speed and reasoning depth for everyday tasks",
      },
      { effort: "high", description: "Greater reasoning depth for complex problems" },
      { effort: "xhigh", description: "Extra high reasoning depth for complex problems" },
    ]);
    const gpt6 = buildCodexModelCatalogJson([
      { slug: "gpt-6-astra", displayName: "gpt-6-astra" },
      { slug: "llm-router:gpt-5.6-sol", displayName: "gpt-5.6-sol" },
      { slug: "gpt-5.4", displayName: "gpt-5.4" },
    ]);
    const levels = (slug: string) => {
      const model = gpt6.models.find(m => (m as { slug: string }).slug === slug) as Record<
        string,
        unknown
      >;
      const supported = model["supported_reasoning_levels"] as { effort: string }[];
      return supported.map(level => level.effort);
    };
    expect(levels("gpt-6-astra")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(levels("llm-router:gpt-5.6-sol")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(levels("gpt-5.4")).toEqual(["low", "medium", "high", "xhigh"]);

    expect(entry.supports_reasoning_summaries).toBe(true);
    expect(entry.default_reasoning_summary).toBe("none");
    expect(entry.input_modalities).toEqual(["text", "image"]);
    expect(catalog.vision_all).toBe(true);

    const selected = buildCodexModelCatalogJson(
      [
        { slug: "m1", displayName: "Model One" },
        { slug: "m2", displayName: "Model Two" },
      ],
      { all: false, modelIds: ["m2"] }
    );
    expect((selected.models[0] as Record<string, unknown>).input_modalities).toEqual(["text"]);
    expect((selected.models[1] as Record<string, unknown>).input_modalities).toEqual([
      "text",
      "image",
    ]);
    const excluded = buildCodexModelCatalogJson(
      [
        { slug: "a", displayName: "A", protocol: "anthropic" },
        { slug: "b", displayName: "B", protocol: "openai" },
        { slug: "c", displayName: "C", protocol: "openai_chat" },
      ],
      undefined,
      { protocols: ["anthropic", "openai_chat"], modelIds: ["b"] }
    );
    expect(excluded.models).toEqual([]);
    expect(excluded.exclude_protocols).toEqual(["anthropic", "openai_chat"]);
    expect(entry.truncation_policy).toEqual({ mode: "tokens", limit: 10000 });
  });

  it("lists the pinned model first and keeps the rest in order", () => {
    const models = [
      { slug: "glm:glm-5.3", displayName: "GLM 5.3" },
      { slug: "dev:gpt-5.6-terra", displayName: "Terra" },
      { slug: "dev:gpt-6-luna", displayName: "Luna" },
    ];
    const catalog = buildCodexModelCatalogJson(models, undefined, undefined, "dev:gpt-6-luna");
    const entries = catalog.models as Array<Record<string, unknown>>;
    expect(entries.map(e => e.slug)).toEqual([
      "dev:gpt-6-luna",
      "glm:glm-5.3",
      "dev:gpt-5.6-terra",
    ]);
    expect(entries.map(e => e.priority)).toEqual([1000, 1001, 1002]);
    expect(catalog.primary_model_id).toBe("dev:gpt-6-luna");
  });

  it("keeps the default order when the pinned model is missing or excluded", () => {
    const models = [
      { slug: "a", displayName: "A" },
      { slug: "b", displayName: "B" },
    ];
    const missing = buildCodexModelCatalogJson(models, undefined, undefined, "zzz");
    expect((missing.models as Array<Record<string, unknown>>).map(e => e.slug)).toEqual(["a", "b"]);
    const excluded = buildCodexModelCatalogJson(
      models,
      undefined,
      { protocols: [], modelIds: ["b"] },
      "b"
    );
    expect((excluded.models as Array<Record<string, unknown>>).map(e => e.slug)).toEqual(["a"]);
    expect(buildCodexModelCatalogJson(models).primary_model_id).toBeUndefined();
  });
});

describe("writeCodexModelCatalog primary model", () => {
  it("keeps the stored pinned model on rewrites until it is cleared", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccrelay-codex-"));
    try {
      const models = [
        { slug: "a", displayName: "A" },
        { slug: "b", displayName: "B" },
      ];
      writeCodexModelCatalog(models, dir, undefined, undefined, "b");
      expect(readCodexCatalogPrimaryModel(dir)).toBe("b");

      writeCodexModelCatalog(models, dir);
      const file = JSON.parse(fs.readFileSync(codexModelCatalogPath(dir), "utf-8")) as {
        models: Array<{ slug: string }>;
      };
      expect(file.models.map(m => m.slug)).toEqual(["b", "a"]);

      writeCodexModelCatalog(models, dir, undefined, undefined, "");
      expect(readCodexCatalogPrimaryModel(dir)).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
