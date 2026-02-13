import * as vscode from "vscode";
import { ConfigManager } from "./config";
import { ProxyServer } from "./server/handler";
import { StatusBarManager } from "./vscode/statusBar";
import { LogViewerPanel } from "./vscode/logViewer";
import { Logger } from "./utils/logger";
import { LeaderElection } from "./server/leaderElection";
import * as Api from "./api";

let server: ProxyServer | null = null;
let statusBar: StatusBarManager | null = null;
let configManager: ConfigManager | null = null;
let logger: Logger | null = null;
let leaderElection: LeaderElection | null = null;

export function activate(context: vscode.ExtensionContext) {
  const activationStart = Date.now();
  const instanceId = Math.random().toString(36).substring(2, 9);

  // Initialize logger
  logger = Logger.getInstance();
  logger.info(
    `[Extension:${instanceId}] ===== ACTIVATION START ===== at ${new Date().toISOString()}`
  );
  logger.info(`[Extension:${instanceId}] Process ID: ${process.pid}`);

  // Initialize configuration manager
  const configStart = Date.now();
  configManager = new ConfigManager(context);
  logger.info(
    `[Extension:${instanceId}] ConfigManager initialized in ${Date.now() - configStart}ms`
  );

  // Get server configuration
  const port = configManager.port;
  const host = configManager.host;

  // Check if multi-instance mode is enabled
  const multiInstanceEnabled = vscode.workspace
    .getConfiguration("ccrelay")
    .get<boolean>("multiInstance", true);

  // Initialize leader election if multi-instance is enabled
  const leaderElectionStart = Date.now();
  if (multiInstanceEnabled) {
    logger.info(`[Extension:${instanceId}] Multi-instance mode enabled`);
    leaderElection = new LeaderElection(port, host);
  }
  logger.info(
    `[Extension:${instanceId}] LeaderElection initialized in ${Date.now() - leaderElectionStart}ms`
  );

  // Create server instance (with leader election if enabled)
  const serverStart = Date.now();
  server = new ProxyServer(configManager, leaderElection);
  logger.info(`[Extension:${instanceId}] ProxyServer created in ${Date.now() - serverStart}ms`);

  // Initialize API module with server instance
  Api.setServer(server);

  // Create status bar manager
  statusBar = new StatusBarManager(context, configManager, server);

  // Register commands
  const showMenuCommand = vscode.commands.registerCommand("ccrelay.showMenu", async () => {
    await statusBar?.showMenu();
  });

  const switchProviderCommand = vscode.commands.registerCommand(
    "ccrelay.switchProvider",
    async () => {
      await statusBar?.showProviderPicker();
    }
  );

  const startServerCommand = vscode.commands.registerCommand("ccrelay.startServer", async () => {
    await startServer();
  });

  const stopServerCommand = vscode.commands.registerCommand("ccrelay.stopServer", async () => {
    await stopServer();
  });

  const openSettingsCommand = vscode.commands.registerCommand("ccrelay.openSettings", () => {
    vscode.commands.executeCommand("workbench.action.openSettings", "ccrelay");
  });

  const showLogsCommand = vscode.commands.registerCommand("ccrelay.showLogs", () => {
    logger?.show();
  });

  const clearLogsCommand = vscode.commands.registerCommand("ccrelay.clearLogs", () => {
    logger?.clear();
    vscode.window.showInformationMessage("CCRelay logs cleared");
  });

  const showLogViewerCommand = vscode.commands.registerCommand("ccrelay.showLogViewer", () => {
    if (!server) {
      vscode.window.showErrorMessage("CCRelay server not initialized");
      return;
    }
    const role = server.getRole();
    const leaderUrl = server.getLeaderUrl() ?? "";

    // Get host and port from config
    const config = vscode.workspace.getConfiguration("ccrelay");
    const port = config.get<number>("port", 7575);
    const host = config.get<string>("host", "127.0.0.1");

    LogViewerPanel.createOrShow(leaderUrl, role, host, port, context.extensionUri);
  });

  const openWebUICommand = vscode.commands.registerCommand("ccrelay.openWebUI", () => {
    if (!server || !configManager) {
      vscode.window.showErrorMessage("CCRelay server not initialized");
      return;
    }

    // In follower mode, open the Leader's URL
    const role = server.getRole();
    const leaderUrl = server.getLeaderUrl();

    let url: string;
    if (role === "follower" && leaderUrl) {
      // Follower should open Leader's URL with /ccrelay/ path
      url = leaderUrl.endsWith("/") ? `${leaderUrl}ccrelay/` : `${leaderUrl}/ccrelay/`;
    } else {
      // Leader or standalone: open local URL
      const config = vscode.workspace.getConfiguration("ccrelay");
      const port = config.get<number>("port", 7575);
      const host = config.get<string>("host", "127.0.0.1");
      url = `http://${host}:${port}/ccrelay/`;
    }

    vscode.env.openExternal(vscode.Uri.parse(url));
  });

  context.subscriptions.push(
    showMenuCommand,
    switchProviderCommand,
    startServerCommand,
    stopServerCommand,
    openSettingsCommand,
    showLogsCommand,
    clearLogsCommand,
    showLogViewerCommand,
    openWebUICommand,
    statusBar,
    logger
  );

  // Log extension activation
  const activationTime = Date.now() - activationStart;
  logger.info(`[Extension:${instanceId}] ===== ACTIVATION COMPLETE in ${activationTime}ms =====`);
  logger.info(
    `[Extension:${instanceId}] Memory usage: RSS=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB, HeapTotal=${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB, HeapUsed=${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
  );

  // Auto-start server if configured
  const autoStart = vscode.workspace.getConfiguration("ccrelay").get<boolean>("autoStart", true);
  if (autoStart) {
    logger.info(`[Extension:${instanceId}] Auto-start enabled, starting server...`);
    void startServer();
  }
}

async function startServer(): Promise<void> {
  if (!server || !configManager || !logger) {
    return;
  }

  if (server.running) {
    vscode.window.showInformationMessage("CCRelay server is already running");
    return;
  }

  try {
    const result = await server.start();
    const host = configManager.host;
    const port = configManager.port;

    if (result.role === "leader") {
      logger.info(`[Extension] Started as Leader on http://${host}:${port}`);
      vscode.window.showInformationMessage(`CCRelay started (Leader) on http://${host}:${port}`);
    } else if (result.role === "follower") {
      logger.info(`[Extension] Started as Follower, using leader at ${result.leaderUrl}`);
      vscode.window.showInformationMessage(
        `CCRelay running (Follower) connected to ${result.leaderUrl}`
      );
    } else {
      logger.info(`[Extension] Started in Standalone mode on http://${host}:${port}`);
      vscode.window.showInformationMessage(`CCRelay started on http://${host}:${port}`);
    }

    statusBar?.update();
  } catch (err: unknown) {
    logger.error("Failed to start server", err);
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to start CCRelay server: ${message}`);
  }
}

async function stopServer(): Promise<void> {
  if (!server || !logger) {
    return;
  }

  if (!server.running) {
    vscode.window.showInformationMessage("CCRelay server is not running");
    return;
  }

  try {
    const role = server.getRole();
    await server.stop();

    if (role === "leader") {
      logger.info("[Extension] Stopped as Leader");
      vscode.window.showInformationMessage("CCRelay server stopped (was Leader)");
    } else if (role === "follower") {
      logger.info("[Extension] Stopped as Follower");
      vscode.window.showInformationMessage("CCRelay stopped (was Follower)");
    } else {
      logger.info("[Extension] Stopped in Standalone mode");
      vscode.window.showInformationMessage("CCRelay server stopped");
    }

    statusBar?.update();
  } catch (err: unknown) {
    logger.error("Failed to stop server", err);
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to stop CCRelay server: ${message}`);
  }
}

export async function deactivate(): Promise<void> {
  const deactivateStart = Date.now();

  // Log extension deactivation
  logger?.info(`[Extension] ===== DEACTIVATION START ===== at ${new Date().toISOString()}`);
  logger?.info(
    `[Extension] Memory usage: RSS=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB, HeapTotal=${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB, HeapUsed=${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
  );

  // Create a timeout promise for graceful shutdown (max 5 seconds)
  const timeout = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  try {
    // Stop server on deactivation - MUST await this!
    // Note: server.stop() internally calls leaderElection.stop(), so we don't need to call it separately
    if (server) {
      const role = server.getRole();
      logger?.info(`[Extension] Deactivating with role: ${role}`);

      // Wait for server stop with timeout
      const stopPromise = server.stop();
      const timeoutPromise = timeout(5000).then(() => {
        logger?.warn("[Extension] Server stop timed out after 5s, forcing cleanup");
        // Even if timeout, the server.stop() will eventually complete
        // The timeout just means we proceed with deactivation
      });

      await Promise.race([stopPromise, timeoutPromise]);

      // Double-check: try to wait a bit more for the stop to complete
      // This helps ensure port is released before new plugin version starts
      await Promise.race([stopPromise, timeout(1000)]);

      logger?.info("[Extension] Server stopped successfully");
    }

    // Note: leaderElection.stop() is already called inside server.stop()
    // No need to call it again here
  } catch (err) {
    console.error("Error during deactivation cleanup:", err);
    logger?.error("Error during deactivation cleanup", err);
  } finally {
    // Always cleanup these resources
    if (configManager) {
      configManager.dispose();
    }

    if (logger) {
      logger.dispose();
    }

    // Clear references to help GC
    server = null;
    leaderElection = null;
    configManager = null;
    statusBar = null;

    const deactivationTime = Date.now() - deactivateStart;
    console.log(`[Extension] ===== DEACTIVATION COMPLETE in ${deactivationTime}ms =====`);
  }
}
