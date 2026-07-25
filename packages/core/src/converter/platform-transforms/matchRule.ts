/**
 * Resolve a platform transform rule from upstream hostname and/or provider openaiCompat.
 */

import type { OpenAICompat } from "../../types";
import { normalizedHostnameFromBaseUrl } from "./hostname";
import { ruleHostnameMatches } from "./ruleHostname";
import { PLATFORM_TRANSFORM_RULES, type HostedToolRule } from "./rules";

export interface PlatformMatchOptions {
  /** When `azure_openai`, apply Azure Chat rules even if hostname is a custom router. */
  openaiCompat?: OpenAICompat;
}

function azureOpenAiRule(): HostedToolRule | undefined {
  return PLATFORM_TRANSFORM_RULES.find(r => r.provider === "azure-openai");
}

/**
 * First matching hostname rule wins. If none match and `openaiCompat` is `azure_openai`,
 * return the Azure OpenAI platform rule (custom domains / Azure-compatible routers).
 */
export function matchHostedToolRuleForBaseUrl(
  baseUrl: string,
  options?: PlatformMatchOptions
): HostedToolRule | undefined {
  const hostname = normalizedHostnameFromBaseUrl(baseUrl);
  if (hostname) {
    for (const rule of PLATFORM_TRANSFORM_RULES) {
      if (ruleHostnameMatches(hostname, rule)) {
        return rule;
      }
    }
  }
  if (options?.openaiCompat === "azure_openai") {
    return azureOpenAiRule();
  }
  return undefined;
}
