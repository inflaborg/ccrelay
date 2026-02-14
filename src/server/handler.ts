/**
 * HTTP server for CCRelay API proxy
 * Supports Leader/Follower mode for multi-instance coordination
 */

/* eslint-disable @typescript-eslint/naming-convention */
// External API fields use snake_case (Content-Type, tool_call_id, etc.)

import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as zlib from "zlib";
import { Router } from "./router";
import { ConfigManager } from "../config";
import {
  RouterStatus,
  ProvidersResponse,
  SwitchResponse,
  Provider,
  InstanceRole,
  RoleChangeInfo,
  ElectionState,
  RouteType,
  RequestTask,
  ProxyResult,
  QueueStats,
} from "../types";
import { ConcurrencyManager } from "../queue";
import { convertRequestToOpenAI, convertResponseToAnthropic } from "../converter";
import type { OpenAIChatCompletionResponse } from "../converter/openai-to-anthropic";
import { ScopedLogger } from "../utils/logger";
import { getDatabase, LogDatabase } from "../database";
import { LeaderElection } from "./leaderElection";
import { isStaticRequest, serveStatic } from "./static";
import { isApiRequest, handleApiRequest } from "../api";

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

  // Concurrency manager for rate limiting
  private concurrencyManager: ConcurrencyManager | null = null;

  // Route-specific concurrency managers (key is queue name)
  private routeQueues: Map<string, ConcurrencyManager> = new Map();

  // Role change callbacks for external listeners (e.g., StatusBarManager)
  private roleChangeCallbacks: Set<(info: RoleChangeInfo) => void> = new Set();

  constructor(config: ConfigManager, leaderElection: LeaderElection | null = null) {
    this.config = config;
    this.router = new Router(config);
    this.database = getDatabase();
    this.leaderElection = leaderElection;
    this.instanceId = `Server-${process.pid}-${Math.random().toString(36).substring(2, 6)}`;

    // Listen for role changes if election is enabled
    if (leaderElection) {
      leaderElection.onRoleChanged((info: RoleChangeInfo) => {
        this.handleRoleChange(info);
      });
    }

    // Initialize concurrency manager if enabled in config
    const concurrencyConfig = config.configValue.concurrency;
    if (concurrencyConfig?.enabled) {
      this.concurrencyManager = new ConcurrencyManager(concurrencyConfig, (task: RequestTask) =>
        this.executeProxyRequest(task)
      );
      this.log.info(
        `ConcurrencyManager initialized: maxConcurrency=${concurrencyConfig.maxConcurrency}, maxQueueSize=${concurrencyConfig.maxQueueSize ?? "unlimited"}`
      );
    } else {
      this.log.info(
        `ConcurrencyManager disabled or not configured. Config: ${JSON.stringify(
          concurrencyConfig ?? "undefined"
        )}`
      );
    }

    // Initialize route-specific concurrency managers
    const routeQueueConfigs = config.routeQueues;
    if (routeQueueConfigs && routeQueueConfigs.length > 0) {
      for (const routeConfig of routeQueueConfigs) {
        const queueName = routeConfig.name ?? routeConfig.pathPattern;
        const queueConcurrencyConfig = {
          enabled: true,
          maxConcurrency: routeConfig.maxConcurrency,
          maxQueueSize: routeConfig.maxQueueSize,
          timeout: routeConfig.timeout,
        };
        const routeQueue = new ConcurrencyManager(queueConcurrencyConfig, (task: RequestTask) =>
          this.executeProxyRequest(task)
        );
        this.routeQueues.set(queueName, routeQueue);
        this.log.info(
          `RouteQueue "${queueName}" initialized: pattern=${routeConfig.pathPattern}, maxConcurrency=${routeConfig.maxConcurrency}, maxQueueSize=${routeConfig.maxQueueSize ?? "unlimited"}`
        );
      }
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
    return this.concurrencyManager?.getStats() ?? null;
  }

  /**
   * Clear the waiting queue if concurrency manager is enabled
   */
  clearQueue(): number {
    return this.concurrencyManager?.clearQueue() ?? 0;
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

    // Handle API requests
    if (isApiRequest(path)) {
      handleApiRequest(req, res);
      return;
    }

    // Legacy API endpoints (for backward compatibility)
    if (path.startsWith("/ccrelay/")) {
      this.handleLegacyApi(req, res, path);
      return;
    }

    // Proxy request to target provider
    this.proxyRequest(req, res, path, parsedUrl);
  }

  /**
   * Find matching route queue for a given path
   * Returns the queue name if matched, undefined otherwise
   */
  private findMatchingRouteQueue(
    path: string
  ): { name: string; queue: ConcurrencyManager } | undefined {
    const routeQueueConfigs = this.config.routeQueues;
    if (!routeQueueConfigs || routeQueueConfigs.length === 0) {
      return undefined;
    }

    for (const routeConfig of routeQueueConfigs) {
      if (routeConfig.compiledPattern && routeConfig.compiledPattern.test(path)) {
        const queueName = routeConfig.name ?? routeConfig.pathPattern;
        const queue = this.routeQueues.get(queueName);
        if (queue) {
          return { name: queueName, queue };
        }
      }
    }
    return undefined;
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
   * Handle legacy API endpoints (for backward compatibility)
   */
  private handleLegacyApi(req: http.IncomingMessage, res: http.ServerResponse, path: string): void {
    const method = req.method || "GET";

    switch (path) {
      case "/ccrelay/status":
        if (method === "GET") {
          this.handleStatus(req, res);
        } else {
          this.sendMethodNotAllowed(res);
        }
        break;

      case "/ccrelay/providers":
        if (method === "GET") {
          this.handleListProviders(req, res);
        } else {
          this.sendMethodNotAllowed(res);
        }
        break;

      case "/ccrelay/switch":
        if (method === "POST") {
          this.handleSwitchProvider(req, res);
        } else {
          this.sendMethodNotAllowed(res);
        }
        break;

      default:
        // Check for /ccrelay/switch/{id} pattern
        const switchMatch = path.match(/^\/ccrelay\/switch\/([^\/]+)$/);
        if (switchMatch && method === "GET") {
          void this.handleSwitchProviderById(req, res, switchMatch[1]);
        } else {
          this.sendNotFound(res);
        }
        break;
    }
  }

  /**
   * Handle GET /ccrelay/status
   */
  private handleStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
    const provider = this.router.getCurrentProvider();
    const status: RouterStatus = {
      status: this.isRunning ? "running" : "stopped",
      currentProvider: this.router.getCurrentProviderId(),
      providerName: provider?.name,
      providerMode: provider?.mode,
      port: this.config.port,
    };

    this.sendJson(res, 200, status);
  }

  /**
   * Handle GET /ccrelay/providers
   */
  private handleListProviders(req: http.IncomingMessage, res: http.ServerResponse): void {
    const currentId = this.router.getCurrentProviderId();
    const providers = this.config.enabledProviders.map(p => ({
      id: p.id,
      name: p.name,
      mode: p.mode,
      providerType: p.providerType,
      active: p.id === currentId,
    }));

    const response: ProvidersResponse = {
      providers,
      current: currentId,
    };

    this.sendJson(res, 200, response);
  }

  /**
   * Handle POST /ccrelay/switch
   */
  private handleSwitchProvider(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      void (async () => {
        try {
          const data = JSON.parse(body || "{}") as { provider?: string };
          const providerId = data.provider;

          if (!providerId) {
            const error: SwitchResponse = {
              status: "error",
              message: "Missing provider field in request body",
            };
            this.sendJson(res, 400, error);
            return;
          }

          await this.handleSwitchProviderById(req, res, providerId);
        } catch {
          const error: SwitchResponse = {
            status: "error",
            message: "Invalid JSON in request body",
          };
          this.sendJson(res, 400, error);
        }
      })();
    });
  }

  /**
   * Handle GET /ccrelay/switch/{id}
   */
  private async handleSwitchProviderById(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    providerId: string
  ): Promise<void> {
    const success = await this.router.switchProvider(providerId);

    if (success) {
      const provider = this.router.getCurrentProvider();
      this.log.info(`Switched to provider: ${providerId} (${provider?.name})`);
      const response: SwitchResponse = {
        status: "ok",
        provider: providerId,
        name: provider?.name,
      };
      this.sendJson(res, 200, response);
    } else {
      this.log.warn(`Failed to switch to provider: ${providerId}`);
      const error: SwitchResponse = {
        status: "error",
        message: `Provider '${providerId}' not found`,
        available: Object.keys(this.config.providers),
      };
      this.sendJson(res, 404, error);
    }
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
    const method = req.method || "GET";

    // Check if path should be blocked
    const blockResult = this.router.shouldBlock(path);
    if (blockResult.blocked) {
      this.log.info(`${method} ${path} -> [BLOCKED]`);
      const response = blockResult.response ?? JSON.stringify({ ok: true });
      const statusCode = blockResult.responseCode ?? 200;

      // Log block request (single write, completed status)
      if (this.database.enabled) {
        const routeType: RouteType = "block";
        this.database.insertLog({
          timestamp: Date.now(),
          providerId: "blocked",
          providerName: "blocked",
          method,
          path,
          targetUrl: undefined,
          responseBody: response,
          statusCode,
          duration: 0,
          success: true,
          status: "completed",
          routeType,
        });
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse returns any
        const jsonResponse = JSON.parse(response);
        this.sendJson(res, statusCode, jsonResponse);
      } catch {
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(response);
      }
      return;
    }

    // Get target provider
    const provider = this.router.getTargetProvider(path);
    const isRouted = this.router.shouldRoute(path);
    const isOpenAIProvider = provider.providerType === "openai";

    // Log routing decision
    const routeType = isRouted ? "ROUTE" : "PASSTHROUGH";
    this.log.info(
      `${method} ${path} -> [${routeType}] ${provider.id} (${provider.name})` +
        (isOpenAIProvider ? " [OpenAI]" : "")
    );

    // Prepare headers
    const originalHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        originalHeaders[key] = Array.isArray(value) ? value[0] : value;
      }
    }

    const headers = this.router.prepareHeaders(originalHeaders, provider);

    // Build target URL and convert path if needed
    let targetPath = path;
    let targetUrl = this.router.getTargetUrl(path, provider);
    if (parsedUrl.search) {
      targetUrl += parsedUrl.search;
    }

    // Prepare body - track timing for client request receive
    const requestReceiveStart = Date.now();
    let bodyChunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      bodyChunks.push(chunk);
    });

    req.on("end", () => {
      const bodyReceiveTime = Date.now() - requestReceiveStart;
      let body: Buffer | null = null;
      let originalModel: string | undefined;
      // Track original request body before any conversion (for all providers)
      let originalRequestBody: string | undefined;

      if (bodyChunks.length > 0) {
        body = Buffer.concat(bodyChunks);
        this.log.info(
          `[Perf] RequestBodyReceived: ${body.length} bytes in ${bodyReceiveTime}ms from client`
        );

        // Save original body before any processing (for all providers)
        if (this.database.enabled) {
          try {
            originalRequestBody = body.toString("utf-8");
          } catch {
            originalRequestBody = undefined;
          }
        }

        // Apply model mapping (e.g., claude-* -> glm-4.7)
        // This must be done BEFORE conversion so that isGemini checks work correctly
        body = this.applyModelMapping(body, provider);

        // Convert request format if using OpenAI provider
        if (isOpenAIProvider && body) {
          const conversionResult = this.convertRequestForOpenAI(body, targetPath);
          if (conversionResult) {
            body = Buffer.from(JSON.stringify(conversionResult.request), "utf-8");
            const oldPath = targetPath;
            targetPath = conversionResult.newPath;

            // Rebuild target URL with new path (NOT including original query params)
            const baseUrl = provider.baseUrl.replace(/\/$/, "");
            targetUrl = `${baseUrl}${targetPath}`;

            // Log the URL conversion for debugging
            this.log.info(
              `[OpenAI] URL conversion: baseUrl="${provider.baseUrl}" ${oldPath} -> ${targetPath}, final="${targetUrl}"`
            );

            // Extract original model for response conversion
            try {
              const originalData = JSON.parse(bodyChunks[0].toString("utf-8")) as Record<
                string,
                unknown
              >;
              originalModel = originalData.model as string | undefined;
            } catch {
              // ignore
            }

            this.log.debug(`[OpenAI Conversion] ${conversionResult.originalPath} -> ${targetPath}`);
          }
        }
      }

      // Capture request body for logging
      let requestBodyLog: string | undefined;
      if (this.database.enabled && body) {
        try {
          requestBodyLog = body.toString("utf-8");
        } catch {
          requestBodyLog = undefined;
        }
      }

      // Generate unique clientId for this request
      const clientId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      // Insert pending log immediately after request body is ready
      if (this.database.enabled) {
        this.database.insertLogPending({
          timestamp: Date.now(),
          providerId: provider.id,
          providerName: provider.name,
          method,
          path,
          targetUrl,
          requestBody: requestBodyLog,
          originalRequestBody,
          statusCode: undefined,
          duration: 0,
          success: false,
          clientId,
          status: "pending",
          routeType: (isRouted ? "router" : "passthrough") as RouteType,
        });
      }

      // Create task for concurrency manager
      const task: RequestTask = {
        id: clientId,
        method,
        targetUrl,
        headers,
        body,
        provider,
        requestPath: targetPath,
        requestBodyLog,
        originalRequestBody,
        isOpenAIProvider,
        originalModel,
        clientId,
        createdAt: Date.now(),
        // Default priority is 0, can be extended later based on user/role
        priority: 0,
        // Pass response object for SSE streaming support
        res,
      };

      // If concurrency manager is enabled, submit to queue
      if (this.concurrencyManager) {
        // Check if there's a matching route-specific queue
        const matchedRoute = this.findMatchingRouteQueue(path);
        const targetQueue = matchedRoute?.queue ?? this.concurrencyManager;
        const queueName = matchedRoute?.name ?? "default";

        this.log.info(
          `[Perf:${clientId}] TaskSubmit: submitting to queue "${queueName}" (body ready in ${bodyReceiveTime}ms, matched route: ${matchedRoute ? "yes" : "no"})`
        );

        // Track if client disconnected while queuing
        let clientDisconnected = false;

        const onClientDisconnect = () => {
          if (!clientDisconnected) {
            clientDisconnected = true;
            task.cancelled = true;
            task.cancelledReason = "Client disconnected while queuing";
            this.log.info(`[${clientId}] Client disconnected, marking task as cancelled`);
            // Try to cancel from queue
            targetQueue.cancelTask(clientId, "Client disconnected");
          }
        };

        // Listen for client disconnect

        res.on("close", onClientDisconnect);

        targetQueue
          .submit(task)
          .then(result => {
            // Clean up listeners

            res.off("close", onClientDisconnect);

            const totalTime = Date.now() - requestReceiveStart;

            // Check if client disconnected
            if (clientDisconnected || res.writableEnded) {
              this.log.info(
                `[Perf:${clientId}] TaskComplete: client disconnected, skipping response (status: ${result.statusCode}, time: ${totalTime}ms)`
              );
              return;
            }

            // Write response from result
            if (result.error) {
              // This is a logic error that happened during execution
              const errMsg = result.error.message;
              this.log.error(`Task ${task.id} failed: ${errMsg}`);
              if (!res.headersSent) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: errMsg }));
              }
              return;
            }

            // If streaming was already handled, skip writing response
            if (result.streamed) {
              this.log.info(
                `[Perf:${clientId}] TaskComplete: streaming done, total time: ${totalTime}ms`
              );
              return;
            }

            // Success response (non-streaming)
            const responseHeaders = result.headers as Record<string, string | number | string[]>;
            res.writeHead(result.statusCode, responseHeaders);

            if (result.body) {
              res.end(result.body);
            } else {
              res.end();
            }
            this.log.info(
              `[Perf:${clientId}] TaskComplete: non-streaming done, total time: ${totalTime}ms`
            );
          })
          .catch(err => {
            // Clean up listeners

            res.off("close", onClientDisconnect);

            // This is an error from the queue submission itself (e.g. queue full)
            const errMsg = err instanceof Error ? err.message : String(err);
            this.log.warn(`Task ${task.id} rejected from queue "${queueName}": ${errMsg}`);

            // Don't write if client disconnected
            if (!clientDisconnected && !res.headersSent && !res.writableEnded) {
              // 503 Service Unavailable is appropriate for queue full/timeout
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: errMsg, code: "QUEUE_FULL_OR_TIMEOUT" }));
            }
          });
      } else {
        // Direct execution (legacy behavior)
        this.makeProxyRequest(
          method,
          targetUrl,
          headers,
          body,
          res,
          provider,
          targetPath,
          requestBodyLog,
          originalRequestBody,
          isOpenAIProvider,
          originalModel,
          clientId
        );
      }
    });
  }

  /**
   * Make the actual proxy request to the target provider
   */
  private makeProxyRequest(
    method: string,
    targetUrl: string,
    headers: Record<string, string>,
    body: Buffer | null,
    res: http.ServerResponse,
    provider: Provider,
    requestPath: string,
    requestBodyLog: string | undefined,
    originalRequestBody: string | undefined,
    isOpenAIProvider: boolean = false,
    originalModel: string | undefined = undefined,
    clientId: string = "",
    attempt: number = 1
  ): void {
    const maxRetries = 2;
    const urlParsed = url.parse(targetUrl);
    const isHttps = urlParsed.protocol === "https:";
    const httpModule = isHttps ? https : http;

    // Disable compression to avoid gzip response issues when logging to database
    // Without this, responseChunks would contain compressed data that becomes garbled
    // when converted to string for database storage
    const requestHeaders: Record<string, string> = { ...headers };
    requestHeaders["accept-encoding"] = "identity";

    const options: http.RequestOptions = {
      hostname: urlParsed.hostname,
      port: urlParsed.port || (isHttps ? 443 : 80),
      path: urlParsed.path,
      method,
      headers: requestHeaders,
    };

    // Performance timing markers
    const startTime = Date.now();
    let requestSentTime: number = 0;
    let firstByteTime: number = 0;
    let firstByteLogged = false;
    let streamChunkCount = 0;
    let streamTotalBytes = 0;
    let lastChunkTime = 0;

    let responseChunks: Buffer[] = [];
    let hasLogged = false;

    const proxyReq = httpModule.request(options, proxyRes => {
      const duration = Date.now() - startTime;
      const status = proxyRes.statusCode || 200;

      // Record TTFB (Time To First Byte)
      firstByteTime = Date.now();
      const ttfb = firstByteTime - requestSentTime;
      this.log.info(
        `[Perf:${clientId}] TTFB: ${ttfb}ms (upstream response headers received, total: ${duration}ms)`
      );

      // Log response
      if (status >= 400) {
        this.log.warn(`Response from ${provider.id}: ${status} (${duration}ms)`);
      } else {
        this.log.debug(`Response from ${provider.id}: ${status} (${duration}ms)`);
      }

      // Copy status code
      res.statusCode = status;

      // Copy headers (excluding hop-by-hop headers)
      const excludedHeaders = new Set([
        "content-encoding",
        "content-length",
        "transfer-encoding",
        "connection",
        "keep-alive",
      ]);

      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (value && !excludedHeaders.has(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      }

      // For OpenAI provider, we need to buffer the response and convert it back to Anthropic format
      if (
        isOpenAIProvider &&
        status === 200 &&
        proxyRes.headers["content-type"]?.includes("application/json")
      ) {
        let responseBody = "";
        proxyRes.on("data", (chunk: Buffer) => {
          responseBody += chunk.toString();
        });

        proxyRes.on("end", () => {
          // Store original response before conversion
          const originalResponseBody = responseBody;

          try {
            const openaiResponse = JSON.parse(responseBody) as OpenAIChatCompletionResponse;

            // Convert OpenAI response to Anthropic format
            // Signature handling is now done inline in the converter (no external storage)
            const anthropicResponse = convertResponseToAnthropic(
              openaiResponse,
              originalModel || "claude-3-5-sonnet-20241022"
            );
            res.end(JSON.stringify(anthropicResponse));

            // Log the converted response
            if (this.database.enabled) {
              responseChunks.push(Buffer.from(JSON.stringify(anthropicResponse), "utf-8"));
            }

            // Log after response completes with original content
            if (!hasLogged) {
              this.logResponse(
                clientId,
                duration,
                status,
                responseChunks,
                undefined,
                originalResponseBody
              );
              hasLogged = true;
            }
          } catch (err) {
            // Log conversion failure at warn level for visibility
            const errMsg = err instanceof Error ? err.message : String(err);
            this.log.warn(
              `[OpenAI Conversion] Response conversion failed for ${provider.id}: ${errMsg}`
            );

            // Return Anthropic-format error instead of unparseable OpenAI response
            const errorResponse = {
              type: "error",
              error: {
                type: "api_error",
                message: `Response format conversion failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            };
            const errorBody = JSON.stringify(errorResponse);

            if (!res.headersSent) {
              res.writeHead(502, { "Content-Type": "application/json" });
            }
            res.end(errorBody);

            if (this.database.enabled) {
              responseChunks.push(Buffer.from(errorBody, "utf-8"));
            }

            // Log after response completes
            if (!hasLogged) {
              this.logResponse(
                clientId,
                duration,
                502,
                responseChunks,
                `OpenAI conversion failed: ${err instanceof Error ? err.message : String(err)}`,
                originalResponseBody
              );
              hasLogged = true;
            }
          }
        });
      } else {
        // Check if this is a streaming (SSE) response
        const isSSEResponse = proxyRes.headers["content-type"]?.includes("text/event-stream");

        if (isSSEResponse) {
          this.log.info(`[Perf:${clientId}] SSE streaming mode detected`);

          // Capture response chunks for logging and performance tracking
          proxyRes.on("data", (chunk: Buffer) => {
            streamChunkCount++;
            streamTotalBytes += chunk.length;
            lastChunkTime = Date.now();

            // Log first chunk separately (helps identify prefill delay)
            if (!firstByteLogged) {
              firstByteLogged = true;
              const firstChunkDelay = Date.now() - firstByteTime;
              this.log.info(
                `[Perf:${clientId}] FirstChunk: ${firstChunkDelay}ms after headers, ${chunk.length} bytes`
              );
            }

            // Log every 10 chunks or large chunks (>10KB)
            if (streamChunkCount % 10 === 0 || chunk.length > 10240) {
              const chunkDuration = Date.now() - startTime;
              this.log.info(
                `[Perf:${clientId}] Chunk#${streamChunkCount}: ${chunk.length} bytes, total: ${streamTotalBytes} bytes, elapsed: ${chunkDuration}ms`
              );
            }

            if (this.database.enabled) {
              responseChunks.push(chunk);
            }
          });
        } else {
          // Non-SSE: simpler logging
          proxyRes.on("data", (chunk: Buffer) => {
            streamChunkCount++;
            streamTotalBytes += chunk.length;

            if (this.database.enabled) {
              responseChunks.push(chunk);
            }
          });
        }

        // Pipe response
        proxyRes.pipe(res);

        // Log after response completes
        proxyRes.on("end", () => {
          const totalDuration = Date.now() - startTime;
          const avgChunkSize =
            streamChunkCount > 0 ? Math.round(streamTotalBytes / streamChunkCount) : 0;
          const timeSinceLastChunk = lastChunkTime > 0 ? Date.now() - lastChunkTime : 0;
          this.log.info(
            `[Perf:${clientId}] ResponseEnd: ${streamChunkCount} chunks, ${streamTotalBytes} total bytes, avg ${avgChunkSize} bytes/chunk, total: ${totalDuration}ms, lastChunkGap: ${timeSinceLastChunk}ms, mode: ${isSSEResponse ? "SSE" : "non-SSE"}`
          );
          if (!hasLogged) {
            this.logResponse(clientId, totalDuration, status, responseChunks, undefined);
            hasLogged = true;
          }
        });
      }
    });

    proxyReq.on("error", (err: NodeJS.ErrnoException) => {
      const duration = Date.now() - startTime;

      // Retry on connection-phase errors (not response errors)
      const retryableCodes = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"];
      if (attempt < maxRetries && err.code && retryableCodes.includes(err.code)) {
        this.log.warn(
          `Proxy connection error to ${provider.id} (attempt ${attempt}/${maxRetries}): ${err.message}, retrying in ${attempt}s...`
        );
        setTimeout(() => {
          this.makeProxyRequest(
            method,
            targetUrl,
            headers,
            body,
            res,
            provider,
            requestPath,
            requestBodyLog,
            originalRequestBody,
            isOpenAIProvider,
            originalModel,
            clientId,
            attempt + 1
          );
        }, 1000 * attempt);
        return;
      }

      this.log.error(`Proxy error to ${provider.id} (${duration}ms): ${err.message}`);
      if (!hasLogged) {
        this.logResponse(clientId, duration, 0, responseChunks, err.message);
        hasLogged = true;
      }
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(`Proxy error: ${err.message}`);
      }
    });

    proxyReq.on("timeout", () => {
      const duration = Date.now() - startTime;
      this.log.error(`Proxy timeout to ${provider.id} (${duration}ms)`);
      if (!hasLogged) {
        this.logResponse(clientId, duration, 0, responseChunks, "Timeout");
        hasLogged = true;
      }
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { "Content-Type": "text/plain" });
        res.end("Proxy timeout");
      }
    });

    // Set configurable timeout (default 5 minutes for long code generation)
    // Config value is in seconds, convert to milliseconds
    const requestTimeoutSeconds = this.config.getSetting("proxy.requestTimeout", 300);
    const requestTimeoutMs = requestTimeoutSeconds * 1000;
    if (requestTimeoutMs > 0) {
      proxyReq.setTimeout(requestTimeoutMs);
    }

    if (body) {
      proxyReq.write(body);
      this.log.info(`[Perf:${clientId}] RequestBodySent: ${body.length} bytes to upstream`);
    }

    proxyReq.end();
    requestSentTime = Date.now();
    this.log.info(
      `[Perf:${clientId}] RequestSent: total setup time ${requestSentTime - startTime}ms, waiting for upstream response...`
    );
  }

  /**
   * Log request/response to database - updates existing pending log by clientId
   */
  private logResponse(
    clientId: string,
    duration: number,
    statusCode: number,
    responseChunks: Buffer[],
    errorMessage: string | undefined,
    originalResponseBody?: string
  ): void {
    if (!this.database.enabled) {
      this.log.info(`[Server] logResponse skipped - database not enabled. clientId=${clientId}`);
      return;
    }

    this.log.info(
      `[Server] logResponse called - clientId=${clientId}, status=${statusCode}, duration=${duration}ms`
    );

    let responseBodyLog: string | undefined;
    if (responseChunks.length > 0) {
      try {
        const rawBuffer = Buffer.concat(responseChunks);
        // Try to detect and decompress gzip data
        // Gzip magic number: 1f 8b
        const isGzip = rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b;
        if (isGzip) {
          try {
            const decompressed = zlib.gunzipSync(rawBuffer);
            responseBodyLog = decompressed.toString("utf-8");
            this.log.debug(
              `[Server] Decompressed gzip response: ${rawBuffer.length} -> ${decompressed.length} bytes`
            );
          } catch (decompressErr: unknown) {
            const errMsg =
              decompressErr instanceof Error ? decompressErr.message : String(decompressErr);
            this.log.warn(`[Server] Failed to decompress gzip data: ${errMsg}`);
            responseBodyLog = rawBuffer.toString("utf-8");
          }
        } else {
          responseBodyLog = rawBuffer.toString("utf-8");
        }
      } catch {
        responseBodyLog = undefined;
      }
    }

    const success = statusCode >= 200 && statusCode < 300 && !errorMessage;

    this.database.updateLogCompleted(
      clientId,
      statusCode,
      responseBodyLog,
      duration,
      success,
      errorMessage,
      originalResponseBody
    );
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private sendNotFound(res: http.ServerResponse): void {
    this.sendJson(res, 404, { error: "Not found" });
  }

  private sendMethodNotAllowed(res: http.ServerResponse): void {
    this.sendJson(res, 405, { error: "Method not allowed" });
  }

  /**
   * Detect if request body contains image content
   * Follows Anthropic API standard for message content
   */
  private containsImageContent(data: unknown): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    const body = data as Record<string, unknown>;

    // Check for messages array (Anthropic Messages API)
    if (body.messages && Array.isArray(body.messages)) {
      for (const message of body.messages) {
        if (message && typeof message === "object") {
          const msg = message as Record<string, unknown>;
          if (msg.content && Array.isArray(msg.content)) {
            for (const item of msg.content) {
              if (item && typeof item === "object") {
                const contentItem = item as Record<string, unknown>;
                // Check for image type (Anthropic format)
                if (contentItem.type === "image") {
                  return true;
                }
                // Also check for OpenAI-compatible format (image_url)
                if (contentItem.type === "image_url") {
                  return true;
                }
                // Check nested image_url object
                if (contentItem.image_url && typeof contentItem.image_url === "object") {
                  return true;
                }
              }
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Match a model against a model map (supports exact match and wildcards)
   */
  private matchModel(
    model: string,
    modelMap: Record<string, string>
  ): { targetModel: string; pattern: string } | null {
    // Check for exact match first
    if (modelMap[model]) {
      return { targetModel: modelMap[model], pattern: model };
    }

    // Check for wildcard patterns
    for (const [pattern, targetModel] of Object.entries(modelMap)) {
      if (pattern.includes("*")) {
        // Convert wildcard pattern to regex
        const patternRegex = new RegExp(
          "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
        );
        if (patternRegex.test(model)) {
          return { targetModel, pattern };
        }
      }
    }

    return null;
  }

  /**
   * Apply model mapping based on provider's modelMap configuration
   * Supports wildcard patterns (e.g., "claude-*" matches "claude-opus-4-5")
   *
   * Priority:
   * 1. If request contains images and vlModelMap exists -> use vlModelMap
   * 2. Otherwise, use modelMap
   * 3. If no match in selected map, fall back to the other map
   */
  private applyModelMapping(body: Buffer, provider: Provider): Buffer {
    if (!body) {
      return body;
    }

    const hasVlMap = provider.vlModelMap && Object.keys(provider.vlModelMap).length > 0;
    const hasRegularMap = provider.modelMap && Object.keys(provider.modelMap).length > 0;

    if (!hasVlMap && !hasRegularMap) {
      return body;
    }

    try {
      const bodyStr = body.toString("utf-8");

      const data = JSON.parse(bodyStr) as Record<string, unknown>;

      if (data.model) {
        const originalModel = data.model as string;
        const hasImages = this.containsImageContent(data);

        // Determine which map to use first
        let result: { targetModel: string; pattern: string } | null = null;
        const firstMap = hasImages && hasVlMap ? provider.vlModelMap : provider.modelMap;
        const secondMap =
          firstMap === provider.modelMap && hasVlMap
            ? provider.vlModelMap
            : hasRegularMap
              ? provider.modelMap
              : null;
        // Determine mapping type for logging
        const isVlMapping = firstMap === provider.vlModelMap;
        const mappingType = isVlMapping ? "VL" : "Regular";

        // Try first map
        if (firstMap) {
          result = this.matchModel(originalModel, firstMap);
        }

        // Fall back to second map if no match
        if (!result && secondMap) {
          result = this.matchModel(originalModel, secondMap);
        }

        // Apply mapping if found
        if (result) {
          data.model = result.targetModel;
          const pattern = result.pattern;
          const mappingTypeStr: string = mappingType as string;
          const patternStr: string = String(pattern);
          const targetModel: string = data.model as string;
          const logMessage: string =
            "[ModelMapping:" +
            mappingTypeStr +
            '] "' +
            originalModel +
            '" -> "' +
            targetModel +
            '" (pattern: ' +
            patternStr +
            ")";
          this.log.info(logMessage);
          return Buffer.from(JSON.stringify(data));
        }
      }

      return body;
    } catch (err) {
      this.log.error("[ModelMapping] Failed to parse body", err);
      return body;
    }
  }

  /**
   * Execute a proxy request and return the result (for concurrency manager)
   * Wraps makeProxyRequest logic but returns a ProxyResult instead of writing to response
   */
  private async executeProxyRequest(task: RequestTask): Promise<ProxyResult> {
    const {
      method,
      targetUrl,
      headers: taskHeaders,
      body,
      provider,
      isOpenAIProvider,
      originalModel,
      clientId,
      attempt = 1,
      res: clientRes,
    } = task;

    // Check if task was cancelled before starting
    if (task.cancelled) {
      this.log.info(`[${clientId}] Task cancelled before execution: ${task.cancelledReason}`);
      return {
        statusCode: 499,
        headers: {},
        error: new Error(task.cancelledReason ?? "Task cancelled"),
        errorMessage: task.cancelledReason ?? "Task cancelled",
        duration: 0,
      };
    }

    // Check if client connection is still alive
    if (clientRes && clientRes.writableEnded) {
      this.log.info(`[${clientId}] Client connection already closed, skipping execution`);
      return {
        statusCode: 499,
        headers: {},
        error: new Error("Client disconnected"),
        errorMessage: "Client disconnected",
        duration: 0,
      };
    }

    const maxRetries = 2;
    const urlParsed = url.parse(targetUrl);
    const isHttps = urlParsed.protocol === "https:";
    const httpModule = isHttps ? https : http;

    // Disable compression to avoid gzip response issues when logging to database
    const requestHeaders: Record<string, string> = { ...taskHeaders };
    requestHeaders["accept-encoding"] = "identity";

    // Create AbortController for timeout cancellation
    const abortController = new AbortController();

    const options: http.RequestOptions = {
      hostname: urlParsed.hostname,
      port: urlParsed.port || (isHttps ? 443 : 80),
      path: urlParsed.path,
      method,
      headers: requestHeaders,
      signal: abortController.signal,
    };

    const startTime = Date.now();
    let requestSentTime = 0;
    let firstByteTime = 0;
    let streamChunkCount = 0;
    let streamTotalBytes = 0;
    let firstChunkLogged = false;
    let responseChunks: Buffer[] = [];
    let originalResponseBody: string | undefined;
    let clientDisconnected = false;

    // Track client disconnect during streaming
    const onClientDisconnect = () => {
      clientDisconnected = true;
      this.log.info(`[${clientId}] Client disconnected during streaming`);
      abortController.abort();
    };

    if (clientRes) {
      clientRes.on("close", onClientDisconnect);
    }

    this.log.info(
      `[Perf:${clientId}] ExecuteRequestStart: starting upstream request to ${provider.id}`
    );

    return new Promise<ProxyResult>((resolve, reject) => {
      const proxyReq = httpModule.request(options, proxyRes => {
        const ttfb = Date.now() - requestSentTime;
        const duration = Date.now() - startTime;
        const status = proxyRes.statusCode || 200;
        firstByteTime = Date.now();

        this.log.info(
          `[Perf:${clientId}] TTFB: ${ttfb}ms (upstream response headers, total elapsed: ${duration}ms)`
        );

        // Log response
        if (status >= 400) {
          this.log.warn(`Response from ${provider.id}: ${status} (${duration}ms)`);
        } else {
          this.log.debug(`Response from ${provider.id}: ${status} (${duration}ms)`);
        }

        // Collect response headers
        const excludedHeaders = new Set([
          "content-encoding",
          "content-length",
          "transfer-encoding",
          "connection",
          "keep-alive",
        ]);
        const responseHeaders: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (value && !excludedHeaders.has(key.toLowerCase())) {
            responseHeaders[key] = value;
          }
        }

        // Handle OpenAI response conversion
        if (
          isOpenAIProvider &&
          status === 200 &&
          proxyRes.headers["content-type"]?.includes("application/json")
        ) {
          let responseBody = "";
          proxyRes.on("data", (chunk: Buffer) => {
            responseBody += chunk.toString();
          });

          proxyRes.on("end", () => {
            originalResponseBody = responseBody;

            try {
              const openaiResponse = JSON.parse(responseBody) as OpenAIChatCompletionResponse;
              const anthropicResponse = convertResponseToAnthropic(
                openaiResponse,
                originalModel || "none"
              );

              responseChunks.push(Buffer.from(JSON.stringify(anthropicResponse), "utf-8"));

              this.logResponse(
                clientId,
                duration,
                status,
                responseChunks,
                undefined,
                originalResponseBody
              );

              resolve({
                statusCode: status,
                headers: responseHeaders,
                body: JSON.stringify(anthropicResponse),
                duration,
                responseBodyChunks: responseChunks,
                originalResponseBody,
              });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              this.log.warn(
                `[OpenAI Conversion] Response conversion failed for ${provider.id}: ${errMsg}`
              );

              const errorResponse = {
                type: "error",
                error: {
                  type: "api_error",
                  message: `Response format conversion failed: ${errMsg}`,
                },
              };
              const errorBody = JSON.stringify(errorResponse);

              responseChunks.push(Buffer.from(errorBody, "utf-8"));

              this.logResponse(
                clientId,
                duration,
                502,
                responseChunks,
                `OpenAI conversion failed: ${errMsg}`,
                originalResponseBody
              );

              resolve({
                statusCode: 502,
                headers: { "Content-Type": "application/json" },
                body: errorBody,
                duration,
                responseBodyChunks: responseChunks,
                errorMessage: `OpenAI conversion failed: ${errMsg}`,
              });
            }
          });
        } else {
          // Non-OpenAI response
          const isSSEResponse = proxyRes.headers["content-type"]?.includes("text/event-stream");

          // If SSE and we have a client response object, stream directly
          if (isSSEResponse && clientRes) {
            this.log.info(`[Perf:${clientId}] SSE streaming mode enabled`);

            // Write headers immediately
            clientRes.writeHead(status, responseHeaders);

            // Pipe the response directly to client
            proxyRes.pipe(clientRes);

            // Handle upstream errors during streaming
            proxyRes.on("error", (err: Error) => {
              this.log.error(`[${clientId}] SSE upstream error: ${err.message}`);
              if (!clientRes.writableEnded) {
                try {
                  clientRes.end();
                } catch {
                  // Ignore errors when ending already-closed stream
                }
              }
            });

            // Handle client errors during streaming
            clientRes.on("error", (err: Error) => {
              this.log.error(`[${clientId}] Client connection error: ${err.message}`);
              proxyRes.destroy();
            });

            // Track streaming performance
            proxyRes.on("data", (chunk: Buffer) => {
              streamChunkCount++;
              streamTotalBytes += chunk.length;

              // Log first chunk (helps identify prefill delay)
              if (!firstChunkLogged) {
                firstChunkLogged = true;
                const firstChunkDelay = Date.now() - firstByteTime;
                this.log.info(
                  `[Perf:${clientId}] FirstChunk: ${firstChunkDelay}ms after headers, ${chunk.length} bytes`
                );
              }

              // Log every 10 chunks or large chunks (>10KB)
              if (streamChunkCount % 10 === 0 || chunk.length > 10240) {
                const chunkDuration = Date.now() - startTime;
                this.log.info(
                  `[Perf:${clientId}] Chunk#${streamChunkCount}: ${chunk.length} bytes, total: ${streamTotalBytes} bytes, elapsed: ${chunkDuration}ms`
                );
              }

              if (this.database.enabled) {
                responseChunks.push(chunk);
              }
            });

            proxyRes.on("end", () => {
              const totalDuration = Date.now() - startTime;
              const avgChunkSize =
                streamChunkCount > 0 ? Math.round(streamTotalBytes / streamChunkCount) : 0;

              // Clean up client disconnect listener
              if (clientRes) {
                clientRes.off("close", onClientDisconnect);
              }

              if (clientDisconnected) {
                this.log.info(
                  `[Perf:${clientId}] StreamEnd (client disconnected): ${streamChunkCount} chunks, ${streamTotalBytes} bytes, total: ${totalDuration}ms`
                );
              } else {
                this.log.info(
                  `[Perf:${clientId}] StreamEnd: ${streamChunkCount} chunks, ${streamTotalBytes} total bytes, avg ${avgChunkSize} bytes/chunk, total: ${totalDuration}ms`
                );
              }
              this.logResponse(
                clientId,
                totalDuration,
                clientDisconnected ? 499 : status,
                responseChunks,
                clientDisconnected ? "Client disconnected" : undefined
              );
              resolve({
                statusCode: clientDisconnected ? 499 : status,
                headers: responseHeaders,
                duration: totalDuration,
                responseBodyChunks: responseChunks,
                streamed: true,
                errorMessage: clientDisconnected ? "Client disconnected" : undefined,
              });
            });
          } else {
            // Non-streaming: buffer the response
            proxyRes.on("data", (chunk: Buffer) => {
              streamChunkCount++;
              streamTotalBytes += chunk.length;
              responseChunks.push(chunk);
            });

            proxyRes.on("end", () => {
              const totalDuration = Date.now() - startTime;

              // Clean up client disconnect listener
              if (clientRes) {
                clientRes.off("close", onClientDisconnect);
              }

              this.log.info(
                `[Perf:${clientId}] ResponseEnd: ${streamChunkCount} chunks, ${streamTotalBytes} total bytes, total: ${totalDuration}ms`
              );
              this.logResponse(clientId, totalDuration, status, responseChunks, undefined);
              resolve({
                statusCode: status,
                headers: responseHeaders,
                body: responseChunks.length > 0 ? Buffer.concat(responseChunks) : undefined,
                duration: totalDuration,
                responseBodyChunks: responseChunks,
              });
            });
          }
        }
      });

      // Handle connection errors
      proxyReq.on("error", (err: NodeJS.ErrnoException) => {
        const duration = Date.now() - startTime;

        // Clean up client disconnect listener
        if (clientRes) {
          clientRes.off("close", onClientDisconnect);
        }

        // Check if aborted by client disconnect
        if (abortController.signal.aborted) {
          this.log.info(`[${clientId}] Request aborted (client disconnect) after ${duration}ms`);
          this.logResponse(clientId, duration, 499, responseChunks, "Client disconnected");
          resolve({
            statusCode: 499,
            headers: {},
            duration,
            errorMessage: "Client disconnected",
          });
          return;
        }

        // Retry on connection-phase errors
        const retryableCodes = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"];
        if (attempt < maxRetries && err.code && retryableCodes.includes(err.code)) {
          this.log.warn(
            `Proxy connection error to ${provider.id} (attempt ${attempt}/${maxRetries}): ${err.message}, retrying in ${attempt}s...`
          );

          // Clean up listeners before retry
          if (clientRes) {
            clientRes.off("close", onClientDisconnect);
          }

          setTimeout(() => {
            this.executeProxyRequest({ ...task, attempt: attempt + 1 })
              .then(resolve)
              .catch(reject);
          }, 1000 * attempt);
          return;
        }

        this.log.error(`Proxy error to ${provider.id} (${duration}ms): ${err.message}`);
        this.logResponse(clientId, duration, 0, responseChunks, err.message);
        reject(new Error(`Proxy error: ${err.message}`));
      });

      proxyReq.on("timeout", () => {
        const duration = Date.now() - startTime;
        this.log.error(`Proxy timeout to ${provider.id} (${duration}ms)`);

        // Clean up client disconnect listener
        if (clientRes) {
          clientRes.off("close", onClientDisconnect);
        }

        // Abort the request
        abortController.abort();
        this.logResponse(clientId, duration, 0, responseChunks, "Timeout");
        reject(new Error("Proxy timeout"));
      });

      // Set configurable timeout (default 5 minutes for long code generation)
      // Config value is in seconds, convert to milliseconds
      const requestTimeoutSeconds = this.config.getSetting("proxy.requestTimeout", 300);
      const requestTimeoutMs = requestTimeoutSeconds * 1000;
      if (requestTimeoutMs > 0) {
        proxyReq.setTimeout(requestTimeoutMs);
      }

      if (body) {
        proxyReq.write(body);
        this.log.info(`[Perf:${clientId}] RequestBodySent: ${body.length} bytes to upstream`);
      }

      proxyReq.end();
      requestSentTime = Date.now();
      this.log.info(
        `[Perf:${clientId}] RequestSent: setup time ${requestSentTime - startTime}ms, waiting for upstream...`
      );
    });
  }

  /**
   * Convert Anthropic API request to OpenAI API format
   * Returns null if conversion is not needed or fails
   */
  private convertRequestForOpenAI(
    body: Buffer,
    path: string
  ): { request: unknown; originalPath: string; newPath: string } | null {
    try {
      const bodyStr = body.toString("utf-8");
      const anthropicRequest = JSON.parse(bodyStr) as Record<string, unknown>;

      // Check if this looks like an Anthropic Messages API request
      if (!anthropicRequest.messages || !Array.isArray(anthropicRequest.messages)) {
        return null; // Not an Anthropic request
      }

      // Convert to OpenAI format
      return convertRequestToOpenAI(
        anthropicRequest as unknown as Parameters<typeof convertRequestToOpenAI>[0],
        path
      );
    } catch (err) {
      this.log.error("[OpenAI Conversion] Failed to convert request", err);
      return null;
    }
  }
}
