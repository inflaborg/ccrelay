/**
 * Layer 1: declarative hostname → platform message transforms.
 * Provider-specific logic lives under `glm/`; bind transform ids in `transforms.ts`.
 */

export interface PlatformMessageRule {
  /** Human-readable upstream family label (logging / maintenance only). */
  provider: string;
  /** Allowed upstream hostnames (case-insensitive exact match). */
  domains: readonly string[];
  /** Registry key from `transforms.ts`. */
  transform: string;
}

export const PLATFORM_MESSAGE_RULES: readonly PlatformMessageRule[] = [
  {
    provider: "glm",
    /** GLM / Zhipu OpenAI-compat — exact upstream hosts only. */
    domains: ["api.z.ai", "open.bigmodel.cn"],
    transform: "glm-flatten-content",
  },
];
