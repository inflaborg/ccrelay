/**
 * Layer 1: declarative hostname → hosted-tool transforms.
 * Provider-specific logic lives under `glm/` and `xiaomimimo/`; attach tool types to transform ids in `transforms.ts`.
 */
/* eslint-disable @typescript-eslint/naming-convention -- tool.type wire literals */

export interface HostedToolRule {
  /** Human-readable upstream family label (logging / maintenance only). */
  provider: string;
  /** Allowed upstream hostnames for this provider (case-insensitive exact match). */
  domains: readonly string[];
  /** Chat `tools[].type` → transform registry key (`transforms.ts`). */
  tools: Readonly<Record<string, string>>;
}

export const HOSTED_TOOL_RULES: readonly HostedToolRule[] = [
  {
    provider: "glm",
    /** GLM / Zhipu OpenAI-compat — exact upstream hosts only. */
    domains: ["api.z.ai", "open.bigmodel.cn"],
    tools: {
      web_search: "glm-web-search-envelope",
    },
  },
  {
    provider: "xiaomimimo",
    /** MiMo: `api.xiaomimimo.com` only (token-plan host has no web_search). */
    domains: ["api.xiaomimimo.com"],
    tools: {
      web_search: "mimo-web-search",
    },
  },
];
