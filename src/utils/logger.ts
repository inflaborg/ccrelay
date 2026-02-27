/**
 * Logger for CCRelay with output channel support
 * Supports both VSCode environment and Worker threads
 */

// Check if vscode is available (not available in worker threads)
let vscode: typeof import("vscode") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  vscode = require("vscode") as typeof import("vscode");
} catch {
  // vscode not available (worker thread)
}

export enum LogLevel {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  DEBUG = 0,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  INFO = 1,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  WARN = 2,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  ERROR = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  DEBUG: LogLevel.DEBUG,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  INFO: LogLevel.INFO,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  WARN: LogLevel.WARN,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  ERROR: LogLevel.ERROR,
};

// Type definition for build config
interface BuildConfig {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  DEFAULT_LOG_LEVEL: string;
}

// Import build config if available, otherwise use defaults
function getDefaultLogLevel(): LogLevel {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const buildConfig = require("../config/build-config.generated") as BuildConfig;
    const level = LOG_LEVEL_MAP[buildConfig.DEFAULT_LOG_LEVEL];
    return level ?? LogLevel.DEBUG;
  } catch {
    // Fallback to DEBUG when build config is not available (development mode)
    return LogLevel.DEBUG;
  }
}

// Type for VSCode OutputChannel (minimal interface we need)
interface OutputChannel {
  appendLine(value: string): void;
  clear(): void;
  show(): void;
  dispose(): void;
}

export class Logger {
  private static instance: Logger | null = null;
  private outputChannel: OutputChannel | null = null;
  private logBuffer: string[] = [];
  private maxBufferSize = 1000;
  private minLevel: LogLevel = getDefaultLogLevel();

  private isDisposed: boolean = false;

  private constructor() {
    if (vscode) {
      try {
        this.outputChannel = vscode.window.createOutputChannel("CCRelay");
      } catch (err) {
        console.error("[CCRelay] Failed to create output channel", err);
      }
    }
    // If vscode not available, we'll just use console (worker thread)
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level];
    return `[${timestamp}] [${levelName}] ${message}`;
  }

  private log(level: LogLevel, message: string): void {
    if (level < this.minLevel) {
      return;
    }

    const formatted = this.formatMessage(level, message);
    this.logBuffer.push(formatted);

    // Keep buffer size under limit
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    // Output to VSCode channel or console (for worker threads)
    if (this.outputChannel && !this.isDisposed) {
      try {
        this.outputChannel.appendLine(formatted);
      } catch (error) {
        // If the channel is closed or disposed, we can't do much but maybe log to console
        // This prevents the "Channel has been closed" error from crashing/polluting the extension host logs
        // Only log once to avoid spamming console
        if (!this.isDisposed) {
          console.error(
            `[CCRelay Logger Error] Failed to write to output channel: ${String(error)}`
          );
          this.isDisposed = true; // Mark as disposed on first error to stop trying
        }
      }
    } else if (!this.outputChannel) {
      // Worker thread: use console output
      switch (level) {
        case LogLevel.ERROR:
          console.error(formatted);
          break;
        case LogLevel.WARN:
          console.warn(formatted);
          break;
        default:
          console.log(formatted);
      }
    }
  }

  debug(message: string): void {
    this.log(LogLevel.DEBUG, message);
  }

  info(message: string): void {
    this.log(LogLevel.INFO, message);
  }

  warn(message: string): void {
    this.log(LogLevel.WARN, message);
  }

  error(message: string, error?: unknown): void {
    let msg = message;
    if (error) {
      if (error instanceof Error) {
        msg += `: ${error.message}`;
        if (error.stack) {
          msg += `\n${error.stack}`;
        }
      } else if (typeof error === "string") {
        msg += `: ${error}`;
      } else if (
        typeof error === "number" ||
        typeof error === "boolean" ||
        typeof error === "undefined"
      ) {
        msg += `: ${String(error)}`;
      } else if (error !== null) {
        // For non-Error objects (arrays, plain objects, etc.)
        try {
          msg += `: ${JSON.stringify(error)}`;
        } catch {
          msg += `: [object]`;
        }
      }
    }
    this.log(LogLevel.ERROR, msg);
  }

  /**
   * Show the output channel
   */
  show(): void {
    this.outputChannel?.show();
  }

  /**
   * Clear the log buffer and output channel
   */
  clear(): void {
    this.logBuffer = [];
    this.outputChannel?.clear();
  }

  /**
   * Get recent log entries
   */
  getRecentLogs(count: number = 100): string[] {
    return this.logBuffer.slice(-count);
  }

  dispose(): void {
    this.isDisposed = true;
    if (this.outputChannel) {
      try {
        this.outputChannel.dispose();
      } catch {
        // Ignore disposal errors
      }
      this.outputChannel = null;
    }
  }
}

/**
 * Create a scoped logger with a prefix
 */
export class ScopedLogger {
  private logger: Logger;
  private prefix: string;

  constructor(prefix: string) {
    this.logger = Logger.getInstance();
    this.prefix = prefix;
  }

  private format(message: string): string {
    return `[${this.prefix}] ${message}`;
  }

  debug(message: string): void {
    this.logger.debug(this.format(message));
  }

  info(message: string): void {
    this.logger.info(this.format(message));
  }

  warn(message: string): void {
    this.logger.warn(this.format(message));
  }

  error(message: string, err?: unknown): void {
    this.logger.error(this.format(message), err);
  }
}
