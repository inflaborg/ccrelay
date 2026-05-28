import { describe, it, expect } from "vitest";
import {
  isLocalProxyAnthropicBase,
  isLocalProxyCodexBase,
  parseTomlLite,
  expectedClaudeDesktopCustomHeaders,
  hasExpectedClaudeDesktopCustomHeaders,
  isCoworkEgressAllowed,
  getClaudeCodeEnvGaps,
  getClaudeDesktopConfigGaps,
  buildClaudeCodeFields,
  buildClaudeDesktopFields,
  buildCodexFields,
} from "@/api/clientConfig";
import { CCRELAY_MODEL_ALIAS_HEADER } from "@/converter/models-fallback";

describe("clientConfig URL helpers", () => {
  it("isLocalProxyAnthropicBase requires localhost/127.0.0.1, port, and /anthropic path", () => {
    expect(isLocalProxyAnthropicBase("http://127.0.0.1:7575/anthropic", 7575)).toBe(true);
    expect(isLocalProxyAnthropicBase("http://localhost:7575/anthropic/", 7575)).toBe(true);
    expect(isLocalProxyAnthropicBase("http://127.0.0.1:7575", 7575)).toBe(false);
    expect(isLocalProxyAnthropicBase("http://127.0.0.1:9999", 7575)).toBe(false);
  });

  it("isLocalProxyCodexBase requires /openai path", () => {
    expect(isLocalProxyCodexBase("http://127.0.0.1:7575/openai", 7575)).toBe(true);
    expect(isLocalProxyCodexBase("http://localhost:7575/openai/", 7575)).toBe(true);
    expect(isLocalProxyCodexBase("http://127.0.0.1:7575/v1", 7575)).toBe(false);
    expect(isLocalProxyCodexBase("http://127.0.0.1:7575", 7575)).toBe(false);
  });
});

describe("parseTomlLite", () => {
  it("reads model_provider and [model_providers.ccrelay]", () => {
    const raw = `model = "m"
model_provider = "ccrelay"
[model_providers.ccrelay]
base_url = "http://127.0.0.1:7575/openai"
`;
    const t = parseTomlLite(raw);
    expect(t.top.model_provider).toBe("ccrelay");
    expect(t.sections["model_providers.ccrelay"]?.base_url).toBe("http://127.0.0.1:7575/openai");
  });
});

describe("Claude Desktop custom headers", () => {
  it("expectedClaudeDesktopCustomHeaders includes x-ccrelay-model-alias", () => {
    expect(expectedClaudeDesktopCustomHeaders()).toEqual({
      [CCRELAY_MODEL_ALIAS_HEADER]: "1",
    });
  });

  it("hasExpectedClaudeDesktopCustomHeaders requires non-empty alias header", () => {
    expect(hasExpectedClaudeDesktopCustomHeaders(undefined)).toBe(false);
    expect(hasExpectedClaudeDesktopCustomHeaders({})).toBe(false);
    expect(hasExpectedClaudeDesktopCustomHeaders({ [CCRELAY_MODEL_ALIAS_HEADER]: "" })).toBe(false);
    expect(hasExpectedClaudeDesktopCustomHeaders({ [CCRELAY_MODEL_ALIAS_HEADER]: "1" })).toBe(true);
  });

  it("hasExpectedClaudeDesktopCustomHeaders is case-insensitive on header key", () => {
    expect(hasExpectedClaudeDesktopCustomHeaders({ "X-CCRelay-Model-Alias": "1" })).toBe(true); // eslint-disable-line @typescript-eslint/naming-convention -- HTTP header wire name
    expect(hasExpectedClaudeDesktopCustomHeaders({ "X-CCRELAY-MODEL-ALIAS": "yes" })).toBe(true); // eslint-disable-line @typescript-eslint/naming-convention -- HTTP header wire name
  });

  it("getClaudeDesktopConfigGaps reports missing inferenceCustomHeaders", () => {
    const gaps = getClaudeDesktopConfigGaps(
      {
        inferenceGatewayBaseUrl: "http://127.0.0.1:7575/anthropic",
        inferenceProvider: "gateway",
        inferenceGatewayApiKey: "1",
        coworkEgressAllowedHosts: ["*"],
        disableEssentialTelemetry: true,
        disableNonessentialTelemetry: true,
      },
      7575,
      "3p"
    );
    expect(gaps.gaps).toContain("inferenceCustomHeaders");
    expect(gaps.baseOk).toBe(true);
  });

  it("getClaudeDesktopConfigGaps passes when template fields are complete", () => {
    const gaps = getClaudeDesktopConfigGaps(
      {
        inferenceGatewayBaseUrl: "http://127.0.0.1:7575/anthropic",
        inferenceProvider: "gateway",
        inferenceGatewayApiKey: "1",
        coworkEgressAllowedHosts: ["*"],
        inferenceCustomHeaders: { [CCRELAY_MODEL_ALIAS_HEADER]: "1" },
        disableEssentialTelemetry: true,
        disableNonessentialTelemetry: true,
      },
      7575,
      "3p"
    );
    expect(gaps.gaps).toEqual([]);
  });
});

describe("coworkEgressAllowedHosts", () => {
  it("isCoworkEgressAllowed requires non-empty array including *", () => {
    expect(isCoworkEgressAllowed(["*"])).toBe(true);
    expect(isCoworkEgressAllowed(["example.com", "*"])).toBe(true);
    expect(isCoworkEgressAllowed([])).toBe(false);
    expect(isCoworkEgressAllowed(["example.com"])).toBe(false);
    expect(isCoworkEgressAllowed(undefined)).toBe(false);
  });
});

describe("Claude Code env gaps", () => {
  const port = 7575;

  /* eslint-disable @typescript-eslint/naming-convention -- Claude Code settings.json env keys */
  it("getClaudeCodeEnvGaps requires semantic env rules when only base URL is set", () => {
    expect(
      getClaudeCodeEnvGaps(
        {
          ANTHROPIC_BASE_URL: "http://127.0.0.1:7575/anthropic",
        },
        port
      )
    ).toEqual([
      "ANTHROPIC_AUTH_TOKEN",
      "API_TIMEOUT_MS",
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    ]);
  });

  it("buildClaudeCodeFields accepts localhost base URL", () => {
    const fields = buildClaudeCodeFields(
      {
        ANTHROPIC_BASE_URL: "http://localhost:7575/anthropic",
      },
      port
    );
    const base = fields.find(f => f.key === "ANTHROPIC_BASE_URL");
    expect(base?.ok).toBe(true);
  });

  it("buildClaudeCodeFields accepts any non-empty auth token", () => {
    const fields = buildClaudeCodeFields(
      {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:7575/anthropic",
        ANTHROPIC_AUTH_TOKEN: "my-token",
        API_TIMEOUT_MS: "600000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: true,
      },
      port
    );
    expect(fields.every(f => f.ok)).toBe(true);
    expect(fields.find(f => f.key === "ANTHROPIC_AUTH_TOKEN")?.expected).toBe("(non-empty)");
  });

  it("buildClaudeCodeFields rejects invalid API_TIMEOUT_MS", () => {
    const fields = buildClaudeCodeFields(
      {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:7575/anthropic",
        ANTHROPIC_AUTH_TOKEN: "t",
        API_TIMEOUT_MS: "0",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
      },
      port
    );
    expect(fields.find(f => f.key === "API_TIMEOUT_MS")?.ok).toBe(false);
  });

  it("buildClaudeCodeFields gaps align with fields filter", () => {
    const env = {
      ANTHROPIC_BASE_URL: "http://127.0.0.1:7575/anthropic",
      ANTHROPIC_AUTH_TOKEN: "t",
    };
    const fields = buildClaudeCodeFields(env, port);
    const gapKeys = fields.filter(f => !f.ok).map(f => f.key);
    expect(getClaudeCodeEnvGaps(env, port)).toEqual(gapKeys);
  });
  /* eslint-enable @typescript-eslint/naming-convention */
});

describe("Claude Desktop fields", () => {
  const fullTemplate = {
    inferenceGatewayBaseUrl: "http://127.0.0.1:7575/anthropic",
    inferenceProvider: "gateway",
    inferenceGatewayApiKey: "1",
    coworkEgressAllowedHosts: ["*"],
    inferenceCustomHeaders: { [CCRELAY_MODEL_ALIAS_HEADER]: "1" },
    disableEssentialTelemetry: true,
    disableNonessentialTelemetry: true,
  };

  it("buildClaudeDesktopFields marks all fields ok for full template with deploymentMode 3p", () => {
    const fields = buildClaudeDesktopFields(fullTemplate, 7575, "3p");
    expect(fields.every(f => f.ok)).toBe(true);
    expect(fields.map(f => f.key)).toContain("deploymentMode");
  });

  it("buildClaudeDesktopFields uses rule hints for custom headers and egress", () => {
    const fields = buildClaudeDesktopFields(fullTemplate, 7575, "3p");
    expect(fields.find(f => f.key === "inferenceCustomHeaders")?.expected).toBe(
      "x-ccrelay-model-alias: (non-empty, key case-insensitive)"
    );
    expect(fields.find(f => f.key === "coworkEgressAllowedHosts")?.expected).toBe(
      '(non-empty array including "*")'
    );
  });

  it("buildClaudeDesktopFields reports inferenceCustomHeaders gap when empty", () => {
    const fields = buildClaudeDesktopFields(
      { ...fullTemplate, inferenceCustomHeaders: {} },
      7575,
      "3p"
    );
    const gapKeys = fields.filter(f => !f.ok).map(f => f.key);
    expect(gapKeys).toEqual(["inferenceCustomHeaders"]);
    expect(
      getClaudeDesktopConfigGaps({ ...fullTemplate, inferenceCustomHeaders: {} }, 7575, "3p").gaps
    ).toEqual(gapKeys);
  });

  it("buildClaudeDesktopFields accepts egress array with * among other hosts", () => {
    const fields = buildClaudeDesktopFields(
      { ...fullTemplate, coworkEgressAllowedHosts: ["example.com", "*"] },
      7575,
      "3p"
    );
    expect(fields.find(f => f.key === "coworkEgressAllowedHosts")?.ok).toBe(true);
  });
});

describe("Codex fields", () => {
  it("buildCodexFields reports model gap when provider is set but model is empty", () => {
    const toml = parseTomlLite(`model_provider = "ccrelay"
[model_providers.ccrelay]
base_url = "http://127.0.0.1:7575/openai"
`);
    const fields = buildCodexFields(toml, 7575);
    expect(fields.map(f => f.key)).toEqual([
      "model_provider",
      "model_providers.ccrelay.base_url",
      "model",
    ]);
    const gapKeys = fields.filter(f => !f.ok).map(f => f.key);
    expect(gapKeys).toEqual(["model"]);
  });
});
