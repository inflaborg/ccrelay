import * as vscode from "vscode";
import * as path from "path";
import {
  Api,
  BUILD_HASH,
  BUILD_VERSION,
  ConfigManager,
  GIT_HASH,
  LeaderElection,
  Logger,
  ProxyServer,
  setWebDistPath,
} from "@ccrelay/core";
import { StatusBarManager } from "./vscode/statusBar";
import { LogViewerPanel } from "./vscode/logViewer";
import { DashboardWebviewProvider } from "./vscode/dashboardView";

let server: ProxyServer | null = null;
let statusBar: StatusBarManager | null = null;
let configManager: ConfigManager | null = null;
let logger: Logger | null = null;
let leaderElection: LeaderElection | null = null;
let dashboardProvider: DashboardWebviewProvider | null = null;

export function activate(context: vscode.ExtensionContext) {
  const activationStart = Date.now();
  const instanceId = Math.random().toString(36).substring(2, 9);

  // Initialize logger
  logger = Logger.getInstance();
  logger.info(
    `[Extension:${instanceId}] ===== ACTIVATION START ===== at ${new Date().toISOString()}`
  );
  logger.info(`[Extension:${instanceId}] Process ID: ${process.pid}`);
  logger.info(
    `[Extension:${instanceId}] Build version=${BUILD_VERSION} buildHash=${BUILD_HASH} gitHash=${GIT_HASH}`
  );

  // Serve /ccrelay/* SPA from packaged web assets (matches webview Dashboard / LogViewer roots)
  const webDistDir = path.join(context.extensionUri.fsPath, "out", "web");
  setWebDistPath(webDistDir);
  logger.info(`[Extension:${instanceId}] Web UI HTTP static root: ${webDistDir}`);

  // Initialize configuration manager (auto-creates config file if not exists)
  const configStart = Date.now();
  const cm = new ConfigManager();
  configManager = cm;
  logger.info(
    `[Extension:${instanceId}] ConfigManager initialized in ${Date.now() - configStart}ms`
  );

  // Get server configuration
  const port = cm.port;
  const host = cm.host;

  const leaderElectionStart = Date.now();
  logger.info(`[Extension:${instanceId}] Leader election enabled`);
  leaderElection = new LeaderElection(port, host, () => cm.getApiBearerToken());
  logger.info(
    `[Extension:${instanceId}] LeaderElection initialized in ${Date.now() - leaderElectionStart}ms`
  );

  const serverStart = Date.now();
  server = new ProxyServer(configManager, leaderElection);
  logger.info(`[Extension:${instanceId}] ProxyServer created in ${Date.now() - serverStart}ms`);

  Api.setServer(server);

  statusBar = new StatusBarManager(context, configManager, server);

  const getDashboardConfig = () => {
    if (!server || !configManager) {
      return {
        role: "standalone",
        leaderUrl: "",
        host: "127.0.0.1",
        port: 7575,
        apiBearerToken: "",
      };
    }
    return {
      role: server.getRole(),
      leaderUrl: server.getLeaderUrl() ?? "",
      host: configManager.host,
      port: configManager.port,
      apiBearerToken: configManager.getApiBearerToken(),
    };
  };

  dashboardProvider = new DashboardWebviewProvider(context.extensionUri, getDashboardConfig);

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

  const openSettingsCommand = vscode.commands.registerCommand(
    "ccrelay.openSettings",
    async () => {
      if (!configManager) {
        return;
      }
      try {
        const uri = vscode.Uri.file(configManager.getConfigPath());
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Could not open config file: ${msg}`);
      }
    }
  );

  const showLogsCommand = vscode.commands.registerCommand("ccrelay.showLogs", () => {
    logger?.show();
  });

  const clearLogsCommand = vscode.commands.registerCommand("ccrelay.clearLogs", () => {
    logger?.clear();
    vscode.window.showInformationMessage("CCRelay logs cleared");
  });

  const openWebUICommand = vscode.commands.registerCommand("ccrelay.openWebUI", async () => {
    if (!server || !configManager) {
      vscode.window.showErrorMessage("CCRelay server not initialized");
      return;
    }
    const role = server.getRole();
    const leaderUrl = server.getLeaderUrl() ?? "";
    const portUi = configManager.port;
    const hostUi = configManager.host;

    await LogViewerPanel.createOrShow(
      leaderUrl,
      role,
      hostUi,
      portUi,
      context.extensionUri,
      configManager.getApiBearerToken()
    );
  });

  context.subscriptions.push(
    showMenuCommand,
    switchProviderCommand,
    startServerCommand,
    stopServerCommand,
    openSettingsCommand,
    showLogsCommand,
    clearLogsCommand,
    openWebUICommand,
    vscode.window.registerWebviewViewProvider(DashboardWebviewProvider.viewType, dashboardProvider),
    statusBar,
    logger
  );

  const activationTime = Date.now() - activationStart;
  logger.info(`[Extension:${instanceId}] ===== ACTIVATION COMPLETE in ${activationTime}ms =====`);
  logger.info(
    `[Extension:${instanceId}] Memory usage: RSS=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB, HeapTotal=${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB, HeapUsed=${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
  );

  if (configManager.autoStart) {
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
    void dashboardProvider?.updateWebview();
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
    void dashboardProvider?.updateWebview();
  } catch (err: unknown) {
    logger.error("Failed to stop server", err);
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to stop CCRelay server: ${message}`);
  }
}

export async function deactivate(): Promise<void> {
  const deactivateStart = Date.now();

  logger?.info(`[Extension] ===== DEACTIVATION START ===== at ${new Date().toISOString()}`);
  logger?.info(
    `[Extension] Memory usage: RSS=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB, HeapTotal=${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB, HeapUsed=${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
  );

  const timeout = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  try {
    if (server) {
      const role = server.getRole();
      logger?.info(`[Extension] Deactivating with role: ${role}`);

      const stopPromise = server.stop();
      const timeoutPromise = timeout(5000).then(() => {
        logger?.warn("[Extension] Server stop timed out after 5s, forcing cleanup");
      });

      await Promise.race([stopPromise, timeoutPromise]);
      await Promise.race([stopPromise, timeout(1000)]);

      logger?.info("[Extension] Server stopped successfully");
    }
  } catch (err) {
    console.error("[Extension] Error during deactivation cleanup:", err);
    try {
      logger?.error("Error during deactivation cleanup", err);
    } catch {
      // ignore
    }
  } finally {
    if (configManager) {
      configManager.dispose();
    }

    if (logger) {
      try {
        logger.dispose();
      } catch {
        // ignore
      }
      logger = null;
    }

    server = null;
    leaderElection = null;
    configManager = null;
    statusBar = null;

    const deactivationTime = Date.now() - deactivateStart;
    console.log(`[Extension] ===== DEACTIVATION COMPLETE in ${deactivationTime}ms =====`);
  }
}
