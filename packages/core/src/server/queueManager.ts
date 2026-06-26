/**
 * Queue manager for handling concurrency and route-specific queues
 */

import { ScopedLogger } from "../utils/logger";
import { ConcurrencyManager } from "../queue";
import type { ConfigManager } from "../config";
import type {
  ConcurrencyConfig,
  RequestTask,
  QueueStats,
  QueueOverview,
  ProxyResult,
  RouteQueueConfig,
} from "../types";

const log = new ScopedLogger("QueueManager");

/**
 * Executor function type for running proxy requests
 */
export type ProxyExecutor = (task: RequestTask) => Promise<ProxyResult>;

/**
 * Queue manager handles default concurrency and route-specific queues
 */
export class QueueManager {
  private defaultQueue: ConcurrencyManager | null = null;
  private routeQueues: Map<string, ConcurrencyManager> = new Map();
  private config: ConfigManager;
  private executor: ProxyExecutor | null = null;

  constructor(config: ConfigManager) {
    this.config = config;
  }

  /**
   * Set the executor function (called after ProxyServer is fully constructed)
   */
  setExecutor(executor: ProxyExecutor): void {
    this.executor = executor;
    this.reloadFromConfig();
  }

  /**
   * Sync queue managers with the current config (startup and hot-reload).
   */
  reloadFromConfig(): void {
    if (!this.executor) {
      return;
    }

    this.syncDefaultQueue();
    this.syncRouteQueues();
  }

  private routeConfigToConcurrencyConfig(routeConfig: RouteQueueConfig): ConcurrencyConfig {
    return {
      enabled: true,
      maxWorkers: routeConfig.maxWorkers,
      maxQueueSize: routeConfig.maxQueueSize,
      requestTimeout: routeConfig.requestTimeout,
    };
  }

  private syncDefaultQueue(): void {
    const executor = this.executor!;
    const concurrencyConfig = this.config.configValue.concurrency;

    if (concurrencyConfig?.enabled) {
      if (this.defaultQueue) {
        this.defaultQueue.applyConfig(concurrencyConfig);
        log.info(
          `Default queue reloaded: maxWorkers=${concurrencyConfig.maxWorkers}, maxQueueSize=${concurrencyConfig.maxQueueSize ?? "unlimited"}`
        );
      } else {
        this.defaultQueue = new ConcurrencyManager(concurrencyConfig, executor);
        log.info(
          `Default queue initialized: maxWorkers=${concurrencyConfig.maxWorkers}, maxQueueSize=${concurrencyConfig.maxQueueSize ?? "unlimited"}`
        );
      }
      return;
    }

    if (this.defaultQueue) {
      log.info("Default queue disabled");
    } else {
      log.info(
        `Default queue disabled. Config: ${JSON.stringify(concurrencyConfig ?? "undefined")}`
      );
    }
    this.defaultQueue = null;
  }

  private syncRouteQueues(): void {
    const executor = this.executor!;
    const routeQueueConfigs = this.config.routeQueues ?? [];
    const desiredNames = new Set(
      routeQueueConfigs.map(routeConfig => routeConfig.name ?? routeConfig.pattern)
    );

    for (const queueName of this.routeQueues.keys()) {
      if (!desiredNames.has(queueName)) {
        this.routeQueues.delete(queueName);
        log.info(`RouteQueue "${queueName}" removed from config`);
      }
    }

    for (const routeConfig of routeQueueConfigs) {
      const queueName = routeConfig.name ?? routeConfig.pattern;
      const queueConfig = this.routeConfigToConcurrencyConfig(routeConfig);
      const existing = this.routeQueues.get(queueName);

      if (existing) {
        existing.applyConfig(queueConfig);
        log.info(
          `RouteQueue "${queueName}" reloaded: pattern=${routeConfig.pattern}, maxWorkers=${routeConfig.maxWorkers}, maxQueueSize=${routeConfig.maxQueueSize ?? "unlimited"}`
        );
      } else {
        const routeQueue = new ConcurrencyManager(queueConfig, executor);
        this.routeQueues.set(queueName, routeQueue);
        log.info(
          `RouteQueue "${queueName}" initialized: pattern=${routeConfig.pattern}, maxWorkers=${routeConfig.maxWorkers}, maxQueueSize=${routeConfig.maxQueueSize ?? "unlimited"}`
        );
      }
    }
  }

  /**
   * Check if any queue is enabled
   */
  get enabled(): boolean {
    return this.defaultQueue !== null || this.routeQueues.size > 0;
  }

  /**
   * Find matching route queue for a given path
   */
  findMatchingQueue(path: string): { name: string; queue: ConcurrencyManager } | undefined {
    const routeQueueConfigs = this.config.routeQueues;
    if (!routeQueueConfigs || routeQueueConfigs.length === 0) {
      return undefined;
    }

    for (const routeConfig of routeQueueConfigs) {
      if (routeConfig.compiledPattern && routeConfig.compiledPattern.test(path)) {
        const queueName = routeConfig.name ?? routeConfig.pattern;
        const queue = this.routeQueues.get(queueName);
        if (queue) {
          return { name: queueName, queue };
        }
      }
    }
    return undefined;
  }

  /**
   * Get the appropriate queue for a request path
   * Returns route-specific queue if matched, otherwise default queue
   */
  getQueueForPath(path: string): { name: string; queue: ConcurrencyManager } | null {
    const matchedRoute = this.findMatchingQueue(path);
    if (matchedRoute) {
      return matchedRoute;
    }
    if (this.defaultQueue) {
      return { name: "default", queue: this.defaultQueue };
    }
    return null;
  }

  /**
   * Get default queue (may be null if disabled)
   */
  getDefaultQueue(): ConcurrencyManager | null {
    return this.defaultQueue;
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats | null {
    return this.defaultQueue?.getStats() ?? null;
  }

  /**
   * Get full queue overview (default + route queues, with live task snapshots)
   */
  getOverview(): QueueOverview {
    if (!this.enabled) {
      return {
        enabled: false,
        message: "Concurrency control is not enabled",
        routes: {},
      };
    }

    const routes: QueueOverview["routes"] = {};
    for (const [name, queue] of this.routeQueues) {
      routes[name] = queue.getDetailStats();
    }

    return {
      enabled: true,
      default: this.defaultQueue?.getDetailStats() ?? null,
      routes,
    };
  }

  /**
   * Clear the default queue
   */
  clearQueue(): number {
    return this.defaultQueue?.clearQueue() ?? 0;
  }
}
