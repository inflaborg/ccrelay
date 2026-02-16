/**
 * Test helpers for integration tests
 */

/* eslint-disable @typescript-eslint/naming-convention */
// External API fields use snake_case

import type { QueueStats, ConcurrencyConfig, Provider } from "../../../src/types";

/**
 * Wait for a specific queue state
 */
export async function waitForQueueState(
  getStats: () => QueueStats,
  predicate: (stats: QueueStats) => boolean,
  options: { timeout?: number; interval?: number } = {}
): Promise<QueueStats> {
  const timeout = options.timeout ?? 5000;
  const interval = options.interval ?? 50;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const stats = getStats();
      if (predicate(stats)) {
        resolve(stats);
      } else if (Date.now() - start > timeout) {
        reject(new Error(`Timeout waiting for queue state. Current: ${JSON.stringify(stats)}`));
      } else {
        setTimeout(check, interval);
      }
    };
    check();
  });
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const timeout = options.timeout ?? 5000;
  const interval = options.interval ?? 50;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      Promise.resolve(condition())
        .then(result => {
          if (result) {
            resolve();
          } else if (Date.now() - start > timeout) {
            reject(new Error("Timeout waiting for condition"));
          } else {
            setTimeout(check, interval);
          }
        })
        .catch(err => {
          if (Date.now() - start > timeout) {
            reject(err instanceof Error ? err : new Error(String(err)));
          } else {
            setTimeout(check, interval);
          }
        });
    };
    void check();
  });
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a test provider configuration
 */
export function createTestProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "test-provider",
    name: "Test Provider",
    baseUrl: "http://127.0.0.1:9999", // Will be overridden by mock
    mode: "passthrough",
    providerType: "anthropic",
    apiKey: "test-api-key",
    ...overrides,
  };
}

/**
 * Create a test concurrency configuration
 */
export function createTestConcurrencyConfig(
  overrides: Partial<ConcurrencyConfig> = {}
): ConcurrencyConfig {
  return {
    enabled: true,
    maxWorkers: 3,
    maxQueueSize: 10,
    requestTimeout: 5, // 5 seconds (note: timeout is now in seconds, not ms)
    ...overrides,
  };
}

/**
 * Create an Anthropic-style request body
 */
export function createAnthropicRequest(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    model: "claude-3-sonnet-20240229",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
    stream: false,
    ...overrides,
  };
}

/**
 * Create an SSE chunk
 */
export function createSSEChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Create SSE chunks for a complete streaming response
 */
export function createSSEStreamChunks(
  content: string,
  options: { model?: string; messageId?: string } = {}
): string[] {
  const model = options.model ?? "claude-3-sonnet-20240229";
  const messageId = options.messageId ?? "msg_test123";

  return [
    createSSEChunk("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
      },
    }),
    createSSEChunk("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    createSSEChunk("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: content },
    }),
    createSSEChunk("content_block_stop", {
      type: "content_block_stop",
      index: 0,
    }),
    createSSEChunk("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
    }),
    createSSEChunk("message_stop", {
      type: "message_stop",
    }),
  ];
}

/**
 * Assert that a response has the expected status code
 */
export function assertStatus(
  res: { status: number },
  expected: number,
  message?: string
): void {
  if (res.status !== expected) {
    throw new Error(
      message ?? `Expected status ${expected}, got ${res.status}`
    );
  }
}

/**
 * Assert that a response body contains an error matching a pattern
 */
export function assertErrorMatch(
  res: { body: { error?: string; code?: string } },
  pattern: RegExp
): void {
  if (!res.body.error && !res.body.code) {
    throw new Error(`Response has no error field: ${JSON.stringify(res.body)}`);
  }
  const errorText = res.body.error ?? res.body.code ?? "";
  if (!pattern.test(errorText)) {
    throw new Error(
      `Error "${errorText}" does not match pattern ${pattern.toString()}`
    );
  }
}

/**
 * Track AbortController state for testing
 */
export class AbortTracker {
  public aborted = false;
  public abortReason: unknown = undefined;

  track(controller: AbortController): void {
    const originalAbort = controller.abort.bind(controller);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const tracker = this;
    controller.abort = function (reason?: unknown) {
      tracker.aborted = true;
      tracker.abortReason = reason;
      return originalAbort(reason);
    };
  }

  reset(): void {
    this.aborted = false;
    this.abortReason = undefined;
  }
}

/**
 * Wait for multiple conditions in parallel
 */
export async function waitForAll(
  conditions: Array<() => boolean | Promise<boolean>>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 10000, interval = 50 } = options;

  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      void (async () => {
        try {
          const results = await Promise.all(
            conditions.map(c => Promise.resolve(c()))
          );
          if (results.every(Boolean)) {
            resolve();
          } else if (Date.now() - start > timeout) {
            const indices = results.map((r, i) => (r ? -1 : i)).filter(i => i >= 0);
            reject(new Error(`Timeout waiting for conditions [${indices.join(", ")}]`));
          } else {
            setTimeout(check, interval);
          }
        } catch (err) {
          if (Date.now() - start > timeout) {
            reject(err instanceof Error ? err : new Error(String(err)));
          } else {
            setTimeout(check, interval);
          }
        }
      })();
    };

    check();
  });
}

/**
 * Create a promise that resolves when an event is emitted
 */
export function waitForEvent<T = unknown>(
  emitter: { on: (event: string, listener: (data: T) => void) => void; removeListener: (event: string, listener: (data: T) => void) => void },
  eventName: string,
  timeout = 10000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeListener(eventName, listener);
      reject(new Error(`Timeout waiting for event "${eventName}"`));
    }, timeout);

    const listener = (data: T) => {
      clearTimeout(timer);
      emitter.removeListener(eventName, listener);
      resolve(data);
    };

    emitter.on(eventName, listener);
  });
}

/**
 * Retry an action until it succeeds or times out
 */
export async function retryUntil<T>(
  action: () => T | Promise<T>,
  predicate: (result: T) => boolean,
  options: { timeout?: number; interval?: number } = {}
): Promise<T> {
  const { timeout = 10000, interval = 100 } = options;
  const start = Date.now();

  let result = await action();
  while (!predicate(result)) {
    if (Date.now() - start > timeout) {
      throw new Error("Timeout in retryUntil");
    }
    await sleep(interval);
    result = await action();
  }
  return result;
}
