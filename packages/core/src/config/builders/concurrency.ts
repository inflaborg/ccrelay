import type {
  ConcurrencyConfig,
  ConcurrencyConfigInput,
  Retry429Config,
  RouteQueueConfig,
  RouteQueueConfigInput,
} from "../../types";

export function buildConcurrencyConfig(
  mergedConcurrency: ConcurrencyConfigInput | undefined
): ConcurrencyConfig | undefined {
  if (!mergedConcurrency?.enabled) {
    return undefined;
  }

  let retry429: Retry429Config | undefined;
  if (mergedConcurrency.retry429) {
    retry429 = {
      enabled: mergedConcurrency.retry429.enabled ?? false,
      maxRetries: mergedConcurrency.retry429.maxRetries ?? 3,
      delayMs: mergedConcurrency.retry429.delayMs ?? 1000,
    };
  } else {
    retry429 = {
      enabled: false,
      maxRetries: 3,
      delayMs: 1000,
    };
  }

  return {
    enabled: true,
    maxWorkers: mergedConcurrency.maxWorkers || 3,
    maxQueueSize: mergedConcurrency.maxQueueSize,
    requestTimeout: mergedConcurrency.requestTimeout,
    retry429,
  };
}

export function buildRouteQueues(
  routes: RouteQueueConfigInput[] | undefined
): RouteQueueConfig[] | undefined {
  if (!routes || routes.length === 0) {
    return undefined;
  }
  return routes.map((route, index) => {
    let compiledPattern: RegExp;
    try {
      compiledPattern = new RegExp(route.pattern);
    } catch {
      console.warn(
        `[config/concurrency] Invalid regex pattern "${route.pattern}" at index ${index}`
      );
      compiledPattern = /^$/;
    }
    return {
      pattern: route.pattern,
      maxWorkers: route.maxWorkers ?? 10,
      maxQueueSize: route.maxQueueSize,
      requestTimeout: route.requestTimeout,
      name: route.name,
      compiledPattern,
    };
  });
}
