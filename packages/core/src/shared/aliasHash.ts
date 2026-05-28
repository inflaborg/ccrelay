import { sha1Hex } from "./sha1";

export type AliasHashProtocol = "anthropic" | "openai" | "openai_chat";

/** sha1(providerId:protocol:upstreamModelId).slice(0,8) with configurable prefix. */
export function computeCanonicalAliasHash(
  providerId: string,
  protocol: AliasHashProtocol,
  upstreamModelId: string,
  aliasPrefix = "claude-"
): string {
  const digest = sha1Hex(`${providerId}:${protocol}:${upstreamModelId}`).slice(0, 8);
  return `${aliasPrefix}${digest}`;
}

export function buildPublicModelId(providerId: string, upstreamModelId: string): string {
  return `${providerId}:${upstreamModelId}`;
}

/** True when model looks like a canonical claude-* alias wire id (8 hex suffix). */
export function looksLikeAliasWireId(model: string, aliasPrefix = "claude-"): boolean {
  const p = aliasPrefix.trim();
  if (!p || !model.startsWith(p)) {
    return false;
  }
  const rest = model.slice(p.length);
  return /^[0-9a-f]{8}$/i.test(rest);
}

/** Legacy FNV / short hex alias patterns (6–8 hex) under aliasPrefix. */
export function looksLikeLegacyAliasPattern(pattern: string, aliasPrefix = "claude-"): boolean {
  const p = aliasPrefix.trim();
  if (!p || !pattern.startsWith(p)) {
    return false;
  }
  const rest = pattern.slice(p.length);
  return /^[0-9a-f]{6,8}$/i.test(rest);
}
