import type { AliasDrift, Provider, SmartRoutingConfig } from "../../types";
import { parseCustomModelLine } from "../../converter/models-fallback";
import { computeCanonicalAliasHash } from "./aliasHash";

function formatCustomModelLine(id: string, displayName: string, alias: string): string {
  if (displayName === id && alias === id) {
    return id;
  }
  if (alias === id) {
    return `${id};${displayName}`;
  }
  return `${id};${displayName};${alias}`;
}

export function collectAliasDrifts(
  providers: Record<string, Provider>,
  smartRouting: SmartRoutingConfig
): AliasDrift[] {
  const drifts: AliasDrift[] = [];

  for (const [providerId, provider] of Object.entries(providers)) {
    if (provider.enabled === false || !provider.useCustomModelsList) {
      continue;
    }
    const lines = provider.customModelsList ?? [];
    lines.forEach((line, lineIndex) => {
      const parsed = parseCustomModelLine(line);
      if (!parsed.id || parsed.alias === parsed.id) {
        return;
      }
      const canonical = computeCanonicalAliasHash(
        providerId,
        provider.providerType,
        parsed.id,
        smartRouting.aliasPrefix
      );
      if (parsed.alias === canonical) {
        return;
      }
      drifts.push({
        providerId,
        upstreamModelId: parsed.id,
        displayName: parsed.displayName,
        oldAlias: parsed.alias,
        newAlias: canonical,
        lineIndex,
        collision: false,
      });
    });
  }

  const buckets = new Map<string, AliasDrift[]>();
  for (const d of drifts) {
    const list = buckets.get(d.oldAlias) ?? [];
    list.push(d);
    buckets.set(d.oldAlias, list);
  }

  for (const d of drifts) {
    const peers = buckets.get(d.oldAlias) ?? [];
    if (peers.length > 1) {
      d.collision = true;
      d.collisionPeers = peers
        .filter(p => p !== d)
        .map(p => ({ providerId: p.providerId, upstreamModelId: p.upstreamModelId }));
    }
  }

  return drifts;
}

export function applyAliasDriftUpdates(
  lines: string[],
  updates: Array<{ lineIndex: number; newAlias: string }>
): string[] {
  const next = [...lines];
  for (const u of updates) {
    if (u.lineIndex < 0 || u.lineIndex >= next.length) {
      continue;
    }
    const parsed = parseCustomModelLine(next[u.lineIndex] ?? "");
    if (!parsed.id) {
      continue;
    }
    next[u.lineIndex] = formatCustomModelLine(parsed.id, parsed.displayName, u.newAlias);
  }
  return next;
}
