import type { BlockRule, ForwardRule, RoutingConfigInput } from "../../types";

export function buildRoutingFromMerged(rawRouting: RoutingConfigInput | undefined): {
  forward: ForwardRule[];
  block: BlockRule[];
} {
  const r = rawRouting ?? {};
  return {
    forward: (r.forward ?? []).map((f: { path: string; provider: string }) => ({
      path: f.path,
      provider: f.provider,
    })),
    block: (r.block ?? []).map(
      (b): BlockRule => ({
        path: b.path,
        condition: b.condition,
        response: b.response,
        code: b.code,
      })
    ),
  };
}
