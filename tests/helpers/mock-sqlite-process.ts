import { EventEmitter } from "events";
import { vi } from "vitest";
import type { Mock } from "vitest";

type StdinWriteMock = Mock<(chunk: string) => boolean>;
type VoidMock = Mock<() => void>;
type EventCallbackMock = Mock<(event: string, listener: (arg?: unknown) => void) => void>;
type OnceCallbackMock = Mock<(event: string, listener: () => void) => void>;

export type MockProcess = {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: StdinWriteMock; end: VoidMock };
  kill: VoidMock;
  on: EventCallbackMock;
  once: OnceCallbackMock;
};

type ResponseEntry = {
  data?: object[];
  error?: string;
};

/**
 * MockSqliteProcess - A helper class for mocking sqlite3 CLI process in tests.
 *
 * This class automatically handles stdin.write calls by extracting the sentinel
 * and emitting appropriate responses on stdout/stderr, eliminating the need for
 * setTimeout-based timing in tests.
 */
export class MockSqliteProcess {
  private responseQueue: ResponseEntry[] = [];
  private autoResponseEnabled = true;

  readonly stdout: EventEmitter;
  readonly stderr: EventEmitter;
  readonly stdin: { write: StdinWriteMock; end: VoidMock };
  readonly kill: VoidMock;
  readonly on: EventCallbackMock;
  readonly once: OnceCallbackMock;

  constructor() {
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = {
      write: vi.fn((chunk: string): boolean => {
        this.handleWrite(chunk);
        return true;
      }),
      end: vi.fn(),
    };
    this.kill = vi.fn();
    this.on = vi.fn();
    this.once = vi.fn();
  }

  /**
   * Disable automatic response on write. Useful for error testing.
   */
  disableAutoResponse(): this {
    this.autoResponseEnabled = false;
    return this;
  }

  /**
   * Enable automatic response on write.
   */
  enableAutoResponse(): this {
    this.autoResponseEnabled = true;
    return this;
  }

  /**
   * Queue a successful response to be sent on the next write.
   */
  queueResponse(data: object[]): this {
    this.responseQueue.push({ data });
    return this;
  }

  /**
   * Queue an error response to be sent on the next write.
   */
  queueError(errorMsg: string): this {
    this.responseQueue.push({ error: errorMsg });
    return this;
  }

  /**
   * Queue multiple responses at once.
   */
  queueResponses(responses: object[][]): this {
    for (const data of responses) {
      this.responseQueue.push({ data });
    }
    return this;
  }

  /**
   * Get the mock process object compatible with childProcess.ChildProcess.
   */
  getMockProcess(): MockProcess {
    return {
      stdout: this.stdout,
      stderr: this.stderr,
      stdin: this.stdin,
      kill: this.kill,
      on: this.on,
      once: this.once,
    };
  }

  /**
   * Get all write calls made to stdin.
   */
  getWriteCalls(): string[] {
    return this.stdin.write.mock.calls.map((call: unknown[]) => call[0] as string);
  }

  /**
   * Get the last write call made to stdin.
   */
  getLastWriteCall(): string | undefined {
    const calls = this.getWriteCalls();
    return calls.length > 0 ? calls[calls.length - 1] : undefined;
  }

  /**
   * Extract sentinel from a write call.
   */
  static extractSentinel(writeCall: string): string | null {
    const match = /SELECT '(__SENTINEL_[^']+)' as _s/.exec(writeCall);
    return match ? match[1] : null;
  }

  /**
   * Manually emit data to stdout (for testing chunked/split data scenarios).
   */
  emitStdout(data: string): void {
    this.stdout.emit("data", Buffer.from(data));
  }

  /**
   * Manually emit data to stderr (for error scenarios).
   */
  emitStderr(data: string): void {
    this.stderr.emit("data", Buffer.from(data));
  }

  /**
   * Clear all mocks and reset state.
   */
  reset(): void {
    this.responseQueue = [];
    this.stdin.write.mockClear();
    this.stdin.end.mockClear();
    this.kill.mockClear();
    this.on.mockClear();
    this.once.mockClear();
  }

  private handleWrite(chunk: string): void {
    const sentinel = MockSqliteProcess.extractSentinel(chunk);
    if (!sentinel) {
      return;
    }

    // Skip auto-response if disabled
    if (!this.autoResponseEnabled) {
      return;
    }

    const response = this.responseQueue.shift();

    // Use setImmediate to ensure async behavior without arbitrary delays
    setImmediate(() => {
      if (response?.error) {
        this.stderr.emit("data", Buffer.from(response.error));
      } else {
        this.emitSuccessResponse(sentinel, response?.data ?? []);
      }
    });
  }

  private emitSuccessResponse(sentinel: string, data: object[]): void {
    // SQLite json mode outputs each SELECT as a JSON array
    // Format: [{"col":val}]\n
    // Followed by sentinel: [{"_s":"sentinel"}]\n
    let output = "";
    if (data.length > 0) {
      output = `${JSON.stringify(data)}\n`;
    }
    output += `[{"_s":"${sentinel}"}]\n`;
    this.stdout.emit("data", Buffer.from(output));
  }
}
