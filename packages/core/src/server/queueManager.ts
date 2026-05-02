/**
 * Queue manager for handling concurrency and route-specific queues
 */

import { ScopedLogger } from "../utils/logger";
import { ConcurrencyManager } from "../queue";
import type { ConfigManager } from "../config";
import type { RequestTask, QueueStats, ProxyResult } from "../types";

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
    this.initializeQueues();
  }

  /**
   * Initialize default and route-specific queues from config
   */
  private initializeQueues(): void {
    if (!this.executor) {
      return;
    }

    // Initialize default concurrency manager
    const concurrencyConfig = this.config.configValue.concurrency;
    if (concurrencyConfig?.enabled) {
      this.defaultQueue = new ConcurrencyManager(concurrencyConfig, this.executor);
      log.info(
        `Default queue initialized: maxWorkers=${concurrencyConfig.maxWorkers}, maxQueueSize=${concurrencyConfig.maxQueueSize ?? "unlimited"}`
      );
    } else {
      log.info(
        `Default queue disabled. Config: ${JSON.stringify(concurrencyConfig ?? "undefined")}`
      );
    }

    // Initialize route-specific queues
    const routeQueueConfigs = this.config.routeQueues;
    if (routeQueueConfigs && routeQueueConfigs.length > 0) {
      for (const routeConfig of routeQueueConfigs) {
        const queueName = routeConfig.name ?? routeConfig.pattern;
        const queueConfig = {
          enabled: true,
          maxWorkers: routeConfig.maxWorkers,
          maxQueueSize: routeConfig.maxQueueSize,
          requestTimeout: routeConfig.requestTimeout,
        };
        const routeQueue = new ConcurrencyManager(queueConfig, this.executor);
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
   * Clear the default queue
   */
  clearQueue(): number {
    return this.defaultQueue?.clearQueue() ?? 0;
  }
}
