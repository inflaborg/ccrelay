import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConcurrencyManager } from "../../../src/queue/concurrency-manager";
import { RequestTask, ConcurrencyConfig, ProxyResult } from "../../../src/types";

// Mock vscode before importing ConcurrencyManager which uses Logger
vi.mock("vscode", () => ({
  window: {
    createOutputChannel: vi.fn().mockReturnValue({
      appendLine: vi.fn(),
      show: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
    }),
  },
}));

// Mock task generator
const createMockTask = (id: string, priority: number = 0): RequestTask => ({
  id,
  method: "POST",
  targetUrl: "https://api.example.com/v1/chat/completions",
  headers: {},
  body: Buffer.from("{}"),
  provider: {
    id: "test",
    name: "Test",
    baseUrl: "https://api.example.com",
    mode: "passthrough",
    apiKey: "sk-test",
    providerType: "openai",
  },
  requestPath: "/v1/chat/completions",
  requestBodyLog: "",
  originalRequestBody: "",
  isOpenAIProvider: true,
  originalModel: "gpt-4",
  clientId: "client-1",
  createdAt: Date.now(),
  priority,
});

describe("ConcurrencyManager", () => {
  let config: ConcurrencyConfig;
  let manager: ConcurrencyManager;

  beforeEach(() => {
    config = {
      enabled: true,
      maxConcurrency: 2,
      maxQueueSize: 5,
      timeout: 1000,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should initialize correctly", () => {
    manager = new ConcurrencyManager(config, () =>
      Promise.resolve({ statusCode: 200 } as ProxyResult)
    );
    const stats = manager.getStats();
    expect(stats.activeWorkers).toBe(0);
    expect(stats.queueLength).toBe(0);
    expect(stats.maxConcurrency).toBe(2);
  });

  it("should process task immediately if workers available", async () => {
    const executor = vi.fn().mockResolvedValue({ statusCode: 200 } as ProxyResult);
    manager = new ConcurrencyManager(config, executor);

    const task = createMockTask("task1");
    const result = await manager.submit(task);

    expect(result.statusCode).toBe(200);
    expect(executor).toHaveBeenCalledWith(task);
  });

  it("should queue task if no workers available", async () => {
    let releaseTask1: () => void;
    let releaseTask2: () => void;
    let releaseTask3: () => void;

    const executor = async (task: RequestTask): Promise<ProxyResult> => {
      if (task.id === "task1") {
        await new Promise<void>(resolve => {
          releaseTask1 = resolve;
        });
      } else if (task.id === "task2") {
        await new Promise<void>(resolve => {
          releaseTask2 = resolve;
        });
      } else if (task.id === "task3") {
        await new Promise<void>(resolve => {
          releaseTask3 = resolve;
        });
      }
      return { statusCode: 200 } as ProxyResult;
    };

    manager = new ConcurrencyManager(config, executor);

    // Submit 2 tasks to fill workers
    const p1 = manager.submit(createMockTask("task1"));
    const p2 = manager.submit(createMockTask("task2"));

    // Wait small delay to ensure they are picked up and processing started
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(manager.getStats().activeWorkers).toBe(2);

    // Submit 3rd task, should be queued
    const p3 = manager.submit(createMockTask("task3"));

    expect(manager.getStats().queueLength).toBe(1);

    // Release one task
    releaseTask1!();
    await p1;

    // Wait for p3 to be picked up
    await new Promise(resolve => setTimeout(resolve, 50));

    // Now queue should be 0, active still 2 (task2 + task3)
    expect(manager.getStats().queueLength).toBe(0);
    expect(manager.getStats().activeWorkers).toBe(2);

    // Cleanup
    releaseTask2!();
    releaseTask3!();
    await Promise.all([p2, p3]);
  });

  it("should reject when queue is full", async () => {
    config.maxQueueSize = 1;

    const executor = async () => {
      await new Promise(r => setTimeout(r, 500));
      return { statusCode: 200 } as ProxyResult;
    };

    manager = new ConcurrencyManager(config, executor);

    void manager.submit(createMockTask("1")); // Active
    void manager.submit(createMockTask("2")); // Active
    void manager.submit(createMockTask("3")); // Queued (1/1)

    // Wait for tasks to start
    await new Promise(r => setTimeout(r, 10));

    await expect(manager.submit(createMockTask("4"))).rejects.toThrow(/Queue is full/);
  });

  it("should respect priority", async () => {
    const executionOrder: string[] = [];
    let releaseWorker: (v?: unknown) => void;
    const workerPromise = new Promise(resolve => {
      releaseWorker = resolve;
    });

    const executor = async (task: RequestTask): Promise<ProxyResult> => {
      if (task.id.startsWith("worker")) {
        await workerPromise;
      } else {
        executionOrder.push(task.id);
      }
      return { statusCode: 200 } as ProxyResult;
    };

    manager = new ConcurrencyManager(config, executor);

    // Fill workers
    const w1 = manager.submit(createMockTask("worker1"));
    const w2 = manager.submit(createMockTask("worker2"));

    await new Promise(r => setTimeout(r, 10));

    // Queue tasks with different priorities
    const pLow = manager.submit(createMockTask("low", 1));
    const pHigh = manager.submit(createMockTask("high", 10));

    await new Promise(r => setTimeout(r, 10));

    // Release workers
    releaseWorker!();
    await Promise.all([w1, w2]);

    // Wait for queued tasks to finish
    await Promise.all([pLow, pHigh]);

    // High priority should be processed before Low priority
    expect(executionOrder).toEqual(["high", "low"]);
  });

  it("should treat maxQueueSize=0 as unlimited (capped at 10000)", async () => {
    config.maxQueueSize = 0;
    config.maxConcurrency = 1;

    let releaseTask: (v?: unknown) => void;
    const taskPromise = new Promise(resolve => {
      releaseTask = resolve;
    });

    const executor = () => taskPromise.then(() => ({ statusCode: 200 }) as ProxyResult);

    manager = new ConcurrencyManager(config, executor);

    // Submit 1 (active)
    const p1 = manager.submit(createMockTask("1"));

    // Submit 2 (queued) - should succeed despite maxQueueSize=0
    // If strict 0, this would fail. With new logic, limit is 10000.
    const p2 = manager.submit(createMockTask("2"));

    await new Promise(r => setTimeout(r, 10));

    // Release tasks
    releaseTask!();
    await Promise.all([p1, p2]);
  });

  describe("CM005: Task failure handling", () => {
    it("CM005: should reject and release worker on task failure", async () => {
      const executor = vi.fn().mockRejectedValue(new Error("Task failed"));
      manager = new ConcurrencyManager(config, executor);

      const task = createMockTask("task1");
      await expect(manager.submit(task)).rejects.toThrow("Task failed");

      // Worker should be released, allowing new tasks
      expect(manager.getStats().activeWorkers).toBe(0);

      // Should be able to submit and process another task
      const successExecutor = vi.fn().mockResolvedValue({ statusCode: 200 } as ProxyResult);
      manager = new ConcurrencyManager(config, successExecutor);
      const result = await manager.submit(createMockTask("task2"));
      expect(result.statusCode).toBe(200);
    });
  });

  describe("CM006: Timeout handling", () => {
    it("CM006: should reject task when execution exceeds timeout", async () => {
      config.timeout = 100;

      // Use a promise that takes longer than timeout but will eventually resolve
      // This avoids the orphaned promise issue
      const executor = vi.fn().mockImplementation(
        () =>
          new Promise<ProxyResult>(resolve => {
            setTimeout(() => resolve({ statusCode: 200 } as ProxyResult), 500);
          })
      );
      manager = new ConcurrencyManager(config, executor);

      const task = createMockTask("task1");
      const promise = manager.submit(task);

      // Should reject with timeout before the 500ms executor completes
      await expect(promise).rejects.toThrow(/timeout/i);

      // Worker should be released
      expect(manager.getStats().activeWorkers).toBe(0);
    });

    it("CM006: should use task-specific timeout if provided", async () => {
      config.timeout = 1000; // Default 1s

      const quickExecutor = vi.fn().mockImplementation(
        () =>
          new Promise<ProxyResult>(resolve =>
            setTimeout(
              () =>
                resolve({
                  statusCode: 200,
                  headers: {},
                  duration: 50,
                }),
              50
            )
          )
      );
      manager = new ConcurrencyManager(config, quickExecutor);

      const task = createMockTask("task1");
      task.timeout = 100; // Task-specific 100ms timeout

      // This should resolve since task completes in 50ms < 100ms timeout
      const result = await manager.submit(task);
      expect(result.statusCode).toBe(200);
    });
  });

  describe("CM008-CM009: Dynamic concurrency updates", () => {
    it("CM008: should increase concurrency and wake waiting tasks", async () => {
      config.maxConcurrency = 1;

      let releaseTask1: () => void;
      const blockingTask = new Promise<ProxyResult>(resolve => {
        releaseTask1 = () => resolve({ statusCode: 200 } as ProxyResult);
      });

      const executor = vi.fn().mockImplementation(() => blockingTask);
      manager = new ConcurrencyManager(config, executor);

      // Fill the single worker
      const p1 = manager.submit(createMockTask("task1"));

      // Queue a second task
      const p2 = manager.submit(createMockTask("task2"));

      await new Promise(r => setTimeout(r, 10));
      expect(manager.getStats().activeWorkers).toBe(1);
      expect(manager.getStats().queueLength).toBe(1);

      // Increase concurrency
      manager.updateMaxConcurrency(2);

      // Wait longer for internal state to update (processNext call in updateMaxConcurrency doesn't trigger it)
      await new Promise(r => setTimeout(r, 200));

      // Second task should be picked up
      expect(manager.getStats().activeWorkers).toBe(2);
      expect(manager.getStats().queueLength).toBe(0);

      // Cleanup
      releaseTask1!();
      await Promise.all([p1, p2]);
    });

    it("CM009: should decrease concurrency without affecting running tasks", async () => {
      config.maxConcurrency = 3;

      let releaseTask1: () => void;
      let releaseTask2: () => void;
      const runningTasks: Array<Promise<void>> = [];

      const executor = vi.fn().mockImplementation((task: RequestTask) => {
        if (task.id === "task1") {
          const p = new Promise<void>(resolve => {
            releaseTask1 = resolve;
          });
          runningTasks.push(p);
          return p.then(() => ({ statusCode: 200, headers: {}, duration: 0 }));
        } else if (task.id === "task2") {
          const p = new Promise<void>(resolve => {
            releaseTask2 = resolve;
          });
          runningTasks.push(p);
          return p.then(() => ({ statusCode: 200, headers: {}, duration: 0 }));
        }
        return Promise.resolve({ statusCode: 200, headers: {}, duration: 0 });
      });

      manager = new ConcurrencyManager(config, executor);

      // Start 2 tasks
      const p1 = manager.submit(createMockTask("task1"));
      const p2 = manager.submit(createMockTask("task2"));

      await new Promise(r => setTimeout(r, 10));
      expect(manager.getStats().activeWorkers).toBe(2);

      // Reduce concurrency to 1
      manager.updateMaxConcurrency(1);

      // Existing tasks continue running
      expect(manager.getStats().activeWorkers).toBe(2);

      // New task should wait (queue)
      const p3 = manager.submit(createMockTask("task3"));
      await new Promise(r => setTimeout(r, 10));
      expect(manager.getStats().queueLength).toBe(1);

      // Cleanup - release tasks so p3 can process
      releaseTask1!();
      releaseTask2!();
      await Promise.all([p1, p2, p3]);
    });

    it("CM009: should throw error when setting invalid concurrency", () => {
      manager = new ConcurrencyManager(config, vi.fn());

      expect(() => manager.updateMaxConcurrency(0)).toThrow("greater than 0");
      expect(() => manager.updateMaxConcurrency(-1)).toThrow("greater than 0");
    });
  });

  describe("CM010: Queue clearing", () => {
    it("CM010: should clear queue without affecting running tasks", async () => {
      config.maxConcurrency = 1;

      let releaseTask: () => void;
      const blockingTask = new Promise<ProxyResult>(resolve => {
        releaseTask = () => resolve({ statusCode: 200 } as ProxyResult);
      });

      const executor = vi.fn().mockImplementation(() => blockingTask);
      manager = new ConcurrencyManager(config, executor);

      // Start one task
      const p1 = manager.submit(createMockTask("task1"));

      // Queue more tasks
      const p2 = manager.submit(createMockTask("task2"));
      const p3 = manager.submit(createMockTask("task3"));
      const p4 = manager.submit(createMockTask("task4"));

      await new Promise(r => setTimeout(r, 10));
      expect(manager.getStats().queueLength).toBe(3);

      // Clear queue
      const clearedCount = manager.clearQueue();
      expect(clearedCount).toBe(3);
      expect(manager.getStats().queueLength).toBe(0);

      // Running task should continue
      expect(manager.getStats().activeWorkers).toBe(1);

      // Queued tasks should be rejected
      await expect(p2).rejects.toThrow("Queue cleared");
      await expect(p3).rejects.toThrow("Queue cleared");
      await expect(p4).rejects.toThrow("Queue cleared");

      // Original task should still complete
      releaseTask!();
      await p1;
    });
  });

  describe("CM011: Shutdown", () => {
    it("CM011: should reject all pending tasks on shutdown", async () => {
      config.maxConcurrency = 1;

      let releaseTask: () => void;
      const blockingTask = new Promise<ProxyResult>(resolve => {
        releaseTask = () => resolve({ statusCode: 200 } as ProxyResult);
      });

      const executor = vi.fn().mockImplementation(() => blockingTask);
      manager = new ConcurrencyManager(config, executor);

      // Start one task
      const p1 = manager.submit(createMockTask("task1"));

      // Queue more tasks
      const p2 = manager.submit(createMockTask("task2"));
      const p3 = manager.submit(createMockTask("task3"));

      await new Promise(r => setTimeout(r, 10));
      expect(manager.getStats().queueLength).toBe(2);

      // Shutdown
      manager.shutdown();

      // All pending tasks should be rejected
      await expect(p2).rejects.toThrow("shutting down");
      await expect(p3).rejects.toThrow("shutting down");

      // Queue should be empty
      expect(manager.getStats().queueLength).toBe(0);

      // Running task should continue unaffected
      expect(manager.getStats().activeWorkers).toBe(1);

      // Cleanup
      releaseTask!();
      await p1;
    });

    it("CM011: should allow new tasks after shutdown if queue is empty", () => {
      // Note: Current implementation doesn't prevent new submissions after shutdown
      // This test documents current behavior
      const executor = vi.fn().mockResolvedValue({ statusCode: 200 } as ProxyResult);
      manager = new ConcurrencyManager(config, executor);

      // Shutdown with no pending tasks
      manager.shutdown();

      // New task submission behavior depends on implementation
      // Current implementation clears queue but doesn't prevent new submissions
      const stats = manager.getStats();
      expect(stats.queueLength).toBe(0);
    });
  });

  describe("CM012: Task cancellation", () => {
    it("CM012: should cancel task from queue", async () => {
      config.maxConcurrency = 1;

      let releaseTask: () => void;
      const blockingTask = new Promise<ProxyResult>(resolve => {
        releaseTask = () => resolve({ statusCode: 200 } as ProxyResult);
      });

      const executor = vi.fn().mockImplementation(() => blockingTask);
      manager = new ConcurrencyManager(config, executor);

      // Start one task to fill worker
      const p1 = manager.submit(createMockTask("task1"));

      await new Promise(r => setTimeout(r, 10));
      expect(manager.getStats().activeWorkers).toBe(1);

      // Queue another task
      const p2 = manager.submit(createMockTask("task2"));

      await new Promise(r => setTimeout(r, 10));
      expect(manager.getStats().queueLength).toBe(1);

      // Cancel the queued task
      const cancelled = manager.cancelTask("task2", "User cancelled");

      expect(cancelled).toBe(true);
      expect(manager.getStats().queueLength).toBe(0);

      // Queued task should be rejected
      await expect(p2).rejects.toThrow("User cancelled");

      // Running task should continue
      releaseTask!();
      await p1;
    });

    it("CM012: should mark processing task as cancelled but not remove immediately", async () => {
      config.maxConcurrency = 1;

      let taskExecutionComplete = false;

      const executor = vi.fn().mockImplementation((task: RequestTask) => {
        // Simulate a task that checks for cancellation
        return new Promise<ProxyResult>((_, reject) => {
          // Check cancelled flag in task
          const checkInterval = setInterval(() => {
            if (task.cancelled) {
              clearInterval(checkInterval);
              taskExecutionComplete = true;
              reject(new Error(task.cancelledReason || "Task cancelled"));
            }
          }, 10);
        });
      });

      manager = new ConcurrencyManager(config, executor);

      // Start task
      const p1 = manager.submit(createMockTask("task1"));

      await new Promise(r => setTimeout(r, 50));

      // Cancel the processing task
      const cancelled = manager.cancelTask("task1", "User cancelled");

      expect(cancelled).toBe(false); // Returns false for processing tasks

      // Wait for the task to detect cancellation and reject
      await expect(p1).rejects.toThrow("User cancelled");
      expect(taskExecutionComplete).toBe(true);

      // Worker should be released
      expect(manager.getStats().activeWorkers).toBe(0);
    });

    it("CM012: should return false when cancelling non-existent task", () => {
      const executor = vi.fn().mockResolvedValue({ statusCode: 200 } as ProxyResult);
      manager = new ConcurrencyManager(config, executor);

      const cancelled = manager.cancelTask("non-existent", "Test");
      expect(cancelled).toBe(false);
    });

    it("CM012: should skip cancelled task during execution", async () => {
      // Test by using cancelTask method to cancel a task that's queued
      config.maxConcurrency = 1;

      let releaseTask: () => void;
      const blockingTask = new Promise<ProxyResult>(resolve => {
        releaseTask = () => resolve({ statusCode: 200 } as ProxyResult);
      });

      const executor = vi.fn().mockImplementation(() => blockingTask);
      manager = new ConcurrencyManager(config, executor);

      // Fill the worker with task1
      const p1 = manager.submit(createMockTask("task1"));

      await new Promise(r => setTimeout(r, 10));
      expect(manager.getStats().activeWorkers).toBe(1);

      // Submit task2 which will be queued
      const task2 = createMockTask("task2");
      const p2 = manager.submit(task2);

      // Set up rejection handler immediately to prevent unhandled rejection warning
      const p2Catch = p2.catch(() => {
        /* expected rejection */
      });

      await new Promise(r => setTimeout(r, 10));
      expect(manager.getStats().queueLength).toBe(1);

      // Now mark task2 as cancelled while it's in queue
      task2.cancelled = true;
      task2.cancelledReason = "Cancelled before processing";

      // Trigger processing next task by releasing task1
      releaseTask!();
      await p1;

      // Wait for task2 to be processed
      await p2Catch;

      // Task2 should have been rejected because it was cancelled
      await expect(p2).rejects.toThrow("Cancelled before processing");

      // Executor should only have been called once (for task1)
      expect(executor).toHaveBeenCalledTimes(1);
    });
  });

  describe("CM013: Statistics tracking", () => {
    it("CM013: should track totalProcessed count", async () => {
      const executor = vi.fn().mockResolvedValue({ statusCode: 200 } as ProxyResult);
      manager = new ConcurrencyManager(config, executor);

      await manager.submit(createMockTask("task1"));
      await manager.submit(createMockTask("task2"));
      await manager.submit(createMockTask("task3"));

      const stats = manager.getStats();
      expect(stats.totalProcessed).toBe(3);
      expect(stats.totalFailed).toBe(0);
    });

    it("CM013: should track totalFailed count", async () => {
      const executor = vi.fn().mockRejectedValue(new Error("Task failed"));
      manager = new ConcurrencyManager(config, executor);

      await expect(manager.submit(createMockTask("task1"))).rejects.toThrow();
      await expect(manager.submit(createMockTask("task2"))).rejects.toThrow();

      const stats = manager.getStats();
      expect(stats.totalFailed).toBe(2);
      expect(stats.totalProcessed).toBe(0);
    });

    it("CM013: should calculate avgWaitTime and avgProcessTime", async () => {
      const executor = vi.fn().mockImplementation(
        (): Promise<ProxyResult> => {
          return new Promise(resolve => {
            setTimeout(() => {
              resolve({ statusCode: 200, duration: 50 } as ProxyResult);
            }, 50);
          });
        }
      );

      manager = new ConcurrencyManager(config, executor);

      await manager.submit(createMockTask("task1"));

      const stats = manager.getStats();
      expect(stats.totalProcessed).toBe(1);
      expect(stats.avgProcessTime).toBeGreaterThan(0);
      expect(stats.avgWaitTime).toBeGreaterThanOrEqual(0);
    });

    it("CM013: should track stats correctly for completed and failed tasks", async () => {
      // Simple test: just verify processed and failed counts work correctly
      // Use a simple executor that sometimes fails
      let callCount = 0;
      const executor = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ statusCode: 200 } as ProxyResult);
        } else if (callCount === 2) {
          return Promise.reject(new Error("Task failed"));
        }
        return Promise.resolve({ statusCode: 200 } as ProxyResult);
      });

      manager = new ConcurrencyManager(config, executor);

      // First task succeeds
      await manager.submit(createMockTask("task1"));

      // Second task fails
      await expect(manager.submit(createMockTask("task2"))).rejects.toThrow("Task failed");

      // Stats should reflect 1 processed, 1 failed
      const stats = manager.getStats();
      expect(stats.totalProcessed).toBe(1);
      expect(stats.totalFailed).toBe(1);
    });
  });

  describe("CM014: getProcessingTasks", () => {
    it("CM014: should return empty array when no tasks processing", () => {
      const executor = vi.fn().mockResolvedValue({ statusCode: 200 } as ProxyResult);
      manager = new ConcurrencyManager(config, executor);

      const processing = manager.getProcessingTasks();
      expect(processing).toEqual([]);
    });

    it("CM014: should return processing task info with elapsed time", async () => {
      let releaseTask: () => void;
      const blockingTask = new Promise<ProxyResult>(resolve => {
        releaseTask = () => resolve({ statusCode: 200 } as ProxyResult);
      });

      const executor = vi.fn().mockImplementation(() => blockingTask);
      manager = new ConcurrencyManager(config, executor);

      const p = manager.submit(createMockTask("task1"));

      await new Promise(r => setTimeout(r, 50));

      const processing = manager.getProcessingTasks();
      expect(processing.length).toBe(1);
      expect(processing[0].id).toBe("task1");
      expect(processing[0].elapsed).toBeGreaterThan(0);

      releaseTask!();
      await p;
    });
  });
});
