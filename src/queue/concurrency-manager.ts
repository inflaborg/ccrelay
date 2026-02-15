/**
 * Concurrency Manager for controlling proxy request concurrency
 * Manages a queue of requests and processes them with limited workers
 */

import { Semaphore } from "./semaphore";
import { PriorityQueue } from "./priority-queue";
import type { RequestTask, ProxyResult, QueueStats, ConcurrencyConfig } from "../types";
import { ScopedLogger } from "../utils/logger";

type TaskExecutor = (task: RequestTask) => Promise<ProxyResult>;

interface QueuedTask {
  task: RequestTask;
  resolve: (result: ProxyResult) => void;
  reject: (error: Error) => void;
  queuedAt: number;
  timeoutHandle?: NodeJS.Timeout;
  timedOut?: boolean;
}

interface ProcessingTask {
  task: RequestTask;
  startedAt: number;
  resolve: (result: ProxyResult) => void;
  reject: (error: Error) => void;
}

export class ConcurrencyManager {
  private semaphore: Semaphore;
  private queue: PriorityQueue<QueuedTask>;
  private processingTasks: Map<string, ProcessingTask> = new Map();
  private taskExecutor: TaskExecutor;
  private log: ScopedLogger;
  private config: ConcurrencyConfig;

  // Statistics
  private totalProcessed: number = 0;
  private totalFailed: number = 0;
  private totalWaitTime: number = 0;
  private totalProcessTime: number = 0;

  constructor(config: ConcurrencyConfig, taskExecutor: TaskExecutor) {
    this.config = config;
    this.taskExecutor = taskExecutor;
    this.log = new ScopedLogger("ConcurrencyManager");

    const maxConcurrency = config.maxConcurrency > 0 ? config.maxConcurrency : 1;
    this.semaphore = new Semaphore(maxConcurrency);
    this.queue = new PriorityQueue<QueuedTask>((a, b) => {
      // Sort by priority (higher first), then by enqueue time (earlier first)
      if (a.task.priority !== b.task.priority) {
        return (b.task.priority ?? 0) - (a.task.priority ?? 0);
      }
      return a.queuedAt - b.queuedAt;
    });

    this.log.info(
      `ConcurrencyManager initialized: maxConcurrency=${maxConcurrency}, maxQueueSize=${
        config.maxQueueSize && config.maxQueueSize > 0
          ? config.maxQueueSize
          : "unlimited (capped at 10000)"
      }`
    );
  }

  /**
   * Submit a task to the queue
   * Returns a Promise that resolves when the task is completed
   */
  async submit(task: RequestTask): Promise<ProxyResult> {
    // Check queue size limit
    // maxQueueSize refers to the waiting queue size, not including actively processing tasks
    // If maxQueueSize is 0 or undefined, use safe fallback of 10000
    const maxQueueLimit =
      this.config.maxQueueSize && this.config.maxQueueSize > 0 ? this.config.maxQueueSize : 10000;

    // Only count tasks waiting in queue, not those being processed
    const currentQueueSize = this.queue.size();

    // Total capacity = maxConcurrency (processing) + maxQueueSize (waiting)
    // Check if the waiting queue is full
    if (currentQueueSize >= maxQueueLimit) {
      throw new Error(
        `Queue is full (${currentQueueSize}/${maxQueueLimit} waiting). Please try again later.`
      );
    }

    return new Promise<ProxyResult>((resolve, reject) => {
      const queuedAt = Date.now();
      const queuedTask: QueuedTask = {
        task,
        resolve,
        reject,
        queuedAt,
      };

      // Set up queue timeout - if task times out while waiting in queue, reject immediately
      const timeout = task.timeout ?? this.config.timeout;
      if (timeout && timeout > 0) {
        queuedTask.timeoutHandle = setTimeout(() => {
          // Mark as timed out
          queuedTask.timedOut = true;

          // Try to remove from queue if still there
          const removed = this.queue.remove(qt => qt === queuedTask);
          if (removed) {
            // Task was still in queue, reject it without sending to upstream
            this.log.info(`[Task ${task.id}] Timed out while waiting in queue (${timeout}ms)`);
            reject(new Error(`Task timeout after ${timeout}ms (waiting in queue)`));
          }
          // If not in queue, it's either being processed or already completed
          // The executeTask will handle the timeout for processing tasks
        }, timeout);
      }

      // Add to queue
      this.queue.enqueue(queuedTask, task.priority ?? 0);

      this.log.debug(
        `Task ${task.id} queued (position: ${this.queue.size()}, priority: ${task.priority ?? 0})`
      );

      // Try to process next task
      void this.processNext();
    });
  }

  /**
   * Process the next task in the queue if a worker is available
   */
  private async processNext(): Promise<void> {
    // Check if there's a task to process
    const queuedTask = this.queue.dequeue();
    if (!queuedTask) {
      return; // No tasks in queue
    }

    // Clear the queue timeout handle since we're about to process
    if (queuedTask.timeoutHandle) {
      clearTimeout(queuedTask.timeoutHandle);
      queuedTask.timeoutHandle = undefined;
    }

    // Check if task was timed out while waiting in queue
    if (queuedTask.timedOut) {
      // Already rejected by timeout handler, just skip
      this.log.info(`[Task ${queuedTask.task.id}] Skipped (already timed out in queue)`);
      // Process next task
      void this.processNext();
      return;
    }

    // Check if task has already exceeded its timeout while waiting
    const timeout = queuedTask.task.timeout ?? this.config.timeout;
    const elapsed = Date.now() - queuedTask.queuedAt;
    if (timeout && elapsed >= timeout) {
      // Task has already exceeded its timeout, reject it
      queuedTask.timedOut = true;
      this.log.info(
        `[Task ${queuedTask.task.id}] Rejected (timeout exceeded while waiting: ${elapsed}ms >= ${timeout}ms)`
      );
      queuedTask.reject(new Error(`Task timeout after ${timeout}ms (waiting in queue)`));
      void this.processNext();
      return;
    }

    // Check if task was cancelled while waiting in queue (before acquiring semaphore)
    if (queuedTask.task.cancelled) {
      this.log.info(
        `[Task ${queuedTask.task.id}] Skipped (cancelled while queuing): ${queuedTask.task.cancelledReason ?? "unknown"}`
      );
      queuedTask.reject(new Error(queuedTask.task.cancelledReason ?? "Task cancelled"));
      // Process next task
      void this.processNext();
      return;
    }

    // Acquire semaphore (non-blocking check)
    const stats = this.semaphore.getStats();
    if (stats.available <= 0) {
      // No available workers, put task back
      // Note: We've already cleared the timeout handle, need to set a new one based on remaining time
      const remainingTimeout = timeout ? Math.max(0, timeout - elapsed) : undefined;

      if (remainingTimeout !== undefined && remainingTimeout > 0) {
        queuedTask.timeoutHandle = setTimeout(() => {
          queuedTask.timedOut = true;
          const removed = this.queue.remove(qt => qt === queuedTask);
          if (removed) {
            this.log.info(
              `[Task ${queuedTask.task.id}] Timed out while waiting in queue (${timeout}ms)`
            );
            queuedTask.reject(new Error(`Task timeout after ${timeout}ms (waiting in queue)`));
          }
        }, remainingTimeout);
      } else if (timeout && remainingTimeout === 0) {
        // Already exceeded timeout, reject immediately
        queuedTask.timedOut = true;
        queuedTask.reject(new Error(`Task timeout after ${timeout}ms (waiting in queue)`));
        void this.processNext();
        return;
      }

      this.queue.enqueue(queuedTask, queuedTask.task.priority ?? 0);
      return;
    }

    // Acquire the semaphore and process
    const lease = await this.semaphore.acquire();
    await this.executeTask(queuedTask, lease);
  }

  /**
   * Execute a single task
   */
  private async executeTask(queuedTask: QueuedTask, lease: { release(): void }): Promise<void> {
    const { task, resolve, reject, queuedAt } = queuedTask;
    const startedAt = Date.now();
    const waitTime = startedAt - queuedAt;

    // Track the task
    const processingTask: ProcessingTask = {
      task,
      startedAt,
      resolve,
      reject,
    };
    this.processingTasks.set(task.id, processingTask);

    this.log.info(
      `[Task ${task.id}] Started (wait: ${waitTime}ms, queue: ${this.queue.size()}, active: ${this.processingTasks.size})`
    );

    // Create AbortController for timeout cancellation
    const abortController = new AbortController();
    // Pass the AbortController to the task so executeProxyRequest can use its signal
    task.abortController = abortController;

    // Set up execution timeout with remaining time
    const totalTimeout = task.timeout ?? this.config.timeout;
    const remainingTimeout = totalTimeout ? Math.max(0, totalTimeout - waitTime) : undefined;
    let executionTimeoutHandle: NodeJS.Timeout | undefined;

    // Create a deferred rejection that we can handle properly
    let timeoutError: Error | undefined;

    try {
      // Create timeout promise that rejects and aborts
      const timeoutPromise =
        remainingTimeout !== undefined && remainingTimeout > 0
          ? new Promise<ProxyResult>((_, timeoutReject) => {
              executionTimeoutHandle = setTimeout(() => {
                abortController.abort(new Error(`Task timeout after ${totalTimeout}ms`));
                timeoutError = new Error(`Task timeout after ${totalTimeout}ms`);
                timeoutReject(timeoutError);
              }, remainingTimeout);
            })
          : null;

      // Race between task execution and timeout
      const result = timeoutPromise
        ? await Promise.race([this.taskExecutor(task), timeoutPromise])
        : await this.taskExecutor(task);

      // Update statistics
      const completedAt = Date.now();
      const processTime = completedAt - startedAt;
      this.totalProcessed++;
      this.totalWaitTime += waitTime;
      this.totalProcessTime += processTime;

      this.log.info(
        `[Task ${task.id}] Completed (${result.statusCode} in ${processTime}ms, wait: ${waitTime}ms)`
      );

      resolve(result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.totalFailed++;
      this.log.warn(`[Task ${task.id}] Failed: ${err.message}`);
      reject(err);
    } finally {
      if (executionTimeoutHandle) {
        clearTimeout(executionTimeoutHandle);
      }

      // Clean up abortController
      task.abortController = undefined;

      // Clean up
      this.processingTasks.delete(task.id);
      lease.release();

      // Process next task (fire and forget to avoid error propagation)
      void this.processNext();
    }
  }

  /**
   * Get current queue statistics
   */
  getStats(): QueueStats {
    const avgWaitTime =
      this.totalProcessed > 0 ? Math.round(this.totalWaitTime / this.totalProcessed) : 0;
    const avgProcessTime =
      this.totalProcessed > 0 ? Math.round(this.totalProcessTime / this.totalProcessed) : 0;

    return {
      queueLength: this.queue.size(),
      activeWorkers: this.processingTasks.size,
      maxConcurrency: this.config.maxConcurrency,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      avgWaitTime,
      avgProcessTime,
    };
  }

  /**
   * Get detailed information about currently processing tasks
   */
  getProcessingTasks(): Array<{ id: string; elapsed: number }> {
    const now = Date.now();
    return Array.from(this.processingTasks.values()).map(t => ({
      id: t.task.id,
      elapsed: now - t.startedAt,
    }));
  }

  /**
   * Update the max concurrency limit
   */
  updateMaxConcurrency(newMax: number): void {
    if (newMax <= 0) {
      throw new Error("Max concurrency must be greater than 0");
    }

    const oldMax = this.config.maxConcurrency;
    this.config.maxConcurrency = newMax;

    // Update semaphore permits
    this.semaphore.updatePermits(newMax);

    this.log.info(`Max concurrency updated: ${oldMax} -> ${newMax}`);

    // Trigger processNext to pick up any newly available capacity
    // We need to trigger this multiple times if we added multiple slots
    // or just once? processNext processes ONE task.
    // If we added N spots, we might need to trigger N times.
    // But processNext calls processNext at the end of executeTask.
    // However, if we just opened up 5 spots, we want 5 tasks to start NOW.
    const diff = newMax - oldMax;
    if (diff > 0) {
      // Trigger processing for each new slot
      for (let i = 0; i < diff; i++) {
        void this.processNext();
      }
    } else {
      // If we reduced concurrency, we don't need to do anything.
      // processNext will check available permits and stop if none available.
      void this.processNext();
    }
  }

  /**
   * Clear all pending tasks from the queue
   * Does not affect currently running tasks
   * @param silently If true, don't reject tasks (for cleanup without causing unhandled rejections)
   */
  clearQueue(silently: boolean = false): number {
    const cleared = this.queue.size();

    // Drain the queue
    while (!this.queue.isEmpty()) {
      const item = this.queue.dequeue();
      if (item && !silently) {
        // Clear timeout handle before rejecting
        if (item.timeoutHandle) {
          clearTimeout(item.timeoutHandle);
        }
        item.reject(new Error("Queue cleared"));
      } else if (item?.timeoutHandle) {
        clearTimeout(item.timeoutHandle);
      }
    }

    this.log.info(`Cleared ${cleared} pending tasks from queue`);
    return cleared;
  }

  /**
   * Cancel a specific task by ID
   * Returns true if the task was found and cancelled in the queue
   * Returns false if the task is already being processed or not found
   */
  cancelTask(taskId: string, reason: string): boolean {
    // Check if task is currently being processed
    const processingTask = this.processingTasks.get(taskId);
    if (processingTask) {
      // Task is already running, mark it as cancelled so it can stop gracefully
      processingTask.task.cancelled = true;
      processingTask.task.cancelledReason = reason;
      this.log.info(`[Task ${taskId}] Marked as cancelled (currently processing): ${reason}`);
      return false;
    }

    // Try to find and remove from queue
    const queuedTask = this.queue.remove(item => item.task.id === taskId);
    if (queuedTask) {
      queuedTask.reject(new Error(reason));
      this.log.info(`[Task ${taskId}] Cancelled from queue: ${reason}`);
      return true;
    }

    this.log.debug(`[Task ${taskId}] Not found in queue or processing`);
    return false;
  }

  /**
   * Shutdown the manager, rejecting all pending tasks
   */
  shutdown(): void {
    const pendingCount = this.queue.size();
    this.log.info(`Shutting down, rejecting ${pendingCount} pending tasks`);

    // Reject all queued tasks
    while (!this.queue.isEmpty()) {
      const task = this.queue.dequeue();
      if (task) {
        // Clear any timeout handle to prevent race conditions
        if (task.timeoutHandle) {
          clearTimeout(task.timeoutHandle);
          task.timeoutHandle = undefined;
        }
        task.reject(new Error("ConcurrencyManager is shutting down"));
      }
    }

    this.queue.clear();
  }
}
