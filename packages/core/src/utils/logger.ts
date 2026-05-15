/**
 * Logger for CCRelay with output channel support
 * Supports both VSCode environment and Worker threads
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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

/** Retention for daily runtime log files under {@link getLogDir} (UTC calendar days). */
const RUNTIME_LOG_RETENTION_DAYS = 7;

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Directory for CCRelay **runtime** text logs (`ccrelay-YYYY-MM-DD.log`).
 * This is separate from `~/.ccrelay/logs.db`, which stores proxied **request/response** rows for the dashboard.
 */
export function getLogDir(): string {
  return path.join(os.homedir(), ".ccrelay", "logs");
}

function isNodeMainThread(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wt = require("worker_threads") as typeof import("worker_threads");
    return wt.isMainThread;
  } catch {
    return true;
  }
}

/**
 * Append-only daily log files with rotation (UTC) and old-file cleanup.
 * Disabled in Node worker threads to avoid concurrent writers on the same files.
 */
class FileTransport {
  private stream: fs.WriteStream | null = null;
  private currentDate = "";
  private readonly logDir = getLogDir();
  private writeFailedLogged = false;

  write(line: string): void {
    try {
      this.ensureStream();
      if (this.stream && !this.stream.destroyed) {
        this.stream.write(`${line}\n`, err => {
          if (err && !this.writeFailedLogged) {
            this.writeFailedLogged = true;
            console.error("[CCRelay] File log write failed:", err.message);
          }
        });
      }
    } catch (e) {
      if (!this.writeFailedLogged) {
        this.writeFailedLogged = true;
        console.error("[CCRelay] File log transport error:", e);
      }
    }
  }

  private ensureStream(): void {
    const today = utcDateString(new Date());
    if (this.stream && !this.stream.destroyed && today === this.currentDate) {
      return;
    }

    fs.mkdirSync(this.logDir, { recursive: true });
    this.cleanupOldLogs();

    if (this.stream && !this.stream.destroyed) {
      this.stream.end();
    }

    this.currentDate = today;
    const filePath = path.join(this.logDir, `ccrelay-${today}.log`);
    this.stream = fs.createWriteStream(filePath, { flags: "a" });
  }

  private cleanupOldLogs(): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.logDir);
    } catch {
      return;
    }

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - RUNTIME_LOG_RETENTION_DAYS);
    const cutoffStr = utcDateString(cutoff);

    for (const name of entries) {
      const m = /^ccrelay-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
      if (!m) {
        continue;
      }
      const fileDay = m[1];
      if (fileDay < cutoffStr) {
        try {
          fs.unlinkSync(path.join(this.logDir, name));
        } catch {
          /* ignore */
        }
      }
    }
  }

  dispose(): void {
    if (this.stream && !this.stream.destroyed) {
      this.stream.end();
    }
    this.stream = null;
  }
}

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
  private readonly fileTransport: FileTransport | null;

  private constructor() {
    this.fileTransport = isNodeMainThread() ? new FileTransport() : null;

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

    this.fileTransport?.write(formatted);

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
    this.fileTransport?.dispose();
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
