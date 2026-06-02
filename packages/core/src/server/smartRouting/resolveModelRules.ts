import type { Provider, SmartRoutingModelRule } from "../../types";
import { matchModel } from "../request/modelMapping";

export interface SmartRoutingModelRuleMatch {
  providerId: string;
  upstreamModelId: string;
}

/**
 * Match client model against smartRouting.modelRules (first match wins).
 * Returns null when no rule matches or target provider is missing/disabled.
 */
export function matchSmartRoutingModelRules(
  model: string,
  rules: SmartRoutingModelRule[] | undefined,
  getProvider: (providerId: string) => Provider | undefined
): SmartRoutingModelRuleMatch | null {
  if (!rules?.length) {
    return null;
  }
  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  for (const rule of rules) {
    if (rule.enabled === false) {
      continue;
    }
    const hit = matchModel(trimmed, [{ pattern: rule.pattern, model: rule.model }]);
    if (!hit) {
      continue;
    }
    const provider = getProvider(rule.provider);
    if (!provider || provider.enabled === false) {
      continue;
    }
    return { providerId: rule.provider, upstreamModelId: rule.model };
  }

  return null;
}
