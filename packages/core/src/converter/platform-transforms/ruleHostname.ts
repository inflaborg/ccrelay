import type { PlatformTransformRule } from "./rules";
import { hostnameMatchesDomain, hostnameMatchesDomainOrSubdomain } from "./hostname";

/** True if `hostname` matches this rule’s `domains` and/or `domainParents`. */
export function ruleHostnameMatches(hostname: string, rule: PlatformTransformRule): boolean {
  for (const host of rule.domains ?? []) {
    if (hostnameMatchesDomain(hostname, host)) {
      return true;
    }
  }
  for (const parent of rule.domainParents ?? []) {
    if (hostnameMatchesDomainOrSubdomain(hostname, parent)) {
      return true;
    }
  }
  return false;
}
