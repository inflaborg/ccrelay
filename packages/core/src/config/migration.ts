import semver from "semver";
import type { BlockPattern, BlockRule, ForwardRule, RoutingConfigInput } from "../types";
import {
  CONFIG_VERSION,
  DEFAULT_CONCURRENCY_REQUEST_TIMEOUT,
  getDefaultConfig,
  LEGACY_CONCURRENCY_REQUEST_TIMEOUT,
} from "./defaults";
import { mergeBlockRuleLists, mergeForwardRuleLists } from "./merge";

const CONFIG_UPGRADE_TARGET = CONFIG_VERSION;

/** True when the on-disk config should be upgraded to {@link CONFIG_VERSION}. */
export function needsConfigUpgrade(fileVersion: string | null): boolean {
  if (!fileVersion) {
    return true;
  }
  const coerced = semver.coerce(fileVersion);
  return !coerced || semver.lt(coerced, CONFIG_UPGRADE_TARGET);
}

/**
 * If `concurrency.requestTimeout` is still the legacy default (60), set it to 0 (unlimited).
 * Mutates `rawFile` in place. Returns whether the timeout field changed.
 */
export function applyConcurrencyRequestTimeoutMigration(rawFile: Record<string, unknown>): boolean {
  const concurrency = rawFile.concurrency;
  if (!concurrency || typeof concurrency !== "object" || Array.isArray(concurrency)) {
    return false;
  }
  const c = concurrency as Record<string, unknown>;
  if (c.requestTimeout === LEGACY_CONCURRENCY_REQUEST_TIMEOUT) {
    c.requestTimeout = DEFAULT_CONCURRENCY_REQUEST_TIMEOUT;
    return true;
  }
  return false;
}

/**
 * Bump `configVersion` to {@link CONFIG_VERSION} and migrate legacy concurrency timeout when applicable.
 */
export function prepareConfigUpgrade025(
  rawFile: Record<string, unknown>,
  fileVersion: string | null
): { changed: boolean; concurrencyTimeoutMigrated: boolean } {
  if (!needsConfigUpgrade(fileVersion)) {
    return { changed: false, concurrencyTimeoutMigrated: false };
  }
  const concurrencyTimeoutMigrated = applyConcurrencyRequestTimeoutMigration(rawFile);
  rawFile.configVersion = CONFIG_VERSION;
  return { changed: true, concurrencyTimeoutMigrated };
}

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
