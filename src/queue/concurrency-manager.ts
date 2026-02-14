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
    // If maxQueueSize is 0 or undefined, use safe fallback of 10000
    const maxQueueLimit =
      this.config.maxQueueSize && this.config.maxQueueSize > 0 ? this.config.maxQueueSize : 10000;

    const currentSize = this.queue.size() + this.processingTasks.size;

    if (currentSize >= maxQueueLimit) {
      throw new Error(`Queue is full (${currentSize}/${maxQueueLimit}). Please try again later.`);
    }

    return new Promise<ProxyResult>((resolve, reject) => {
      const queuedTask: QueuedTask = {
        task,
        resolve,
        reject,
        queuedAt: Date.now(),
      };

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

    // Acquire semaphore (non-blocking check)
    const stats = this.semaphore.getStats();
    if (stats.available <= 0) {
      // No available workers, put task back
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

    // Check if task was cancelled while waiting in queue
    if (task.cancelled) {
      this.log.info(
        `[Task ${task.id}] Skipped (cancelled while queuing): ${task.cancelledReason ?? "unknown"}`
      );
      reject(new Error(task.cancelledReason ?? "Task cancelled"));
      lease.release();
      await this.processNext();
      return;
    }

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

    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
      // Set timeout if configured
      const timeout = task.timeout ?? this.config.timeout;

      const timeoutPromise = new Promise<ProxyResult>((_, timeoutReject) => {
        if (timeout) {
          timeoutHandle = setTimeout(() => {
            timeoutReject(new Error(`Task timeout after ${timeout}ms`));
          }, timeout);
        }
      });

      // Race between task execution and timeout
      const result = await Promise.race([this.taskExecutor(task), timeoutPromise]);

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
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      // Clean up
      this.processingTasks.delete(task.id);
      lease.release();

      // Process next task
      await this.processNext();
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
   */
  clearQueue(): number {
    const cleared = this.queue.size();

    // Drain the queue and reject all tasks
    while (!this.queue.isEmpty()) {
      const item = this.queue.dequeue();
      if (item) {
        item.reject(new Error("Queue cleared"));
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
        task.reject(new Error("ConcurrencyManager is shutting down"));
      }
    }

    this.queue.clear();
  }
}
