import * as crypto from "crypto";
import type { ProviderType } from "../../types";

/** sha1(providerId:protocol:upstreamModelId).slice(0,8) with configurable prefix. */
export function computeCanonicalAliasHash(
  providerId: string,
  protocol: ProviderType,
  upstreamModelId: string,
  aliasPrefix = "claude-"
): string {
  const digest = crypto
    .createHash("sha1")
    .update(`${providerId}:${protocol}:${upstreamModelId}`, "utf8")
    .digest("hex")
    .slice(0, 8);
  return `${aliasPrefix}${digest}`;
}

export function buildPublicModelId(providerId: string, upstreamModelId: string): string {
  return `${providerId}:${upstreamModelId}`;
}

/** True when model looks like a canonical or legacy claude-* alias wire id. */
export function looksLikeAliasWireId(model: string, aliasPrefix = "claude-"): boolean {
  const p = aliasPrefix.trim();
  if (!p || !model.startsWith(p)) {
    return false;
  }
  const rest = model.slice(p.length);
  return /^[0-9a-f]{8}$/i.test(rest);
}
