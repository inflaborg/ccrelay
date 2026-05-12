import type { BlockPattern, BlockRule, ForwardRule, RoutingConfigInput } from "../types";
import { getDefaultConfig } from "./defaults";
import { mergeBlockRuleLists, mergeForwardRuleLists } from "./merge";

/**
 * Legacy config (no `configVersion` in YAML): derive unified forward/block rules from
 * `proxy` / legacy `block` / `openaiBlock` / `passthrough`, then merge with bundled defaults.
 */
export function computeLegacyMigratedRouting(rawRouting: RoutingConfigInput | undefined): {
  forward: ForwardRule[];
  block: BlockRule[];
} {
  const rawRoutingSafe = rawRouting ?? {};
  const proxy: string[] = rawRoutingSafe.proxy ?? [
    "/v1/messages",
    "/v1/chat/completions",
    "/v1/models",
    "/v1/responses",
  ];
  let forwardRules = [...proxy.map((p: string) => ({ path: p, provider: "auto" }))];
  const legacyBlock: BlockPattern[] = (rawRoutingSafe.block || []).map(
    (b: { path: string; response?: string; code?: number }): BlockPattern => ({
      path: b.path,
      response: b.response || "",
      code: b.code ?? 200,
    })
  );
  const legacyOpenaiBlock: BlockPattern[] = (rawRoutingSafe.openaiBlock || []).map(
    (b: { path: string; response?: string; code?: number }): BlockPattern => ({
      path: b.path,
      response: b.response || "",
      code: b.code ?? 200,
    })
  );
  const defaultPassthroughGuard = ["/v1/users/*", "/v1/organizations/*"];
  const passthroughRaw = rawRoutingSafe.passthrough;
  let passthroughPaths: string[] = Array.isArray(passthroughRaw)
    ? passthroughRaw.filter((x): x is string => typeof x === "string")
    : defaultPassthroughGuard;
  if (passthroughPaths.length === 0) {
    passthroughPaths = defaultPassthroughGuard;
  }
  const legacyPassthroughGuard: BlockRule[] = passthroughPaths.map((globPath: string) => ({
    path: globPath,
    condition: { providerNot: ["official"] },
    response: "",
    code: 200,
  }));

  const blockRules: BlockRule[] = [
    ...legacyBlock.map((b: BlockPattern) => ({
      path: b.path,
      response: b.response,
      code: b.code ?? 200,
    })),
    ...legacyOpenaiBlock.map((b: BlockPattern) => ({
      path: b.path,
      response: b.response,
      code: b.code ?? 200,
    })),
    ...legacyPassthroughGuard,
    {
      path: "/anthropic/v1/users/*",
      condition: { providerNot: ["official"] },
      response: "",
      code: 200,
    },
    {
      path: "/anthropic/v1/organizations/*",
      condition: { providerNot: ["official"] },
      response: "",
      code: 200,
    },
  ];

  const defRt = getDefaultConfig().routing;
  forwardRules = mergeForwardRuleLists(defRt?.forward ?? [], forwardRules);
  const mergedBlockRules = mergeBlockRuleLists(defRt?.block ?? [], blockRules);

  return { forward: forwardRules, block: mergedBlockRules };
}
