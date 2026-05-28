import type { SmartRoutingConfig, SmartRoutingConfigInput } from "../../types";

export function buildSmartRoutingConfig(
  raw: SmartRoutingConfigInput | undefined
): SmartRoutingConfig {
  const parsed = raw ?? {};
  return {
    enabled: parsed.enabled ?? false,
    modelsCache: {
      ttlSeconds: parsed.modelsCache?.ttlSeconds ?? 600,
      refreshOnStart: parsed.modelsCache?.refreshOnStart ?? true,
      onUpstreamFail: parsed.modelsCache?.onUpstreamFail ?? "stale",
    },
    aliasPrefix: parsed.aliasPrefix ?? "claude-",
    ...(parsed.exclude?.length ? { exclude: [...parsed.exclude] } : {}),
    ...(parsed.include?.length ? { include: [...parsed.include] } : {}),
    bareModelFallback: {
      mode: parsed.bareModelFallback?.mode ?? "first-match",
    },
  };
}
