import type {
  BlockRule,
  ConcurrencyConfigInput,
  FileConfigInput,
  ForwardRule,
  ProviderConfigInput,
  RouteQueueConfigInput,
  RoutingConfigInput,
} from "../types";

/**
 * Deep merge two objects (plain nested objects only). Source overwrites target; arrays are atomic.
 *
 * Full config files use {@link mergeFileConfigWithDefaults} so list-shaped sections inherit new
 * default rows without overwriting user-defined lists.
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === "object" &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === "object" &&
        target[key] !== null &&
        !Array.isArray(target[key])
      ) {
        result[key] = deepMerge(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>
        ) as T[keyof T];
      } else {
        result[key] = source[key] as T[keyof T];
      }
    }
  }
  return result;
}

function stableJsonForMergeKey(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return "null";
  }
  if (typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(stableJsonForMergeKey).join(",")}]`;
  }
  const o = obj as Record<string, unknown>;
  const keys = Object.keys(o).sort((a, b) => a.localeCompare(b));
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableJsonForMergeKey(o[k])}`).join(",")}}`;
}

function blockRuleMergeKey(rule: Pick<BlockRule, "path" | "condition">): string {
  return `${rule.path}\0${stableJsonForMergeKey(rule.condition ?? null)}`;
}

function cloneRoutingInput(r: RoutingConfigInput): RoutingConfigInput {
  return {
    ...r,
    ...(r.forward?.length ? { forward: r.forward.map(x => ({ ...x })) } : {}),
    ...(r.block?.length ? { block: r.block.map(x => ({ ...x })) } : {}),
  };
}

/**
 * Keeps user's list order. When `userRules === undefined`, use defaults alone. When user lists an empty
 * array, treat it as intentional (do not attach defaults).
 */
export function mergeForwardRuleLists(
  defaultRules: ForwardRule[],
  userRules: ForwardRule[] | undefined
): ForwardRule[] {
  if (userRules === undefined) {
    return defaultRules.map(r => ({ ...r }));
  }
  if (userRules.length === 0) {
    return [];
  }
  const paths = new Set(userRules.map(r => r.path));
  const out = userRules.map(r => ({ ...r }));
  for (const r of defaultRules) {
    if (!paths.has(r.path)) {
      out.push({ ...r });
    }
  }
  return out;
}

/** Same semantics as {@link mergeForwardRuleLists}: undefined = defaults; [] = intentional empty list. */
export function mergeBlockRuleLists(
  defaultRules: BlockRule[],
  userRules: BlockRule[] | undefined
): BlockRule[] {
  if (userRules === undefined) {
    return defaultRules.map(r => ({ ...r }));
  }
  if (userRules.length === 0) {
    return [];
  }
  const keys = new Set(userRules.map(blockRuleMergeKey));
  const out = userRules.map(r => ({ ...r }));
  for (const r of defaultRules) {
    if (!keys.has(blockRuleMergeKey(r))) {
      out.push({ ...r });
    }
  }
  return out;
}

/** Discriminant: `pattern` (queue route). Undefined = inherit default routes; [] = explicit empty. */
function mergeRouteQueueLists(
  defaultRoutes: RouteQueueConfigInput[],
  userRoutes: RouteQueueConfigInput[] | undefined
): RouteQueueConfigInput[] | undefined {
  if (userRoutes === undefined) {
    if (defaultRoutes.length === 0) {
      return undefined;
    }
    return defaultRoutes.map(r => ({ ...r }));
  }
  if (userRoutes.length === 0) {
    return [];
  }
  const patterns = new Set(userRoutes.map(r => r.pattern));
  const out = userRoutes.map(r => ({ ...r }));
  for (const r of defaultRoutes) {
    if (!patterns.has(r.pattern)) {
      out.push({ ...r });
    }
  }
  return out;
}

/** Default provider ids preserved; overlapping ids merge recursively. */
function mergeProviderRecords(
  defaults: Record<string, ProviderConfigInput>,
  user: Record<string, ProviderConfigInput>
): Record<string, ProviderConfigInput> {
  const out: Record<string, ProviderConfigInput> = { ...defaults };
  for (const id of Object.keys(user)) {
    const d = defaults[id];
    const u = user[id];
    if (d && u) {
      out[id] = deepMerge(
        { ...(d as Record<string, unknown>) },
        u as Partial<Record<string, unknown>>
      ) as ProviderConfigInput;
    } else {
      out[id] = u;
    }
  }
  return out;
}

function mergeRoutingInputs(
  d: RoutingConfigInput | undefined,
  f: RoutingConfigInput | undefined
): RoutingConfigInput | undefined {
  if (!f) {
    return d ? cloneRoutingInput(d) : undefined;
  }
  if (!d) {
    return cloneRoutingInput(f);
  }
  return {
    forward: mergeForwardRuleLists(d.forward ?? [], f.forward),
    block: mergeBlockRuleLists(d.block ?? [], f.block),
    proxy: f.proxy,
    passthrough: f.passthrough,
    openaiBlock: f.openaiBlock,
  };
}

function mergeConcurrencyInputs(
  d: ConcurrencyConfigInput | undefined,
  f: ConcurrencyConfigInput | undefined
): ConcurrencyConfigInput | undefined {
  if (!f) {
    return d ? { ...d } : undefined;
  }
  if (!d) {
    return { ...f };
  }
  const dr = d.routes;
  const fr = f.routes;
  const dRest = { ...d };
  delete (dRest as Partial<ConcurrencyConfigInput> & Record<string, unknown>).routes;
  const fRest = { ...f };
  delete (fRest as Partial<ConcurrencyConfigInput> & Record<string, unknown>).routes;
  const mergedRest = deepMerge(
    dRest as Record<string, unknown>,
    fRest as Partial<Record<string, unknown>>
  ) as Omit<ConcurrencyConfigInput, "routes">;
  const routes = mergeRouteQueueLists(dr ?? [], fr);
  return { ...mergedRest, routes };
}

/**
 * Merge bundled defaults with disk config: wherever the user omitted a scalar/object field, defaults
 * apply; list sections (`routing.forward` / `routing.block` / `concurrency.routes`) keep user rows
 * first and append default rows not already present (by `path` / block key / `pattern`). `undefined`
 * list = use defaults; empty array = user explicitly chose no entries.
 */
export function mergeFileConfigWithDefaults(
  defaults: FileConfigInput,
  file: Partial<FileConfigInput>
): FileConfigInput {
  const routing = mergeRoutingInputs(defaults.routing, file.routing);

  let providers: Record<string, ProviderConfigInput> | undefined;
  if (!defaults.providers && !file.providers) {
    providers = undefined;
  } else if (!file.providers) {
    providers = defaults.providers ? { ...defaults.providers } : undefined;
  } else if (!defaults.providers) {
    providers = { ...file.providers };
  } else {
    providers = mergeProviderRecords(defaults.providers, file.providers);
  }

  const merged: FileConfigInput = {
    configVersion:
      file.configVersion !== undefined && file.configVersion !== null
        ? file.configVersion
        : defaults.configVersion,
    defaultProvider:
      file.defaultProvider !== undefined ? file.defaultProvider : defaults.defaultProvider,
    server:
      (defaults.server ?? file.server)
        ? (deepMerge(
            (defaults.server ?? {}) as Record<string, unknown>,
            (file.server ?? {}) as Record<string, unknown>
          ) as unknown as FileConfigInput["server"])
        : undefined,
    providers,
    routing,
    concurrency: mergeConcurrencyInputs(defaults.concurrency, file.concurrency),
    logging:
      (defaults.logging ?? file.logging)
        ? (deepMerge(
            (defaults.logging ?? {}) as Record<string, unknown>,
            (file.logging ?? {}) as Record<string, unknown>
          ) as unknown as FileConfigInput["logging"])
        : undefined,
    webSearch: file.webSearch ?? file.web_search ?? defaults.webSearch,
    smartRouting:
      (defaults.smartRouting ?? file.smartRouting)
        ? deepMerge(
            (defaults.smartRouting ?? {}) as Record<string, unknown>,
            (file.smartRouting ?? {}) as Record<string, unknown>
          )
        : undefined,
    clientVersionDetection:
      (defaults.clientVersionDetection ?? file.clientVersionDetection)
        ? deepMerge(
            (defaults.clientVersionDetection ?? {}) as Record<string, unknown>,
            (file.clientVersionDetection ?? {}) as Record<string, unknown>
          )
        : undefined,
  };

  return merged;
}
