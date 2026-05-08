/**
 * Layer 3: generic dispatch — hostname match → transform by tool type → registry.
 */

import { HOSTED_TOOL_RULES } from "./rules";
import type { HostedToolRule } from "./rules";
import { TRANSFORM_REGISTRY, passthroughTransform } from "./transforms";

export type { HostedToolRule } from "./rules";
export type { HostedToolTransform } from "./transforms";
export {
  passthroughTransform,
  glmWebSearchEnvelopeTransform,
  mimoWebSearchTransform,
  TRANSFORM_REGISTRY,
} from "./transforms";

/** True if `hostname` equals `expectedHost` (case-insensitive). Rules use fixed upstream hosts only. */
export function hostnameMatchesDomain(hostname: string, expectedHost: string): boolean {
  return hostname.toLowerCase() === expectedHost.toLowerCase();
}

/** Extract lowercase hostname from `baseUrl`; tolerate missing scheme. */
export function normalizedHostnameFromBaseUrl(baseUrl: string): string | undefined {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return undefined;
  }
  const withScheme = /^[a-zA-Z][a-zA-Z+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** First matching provider rule wins (preserve `HOSTED_TOOL_RULES` order). */
export function matchHostedToolRuleForBaseUrl(baseUrl: string): HostedToolRule | undefined {
  const hostname = normalizedHostnameFromBaseUrl(baseUrl);
  if (!hostname) {
    return undefined;
  }
  for (const rule of HOSTED_TOOL_RULES) {
    for (const host of rule.domains) {
      if (hostnameMatchesDomain(hostname, host)) {
        return rule;
      }
    }
  }
  return undefined;
}

/**
 * Normalize one hosted Chat `tools[]` entry for `baseUrl`'s upstream.
 * Unknown upstreams use `passthrough` transform.
 */
export function normalizeToolForProvider(
  tool: Record<string, unknown>,
  baseUrl: string
): Record<string, unknown> {
  const toolType = typeof tool.type === "string" ? tool.type : "";
  const rule = matchHostedToolRuleForBaseUrl(baseUrl);
  const transformName = rule?.tools[toolType] ?? "passthrough";
  const transform = TRANSFORM_REGISTRY[transformName] ?? passthroughTransform;
  return transform(tool);
}
