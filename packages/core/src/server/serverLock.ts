/**
 * Server lock management for multi-instance leader election using IPC
 *
 * Uses Unix domain sockets (Linux/Mac) or named pipes (Windows) for
 * true multi-process coordination without SQLite file locking issues.
 *
 * Architecture:
 * - The first instance becomes the IPC Server and creates the lock socket
 * - Subsequent instances connect as clients to query leadership
 * - Process alive check ensures stale locks are cleaned up
 */

import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "../utils/logger";
import type { ServerLockInfo } from "../types";

// Heartbeat timeout in milliseconds - leader must heartbeat within this window
const HEARTBEAT_TIMEOUT_MS = 10_000; // 10 seconds

// IPC socket path configuration
const LOCK_DIR = path.join(os.homedir(), ".ccrelay");
const IPC_SOCKET_PATH =
  os.platform() === "win32"
    ? `\\\\.\\pipe\\ccrelay-lock`
    : path.join(LOCK_DIR, "ccrelay-lock.sock");

// Connection timeout for IPC client
const IPC_CONNECT_TIMEOUT_MS = 500;

// Message types for IPC communication
type MessageType = "query" | "acquire" | "heartbeat" | "release" | "response" | "error";

interface IpcMessage {
  type: MessageType;
  instanceId?: string;
  pid?: number;
  port?: number;
  host?: string;
  startTime?: number;
  lastHeartbeat?: number;
  leader?: ServerLockInfo | null;
  error?: string;
  timestamp?: number;
}

/**
 * IPC-based server lock manager for multi-process coordination
 */
export class ServerLock {
  private ipcServer: net.Server | null = null;
  private isIpcServer: boolean = false;
  private currentLeader: ServerLockInfo | null = null;
  private log = Logger.getInstance();
  private instanceId: string;
  private initPromise: Promise<void> | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  // Track connected clients for heartbeat updates
  private clients: Set<net.Socket> = new Set();

  constructor() {
    this.instanceId = `Lock-${process.pid}-${Math.random().toString(36).substring(2, 6)}`;
  }

  /**
   * Initialize the server lock
   */
  async initialize(): Promise<void> {
    if (this.initPromise) {
      this.log.debug(
        `[ServerLock:${this.instanceId}] Initialization already in progress, waiting...`
      );
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInitialize(): Promise<void> {
    const startTime = Date.now();
    this.log.info(
      `[ServerLock:${this.instanceId}] ===== LOCK IPC INIT START ===== PID=${process.pid} at ${new Date().toISOString()}`
    );

    try {
      // Ensure lock directory exists
      if (!fs.existsSync(LOCK_DIR)) {
        fs.mkdirSync(LOCK_DIR, { recursive: true, mode: 0o700 });
      }

      // Try to become the IPC server
      const becameServer = await this.tryBecomeIpcServer();

      if (becameServer) {
        this.log.info(
          `[ServerLock:${this.instanceId}] Became IPC Server in ${Date.now() - startTime}ms`
        );
      } else {
        this.log.info(
          `[ServerLock:${this.instanceId}] Connected to existing IPC Server in ${Date.now() - startTime}ms`
        );
      }

      this.log.info(
        `[ServerLock:${this.instanceId}] ===== LOCK IPC INIT COMPLETE in ${Date.now() - startTime}ms =====`
      );
    } catch (err) {
      this.log.error(
        `[ServerLock:${this.instanceId}] Failed to initialize after ${Date.now() - startTime}ms`,
        err
      );
      throw err;
    }
  }

  /**
   * Try to become the IPC server (first instance wins)
   */
  private async tryBecomeIpcServer(): Promise<boolean> {
    return this.attemptListen(true);
  }

  /**
   * Attempt to create and listen on the IPC socket.
   * @param allowRetry If true, will probe and clean up stale sockets on EADDRINUSE
   */
  private attemptListen(allowRetry: boolean): Promise<boolean> {
    return new Promise(resolve => {
      const server = net.createServer({ allowHalfOpen: false }, (socket: net.Socket) => {
        this.log.debug(`[ServerLock:${this.instanceId}] IPC client connected`);
        this.clients.add(socket);

        socket.on("data", (data: Buffer) => {
          try {
            this.handleClientMessage(socket, data);
          } catch (err) {
            this.log.error("[ServerLock] Error handling client message", err);
          }
        });

        socket.on("error", err => {
          this.log.warn(`[ServerLock] Client socket error: ${err.message}`);
          this.clients.delete(socket);
        });

        socket.on("close", () => {
          this.log.debug(`[ServerLock:${this.instanceId}] IPC client disconnected`);
          this.clients.delete(socket);
        });
      });

      this.ipcServer = server;

      // Try to listen on the socket path
      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && allowRetry) {
          // Socket file exists - check if a real server is listening
          this.log.debug(
            `[ServerLock:${this.instanceId}] Socket file exists, probing to check if server is alive`
          );
          server.close();
          this.ipcServer = null;

          void this.probeExistingSocket().then(alive => {
            if (alive) {
              // Real IPC server is running, connect as client
              this.log.debug(
                `[ServerLock:${this.instanceId}] Existing IPC server is alive, connecting as client`
              );
              resolve(false);
            } else {
              // Stale socket file - remove and retry
              this.log.info(
                `[ServerLock:${this.instanceId}] Stale socket file detected, removing and retrying`
              );
              this.removeStaleSocket();
              // Retry once without allowing further retries
              void this.attemptListen(false).then(resolve);
            }
          });
        } else if (err.code === "EADDRINUSE") {
          // Retry already failed, give up
          this.log.warn(
            `[ServerLock:${this.instanceId}] Socket still in use after cleanup, connecting as client`
          );
          server.close();
          this.ipcServer = null;
          resolve(false);
        } else {
          this.log.error(`[ServerLock] IPC server error: ${err.message}`);
          server.close();
          this.ipcServer = null;
          resolve(false);
        }
      });

      server.listen(IPC_SOCKET_PATH, () => {
        // Successfully created server
        this.isIpcServer = true;

        // Set proper permissions on Unix socket
        if (os.platform() !== "win32") {
          try {
            fs.chmodSync(IPC_SOCKET_PATH, 0o600);
          } catch (err) {
            this.log.warn(`[ServerLock] Failed to set socket permissions: ${String(err)}`);
          }
        }

        this.log.info(`[ServerLock:${this.instanceId}] IPC Server listening on ${IPC_SOCKET_PATH}`);
        resolve(true);
      });
    });
  }

  /**
   * Probe the existing socket to check if a real IPC server is listening.
   * Returns true if a server responds, false if connection is refused (stale socket).
   */
  private probeExistingSocket(): Promise<boolean> {
    return new Promise(resolve => {
      const client = net.createConnection({ path: IPC_SOCKET_PATH });

      const timeout = setTimeout(() => {
        client.destroy();
        resolve(false);
      }, IPC_CONNECT_TIMEOUT_MS);

      client.on("connect", () => {
        clearTimeout(timeout);
        client.destroy();
        resolve(true);
      });

      client.on("error", () => {
        clearTimeout(timeout);
        client.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Remove a stale socket file from the filesystem.
   */
  private removeStaleSocket(): void {
    if (os.platform() === "win32") {
      return; // Named pipes don't need manual cleanup on Windows
    }
    try {
      if (fs.existsSync(IPC_SOCKET_PATH)) {
        fs.unlinkSync(IPC_SOCKET_PATH);
        this.log.info(
          `[ServerLock:${this.instanceId}] Removed stale socket file: ${IPC_SOCKET_PATH}`
        );
      }
    } catch (err) {
      this.log.warn(
        `[ServerLock:${this.instanceId}] Failed to remove stale socket: ${String(err)}`
      );
    }
  }

  /**
   * Handle messages from IPC clients
   */
  private handleClientMessage(socket: net.Socket, data: Buffer): void {
    try {
      const message: IpcMessage = JSON.parse(data.toString()) as IpcMessage;

      switch (message.type) {
        case "query":
          this.sendToClient(socket, {
            type: "response",
            leader: this.currentLeader,
            timestamp: Date.now(),
          });
          break;

        case "acquire":
          this.handleAcquireMessage(socket, message);
          break;

        case "heartbeat":
          this.handleHeartbeatMessage(socket, message);
          break;

        case "release":
          this.handleReleaseMessage(socket, message);
          break;

        default:
          this.sendToClient(socket, {
            type: "error",
            error: `Unknown message type: ${message.type}`,
          });
      }
    } catch (err) {
      this.sendToClient(socket, {
        type: "error",
        error: `Message parse error: ${String(err)}`,
      });
    }
  }

  /**
   * Handle lock acquire request
   */
  private handleAcquireMessage(socket: net.Socket, message: IpcMessage): void {
    if (!this.currentLeader) {
      // No leader yet, grant lock
      if (message.instanceId && message.port && message.host) {
        this.currentLeader = {
          instanceId: message.instanceId,
          pid: message.pid ?? process.pid,
          port: message.port,
          host: message.host,
          startTime: message.startTime ?? Date.now(),
          lastHeartbeat: message.lastHeartbeat ?? Date.now(),
        };
        this.log.info(
          `[ServerLock] Lock acquired by ${this.currentLeader.instanceId} at ${this.currentLeader.host}:${this.currentLeader.port}`
        );
        this.sendToClient(socket, {
          type: "response",
          leader: this.currentLeader,
        });
      }
    } else {
      // Check if current leader is still valid
      const now = Date.now();
      if (now - this.currentLeader.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        // Current leader is dead (heartbeat timeout), release and grant to new requester
        this.log.info(
          `[ServerLock] Previous leader ${this.currentLeader.instanceId} heartbeat timed out, releasing lock`
        );
        this.currentLeader = null;

        if (message.instanceId && message.port && message.host) {
          this.currentLeader = {
            instanceId: message.instanceId,
            pid: message.pid ?? process.pid,
            port: message.port,
            host: message.host,
            startTime: message.startTime ?? Date.now(),
            lastHeartbeat: message.lastHeartbeat ?? Date.now(),
          };
          this.log.info(
            `[ServerLock] Lock acquired by ${this.currentLeader.instanceId} at ${this.currentLeader.host}:${this.currentLeader.port}`
          );
        }
        this.sendToClient(socket, {
          type: "response",
          leader: this.currentLeader,
        });
      } else {
        // Current leader is valid, deny request
        this.sendToClient(socket, {
          type: "response",
          leader: this.currentLeader,
        });
      }
    }
  }

  /**
   * Handle heartbeat update
   */
  private handleHeartbeatMessage(socket: net.Socket, message: IpcMessage): void {
    if (this.currentLeader && message.instanceId === this.currentLeader.instanceId) {
      this.currentLeader.lastHeartbeat = message.lastHeartbeat ?? Date.now();
      this.sendToClient(socket, {
        type: "response",
        leader: this.currentLeader,
      });
    } else {
      this.sendToClient(socket, {
        type: "error",
        error: "Not the current leader",
      });
    }
  }

  /**
   * Handle lock release
   */
  private handleReleaseMessage(socket: net.Socket, message: IpcMessage): void {
    if (this.currentLeader && message.instanceId === this.currentLeader.instanceId) {
      this.log.info(`[ServerLock] Lock released by ${this.currentLeader.instanceId}`);
      this.currentLeader = null;
      this.sendToClient(socket, {
        type: "response",
        leader: null,
      });
    } else {
      this.sendToClient(socket, {
        type: "error",
        error: "Not the lock holder",
      });
    }
  }

  /**
   * Send message to IPC client
   */
  private sendToClient(socket: net.Socket, message: IpcMessage): void {
    try {
      socket.write(JSON.stringify(message) + "\n");
    } catch (err) {
      this.log.error("[ServerLock] Failed to send to client", err);
    }
  }

  /**
   * Send message to IPC server and wait for response
   */
  private async sendToServer(
    message: IpcMessage,
    timeout: number = IPC_CONNECT_TIMEOUT_MS
  ): Promise<IpcMessage> {
    return new Promise((resolve, reject) => {
      const client = net.createConnection({ path: IPC_SOCKET_PATH });

      let responseData = "";
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          client.destroy();
        }
      };

      client.on("connect", () => {
        client.write(JSON.stringify(message) + "\n");
      });

      client.on("data", (data: Buffer) => {
        responseData += data.toString();

        // Try to parse complete messages (separated by newlines)
        const lines = responseData.split("\n");
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response: IpcMessage = JSON.parse(line) as IpcMessage;
              if (!resolved) {
                resolved = true;
                client.destroy();
                resolve(response);
              }
              break;
            } catch {
              // Incomplete message, wait for more data
            }
          }
        }
      });

      client.on("error", err => {
        cleanup();
        reject(new Error(`IPC connection error: ${err.message}`));
      });

      client.on("close", () => {
        cleanup();
        if (!resolved) {
          reject(new Error("IPC connection closed without response"));
        }
      });

      setTimeout(() => {
        cleanup();
        reject(new Error(`IPC timeout after ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Try to acquire the server lock
   * Returns true if lock was acquired, false if lock is held by another instance
   */
  async tryAclock(instanceId: string, port: number, host: string): Promise<boolean> {
    const acquireStart = Date.now();
    const now = Date.now();

    this.log.info(
      `[ServerLock:${this.instanceId}] Attempting to acquire lock for instance ${instanceId} on ${host}:${port}`
    );

    try {
      if (this.isIpcServer) {
        // We are the IPC server, check locally
        if (!this.currentLeader) {
          this.currentLeader = {
            instanceId,
            pid: process.pid,
            port,
            host,
            startTime: now,
            lastHeartbeat: now,
          };
          this.log.info(
            `[ServerLock:${this.instanceId}] Lock acquired locally by ${instanceId} in ${Date.now() - acquireStart}ms`
          );
          return true;
        } else {
          // Check if current leader is dead
          if (now - this.currentLeader.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
            this.log.info(`[ServerLock:${this.instanceId}] Current leader is dead, taking over`);
            this.currentLeader = {
              instanceId,
              pid: process.pid,
              port,
              host,
              startTime: now,
              lastHeartbeat: now,
            };
            return true;
          }
          this.log.info(
            `[ServerLock:${this.instanceId}] Lock already held by ${this.currentLeader.instanceId}`
          );
          return false;
        }
      } else {
        // We are a client, send acquire request to IPC server
        try {
          const response = await this.sendToServer(
            {
              type: "acquire",
              instanceId,
              pid: process.pid,
              port,
              host,
              startTime: now,
              lastHeartbeat: now,
            },
            2000
          );

          if (response.leader && response.leader.instanceId === instanceId) {
            this.log.info(
              `[ServerLock:${this.instanceId}] Lock acquired via IPC by ${instanceId} in ${Date.now() - acquireStart}ms`
            );
            // Store locally for quick access
            this.currentLeader = response.leader;
            return true;
          } else {
            this.log.info(
              `[ServerLock:${this.instanceId}] Lock held by ${response.leader?.instanceId || "unknown"} in ${Date.now() - acquireStart}ms`
            );
            this.currentLeader = response.leader ?? null;
            return false;
          }
        } catch (err) {
          // IPC communication failed - server might be down
          this.log.warn(`[ServerLock:${this.instanceId}] IPC communication failed: ${String(err)}`);
          return false;
        }
      }
    } catch (err) {
      const duration = Date.now() - acquireStart;
      this.log.warn(
        `[ServerLock:${this.instanceId}] Lock acquisition error for instance ${instanceId} in ${duration}ms: ${String(err)}`
      );

      // If IPC failed, it likely means the server is dead or unreachable
      // We should attempt to become the server ourselves
      const errorMsg = String(err);
      if (
        errorMsg.includes("IPC connection error") ||
        errorMsg.includes("ECONNREFUSED") ||
        errorMsg.includes("ENOENT")
      ) {
        this.log.info(
          `[ServerLock:${this.instanceId}] IPC server unreachable, attempting to take over as server...`
        );
        try {
          const becameServer = await this.tryBecomeIpcServer();
          if (becameServer) {
            this.log.info(
              `[ServerLock:${this.instanceId}] Successfully became IPC server, retrying lock acquisition locally`
            );
            // Recursively retry acquisition (will now use local logic since isIpcServer is true)
            return this.tryAclock(instanceId, port, host);
          } else {
            this.log.info(
              `[ServerLock:${this.instanceId}] Failed to become IPC server (another instance might have won), returning false`
            );
            return false;
          }
        } catch (serverErr) {
          this.log.error(
            `[ServerLock:${this.instanceId}] Error while trying to become IPC server`,
            serverErr
          );
          return false;
        }
      }

      return false;
    }
  }

  /**
   * Release the server lock for this instance
   */
  async release(instanceId: string): Promise<void> {
    if (this.isIpcServer) {
      // We are the server, release locally
      if (this.currentLeader && this.currentLeader.instanceId === instanceId) {
        this.log.info(`[ServerLock] Lock released locally by instance ${instanceId}`);
        this.currentLeader = null;
      }
    } else {
      // Send release request to IPC server
      try {
        await this.sendToServer({
          type: "release",
          instanceId,
        });
        this.currentLeader = null;
        this.log.info(`[ServerLock] Lock released by instance ${instanceId}`);
      } catch (err) {
        this.log.error(`[ServerLock] Failed to release lock for instance ${instanceId}`, err);
      }
    }
  }

  /**
   * Update heartbeat timestamp for this instance
   */
  async updateHeartbeat(instanceId: string): Promise<void> {
    const now = Date.now();

    if (this.isIpcServer) {
      // We are the server, update locally
      if (this.currentLeader && this.currentLeader.instanceId === instanceId) {
        this.currentLeader.lastHeartbeat = now;
      }
    } else {
      // Send heartbeat update to IPC server
      try {
        const response = await this.sendToServer({
          type: "heartbeat",
          instanceId,
          lastHeartbeat: now,
        });
        if (response.leader) {
          this.currentLeader = response.leader;
        }
      } catch (err) {
        this.log.error(`[ServerLock] Failed to update heartbeat for instance ${instanceId}`, err);
      }
    }
  }

  /**
   * Get the current leader information
   * Returns null if no valid leader exists
   */
  async getCurrentLeader(): Promise<ServerLockInfo | null> {
    const now = Date.now();

    if (this.isIpcServer) {
      // We are the server, return local data
      if (this.currentLeader) {
        // Check if heartbeat is stale
        if (now - this.currentLeader.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
          this.log.info(
            `[ServerLock] Leader ${this.currentLeader.instanceId} has stale heartbeat (age: ${now - this.currentLeader.lastHeartbeat}ms)`
          );
          return null;
        }

        return this.currentLeader;
      }
      return null;
    } else {
      // Query from IPC server
      try {
        const response = await this.sendToServer({
          type: "query",
        });

        if (response.leader) {
          // Validate leader info
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Optional property access
          if (now - response.leader.lastHeartbeat! > HEARTBEAT_TIMEOUT_MS) {
            this.log.info(`[ServerLock] Leader ${response.leader.instanceId} has stale heartbeat`);
            return null;
          }

          this.currentLeader = response.leader;
          return response.leader;
        }
        return null;
      } catch (err) {
        // Check for connection errors - implies server is down/gone
        const errorMsg = String(err);
        if (
          errorMsg.includes("ECONNREFUSED") ||
          errorMsg.includes("ENOENT") ||
          errorMsg.includes("IPC connection closed")
        ) {
          this.log.info(
            `[ServerLock] Leader unreachable (connection failed), assuming dead. Error: ${errorMsg}`
          );
          this.currentLeader = null;
          return null;
        }

        this.log.error("[ServerLock] Failed to get current leader", err);

        // Check if cached leader is stale
        if (this.currentLeader) {
          if (now - this.currentLeader.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
            this.log.info(
              `[ServerLock] Cached leader ${this.currentLeader.instanceId} is stale (age: ${now - this.currentLeader.lastHeartbeat}ms), assuming dead`
            );
            this.currentLeader = null;
            return null;
          }
        }

        return this.currentLeader; // Return cached if IPC fails but not stale
      }
    }
  }

  /**
   * Clean up stale locks (heartbeat timeout or dead processes)
   * Note: This is now mostly handled by getCurrentLeader automatically
   */
  async cleanupStaleLocks(): Promise<void> {
    const now = Date.now();

    if (this.isIpcServer && this.currentLeader) {
      if (now - this.currentLeader.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        this.log.info(`[ServerLock] Cleaning up stale lock for ${this.currentLeader.instanceId}`);
        this.currentLeader = null;
      }
    } else if (!this.isIpcServer) {
      // Trigger cleanup on server side by querying
      try {
        await this.sendToServer({ type: "query" });
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Check if this instance holds the lock
   */
  async isHolder(instanceId: string): Promise<boolean> {
    const leader = await this.getCurrentLeader();
    return leader !== null && leader.instanceId === instanceId;
  }

  /**
   * Close the IPC server connection
   */
  async close(): Promise<void> {
    // Stop heartbeat timer
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Close all client connections
    for (const client of this.clients) {
      try {
        client.destroy();
      } catch {
        // Ignore
      }
    }
    this.clients.clear();

    // Close IPC server
    if (this.ipcServer) {
      return new Promise(resolve => {
        this.ipcServer!.close(() => {
          this.log.info("[ServerLock] IPC Server closed");

          // Clean up socket file on Unix
          if (os.platform() !== "win32") {
            try {
              if (fs.existsSync(IPC_SOCKET_PATH)) {
                fs.unlinkSync(IPC_SOCKET_PATH);
              }
            } catch (err) {
              this.log.warn(`[ServerLock] Failed to remove socket file: ${String(err)}`);
            }
          }

          this.ipcServer = null;
          this.isIpcServer = false;
          resolve();
        });
      });
    }
  }
}

// Singleton instance
let lockInstance: ServerLock | null = null;

export function getServerLock(): ServerLock {
  if (!lockInstance) {
    lockInstance = new ServerLock();
  }
  return lockInstance;
}
