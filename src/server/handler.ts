/**
 * HTTP server for CCRelay API proxy
 * Supports Leader/Follower mode for multi-instance coordination
 */

// External API fields use snake_case (Content-Type, Access-Control-Allow-Origin, etc.)

import * as http from "http";
import * as url from "url";
import { Router } from "./router";
import { ConfigManager } from "../config";
import {
  InstanceRole,
  RoleChangeInfo,
  ElectionState,
  RequestTask,
  ProxyResult,
  QueueStats,
} from "../types";
import { ScopedLogger } from "../utils/logger";
import { getDatabase, LogDatabase } from "../database";
import { LeaderElection } from "./leaderElection";
import { isStaticRequest, serveStatic } from "./static";
import { isApiRequest, handleApiRequest } from "../api";
import { ProxyExecutor } from "./proxy/executor";
import { QueueManager } from "./queueManager";
import { ResponseLogger } from "./responseLogger";
import { RequestHandler } from "./request";

export class ProxyServer {
  private server: http.Server | null = null;
  private config: ConfigManager;
  private router: Router;
  private isRunning: boolean = false;
  private log = new ScopedLogger("Server");
  private database: LogDatabase;
  private instanceId: string;

  // Leader election
  private leaderElection: LeaderElection | null = null;
  private role: InstanceRole = "standalone";
  private leaderUrl: string | null = null;

  // Lock to prevent duplicate server startups
  private serverStartInProgress: boolean = false;

  // Client for follower mode
  private httpClient: http.Agent | null = null;

  // Queue manager for concurrency control
  private queueManager: QueueManager;

  // Response logger
  private responseLogger: ResponseLogger;

  // Proxy executor
  private proxyExecutor: ProxyExecutor;

  // Role change callbacks for external listeners (e.g., StatusBarManager)
  private roleChangeCallbacks: Set<(info: RoleChangeInfo) => void> = new Set();

  constructor(config: ConfigManager, leaderElection: LeaderElection | null = null) {
    this.config = config;
    this.router = new Router(config);
    this.database = getDatabase();
    this.leaderElection = leaderElection;
    this.instanceId = `Server-${process.pid}-${Math.random().toString(36).substring(2, 6)}`;

    // Initialize response logger
    this.responseLogger = new ResponseLogger(this.database);

    // Initialize proxy executor (executeFn set after construction for retry support)
    this.proxyExecutor = new ProxyExecutor(config, this.responseLogger);

    // Initialize queue manager (executor set after construction to avoid circular dependency)
    this.queueManager = new QueueManager(config);

    // Listen for role changes if election is enabled
    if (leaderElection) {
      leaderElection.onRoleChanged((info: RoleChangeInfo) => {
        this.handleRoleChange(info);
      });
    }
  }

  /**
   * Handle role change from leader election
   */
  private handleRoleChange(info: RoleChangeInfo): void {
    const oldRole = this.role;
    this.role = info.role;
    this.leaderUrl = info.leaderUrl ?? null;

    this.log.info(
      `[Server] Role changed: ${oldRole} -> ${info.role} (state: ${info.state})${info.leaderUrl ? ` (leader: ${info.leaderUrl})` : ""}${info.error ? ` (error: ${info.error.message})` : ""}`
    );

    // If we became the leader and server is not running, start it
    if (info.role === "leader" && !this.isRunning && !this.serverStartInProgress) {
      this.log.info("[Server] Became leader, starting HTTP server");
      this.serverStartInProgress = true;
      this.startServerOnly()
        .then(() => {
          this.serverStartInProgress = false;
          // Notify election that server started successfully
          if (this.leaderElection) {
            this.leaderElection.notifyServerStarted();
          }
        })
        .catch(async err => {
          this.serverStartInProgress = false;
          this.log.error("[Server] Failed to start server after becoming leader", err);
          // Record the failure and release leadership
          if (this.leaderElection) {
            this.leaderElection.recordLeadershipFailure();
            await this.leaderElection.releaseLeadership();
            this.role = "follower";
            this.leaderUrl = null;

            // Only continue monitoring if we haven't hit the max failures
            if (!this.leaderElection.hasExternalPortConflict()) {
              this.leaderElection.startMonitoringAsFollower();
            }
            this.log.info("[Server] Released leadership after server start failure");
          }
        });
    }

    // If we became a follower and server is running, stop it
    if (info.role === "follower" && this.isRunning) {
      this.log.info("[Server] Became follower, stopping HTTP server");
      this.stopServerOnly()
        .then(() => {
          // Notify election that server stopped
          if (this.leaderElection) {
            this.leaderElection.notifyServerStopped();
          }
        })
        .catch(err => {
          this.log.error("[Server] Failed to stop server after becoming follower", err);
        });
    }

    // Notify status bar to update
    this.notifyRoleChangeListeners(info);
  }

  /**
   * Register a callback for role changes
   */
  onRoleChanged(callback: (info: RoleChangeInfo) => void): void {
    this.roleChangeCallbacks.add(callback);
  }

  /**
   * Unregister a role change callback
   */
  offRoleChanged(callback: (info: RoleChangeInfo) => void): void {
    this.roleChangeCallbacks.delete(callback);
  }

  /**
   * Notify all registered role change listeners
   */
  private notifyRoleChangeListeners(info: RoleChangeInfo): void {
    for (const callback of this.roleChangeCallbacks) {
      try {
        callback(info);
      } catch (err) {
        this.log.error("[Server] Error in role change callback", err);
      }
    }
  }

  /**
   * Start the proxy server with leader election
   */
  async start(): Promise<{ role: InstanceRole; leaderUrl?: string }> {
    const startStart = Date.now();
    this.log.info(
      `[Server:${this.instanceId}] ===== SERVER START ===== at ${new Date().toISOString()}`
    );

    if (this.isRunning) {
      this.log.info(`[Server:${this.instanceId}] Already running as ${this.role}`);
      return { role: this.role, leaderUrl: this.leaderUrl ?? undefined };
    }

    // Initialize proxy executor's retry handler
    this.proxyExecutor.setExecuteFn((task: RequestTask) => this.proxyExecutor.execute(task));

    // Initialize queue executor (deferred to avoid circular dependency)
    this.queueManager.setExecutor((task: RequestTask) => this.executeProxyRequest(task));

    // Initialize database (async for sqlite3 CLI)
    const logStorageEnabled = this.config.getSetting("log.enableStorage") === true;
    this.log.info(
      `[Server:${this.instanceId}] Initializing database. config setting: ${logStorageEnabled}`
    );
    const dbStart = Date.now();
    await this.database.initialize(logStorageEnabled);
    this.log.info(
      `[Server:${this.instanceId}] Database initialized in ${Date.now() - dbStart}ms. enabled=${this.database.enabled}`
    );

    // Run leader election if configured
    if (this.leaderElection) {
      this.log.info(`[Server:${this.instanceId}] Running leader election...`);
      const electionStart = Date.now();
      const electionResult = await this.leaderElection.electLeader();
      this.role = electionResult.isLeader ? "leader" : "follower";
      this.leaderUrl = electionResult.leaderUrl ?? null;

      this.log.info(
        `[Server:${this.instanceId}] Election result in ${Date.now() - electionStart}ms: role=${this.role}, leaderUrl=${this.leaderUrl ?? "none"}`
      );

      // Start election monitoring/heartbeat
      this.leaderElection.start();

      // Only start HTTP server if we're the leader
      if (electionResult.isLeader) {
        this.serverStartInProgress = true;
        try {
          const httpStart = Date.now();
          await this.startServerOnly();
          this.log.info(
            `[Server:${this.instanceId}] HTTP server started in ${Date.now() - httpStart}ms`
          );
          this.serverStartInProgress = false;
          // Notify election that server started successfully
          this.leaderElection.notifyServerStarted();
        } catch (err) {
          this.serverStartInProgress = false;
          // Server failed to start (port in use by external process)
          this.log.error(
            `[Server:${this.instanceId}] Failed to start server as leader, releasing leadership`,
            err
          );

          // Record failure and release leadership
          this.leaderElection.recordLeadershipFailure();
          await this.leaderElection.releaseLeadership();
          this.role = "follower";
          this.leaderUrl = null;

          // Continue monitoring unless we've hit max failures
          if (!this.leaderElection.hasExternalPortConflict()) {
            this.leaderElection.startMonitoringAsFollower();
          }

          return { role: this.role, leaderUrl: this.leaderUrl ?? undefined };
        }
      } else {
        this.log.info(
          `[Server:${this.instanceId}] Running as follower, using leader at ${this.leaderUrl}`
        );
      }

      this.log.info(
        `[Server:${this.instanceId}] ===== SERVER START COMPLETE in ${Date.now() - startStart}ms ===== as ${this.role}`
      );
      return { role: this.role, leaderUrl: this.leaderUrl ?? undefined };
    }

    // No leader election, start as standalone
    this.role = "standalone";
    await this.startServerOnly();
    this.log.info(
      `[Server:${this.instanceId}] ===== SERVER START COMPLETE in ${Date.now() - startStart}ms ===== as standalone`
    );
    return { role: "standalone" };
  }

  /**
   * Start only the HTTP server (no election)
   */
  private async startServerOnly(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      const host = this.config.host;
      const port = this.config.port;

      this.server.listen(port, host, () => {
        this.isRunning = true;
        this.log.info(`Server started on http://${host}:${port}`);
        resolve(undefined);
      });

      this.server.on("error", err => {
        this.isRunning = false;
        this.log.error("Server error", err);
        reject(err);
      });
    });
  }

  /**
   * Stop the proxy server
   */
  async stop(): Promise<void> {
    // Stop leader election first
    if (this.leaderElection) {
      await this.leaderElection.stop();
      this.log.info("[Server] Leader election stopped");
    }

    // Stop HTTP server
    await this.stopServerOnly();

    // Close database
    await this.database.close();
    this.log.info("[Server] Database closed");
  }

  /**
   * Stop only the HTTP server (no election cleanup)
   */
  private async stopServerOnly(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server || !this.isRunning) {
        resolve();
        return;
      }

      // Force close all connections to ensure port is released
      this.server.closeAllConnections();

      this.server.close(err => {
        this.isRunning = false;
        this.server = null;
        if (err) {
          this.log.error("Error stopping server", err);
          reject(err);
        } else {
          this.log.info("Server stopped and port released");
          resolve();
        }
      });
    });
  }

  get running(): boolean {
    return this.isRunning;
  }

  getRole(): InstanceRole {
    return this.role;
  }

  getLeaderUrl(): string | null {
    return this.leaderUrl;
  }

  getElectionState(): ElectionState {
    if (!this.leaderElection) {
      return "idle";
    }
    return this.leaderElection.getState();
  }

  getRouter(): Router {
    return this.router;
  }

  getConfig(): ConfigManager {
    return this.config;
  }

  /**
   * Get queue statistics if concurrency manager is enabled
   */
  getQueueStats(): QueueStats | null {
    return this.queueManager.getStats();
  }

  /**
   * Clear the waiting queue if concurrency manager is enabled
   */
  clearQueue(): number {
    return this.queueManager.clearQueue();
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsedUrl = url.parse(req.url || "", true);
    const path = parsedUrl.pathname || "";
    const method = req.method || "GET";

    // Log incoming request
    this.log.debug(`${method} ${path}`);

    // CORS headers
    this.setCorsHeaders(res);

    // Handle OPTIONS preflight
    if (method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // Serve static files (Web UI)
    if (isStaticRequest(path)) {
      serveStatic(req, res);
      return;
    }

    // Handle API requests (/ccrelay/api/*)
    if (isApiRequest(path)) {
      handleApiRequest(req, res);
      return;
    }

    // Proxy request to target provider
    this.proxyRequest(req, res, path, parsedUrl);
  }

  /**
   * Set CORS headers for response
   */
  private setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  }

  /**
   * Proxy request to target provider
   */
  private proxyRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    path: string,
    parsedUrl: url.UrlWithParsedQuery
  ): void {
    // Delegate to RequestHandler
    this.requestHandler.handle(req, res, path, parsedUrl);
  }

  // Request handler instance (lazy initialized)
  private _requestHandler: RequestHandler | null = null;

  private get requestHandler(): RequestHandler {
    if (!this._requestHandler) {
      this._requestHandler = new RequestHandler(
        this.router,
        this.queueManager,
        this.proxyExecutor,
        this.database
      );
    }
    return this._requestHandler;
  }

  /**
   * Execute a proxy request using the ProxyExecutor
   */
  private async executeProxyRequest(task: RequestTask): Promise<ProxyResult> {
    return this.proxyExecutor.execute(task);
  }
}
