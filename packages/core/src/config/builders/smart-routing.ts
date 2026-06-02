import type {
  SmartRoutingConfig,
  SmartRoutingConfigInput,
  SmartRoutingModelRule,
} from "../../types";

function buildModelRules(
  rules: SmartRoutingConfigInput["modelRules"]
): SmartRoutingModelRule[] | undefined {
  if (!rules?.length) {
    return undefined;
  }
  return rules.map(r => ({
    pattern: r.pattern,
    provider: r.provider,
    model: r.model,
    ...(r.enabled === false ? { enabled: false } : {}),
  }));
}

export function buildSmartRoutingConfig(
  raw: SmartRoutingConfigInput | undefined
): SmartRoutingConfig {
  const parsed = raw ?? {};
  const modelRules = buildModelRules(parsed.modelRules);
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
    ...(modelRules?.length ? { modelRules } : {}),
  };
}
