/**
 * CCRelay desktop — Electron main process (system tray + shared core runtime)
 */

import { Menu, app, session } from "electron";
import * as path from "path";
import {
  Api,
  CCRELAY_UI_HEADER_NAME,
  CCRELAY_UI_HEADER_VALUE,
  ConfigManager,
  LeaderElection,
  Logger,
  ProxyServer,
  loggingDatabaseConfigToDriver,
  setLogDatabaseDriverConfigResolver,
  setWebDistPath,
} from "@ccrelay/core";
import { createTray } from "./tray";
import { showDashboardWindow } from "./window";
import {
  registerDashboardProtocolHandler,
  registerDashboardProtocolSchemes,
} from "./dashboardProtocol";

registerDashboardProtocolSchemes();

function registerLocalCcrelayRequestHeaders(configManager: ConfigManager): void {
  const port = configManager.port;
  const bindHost = configManager.host.trim();
  const urls: string[] = [
    `http://127.0.0.1:${port}/ccrelay/*`,
    `http://localhost:${port}/ccrelay/*`,
  ];
  if (bindHost && bindHost !== "127.0.0.1" && bindHost !== "localhost") {
    urls.push(`http://${bindHost}:${port}/ccrelay/*`);
  }

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    const requestHeaders: Record<string, string | string[]> = {
      ...(details.requestHeaders as Record<string, string | string[]>),
      [CCRELAY_UI_HEADER_NAME]: CCRELAY_UI_HEADER_VALUE,
    };
    if (details.url.includes("/ccrelay/api/")) {
      requestHeaders.Authorization = `Bearer ${configManager.getApiBearerToken()}`;
    }
    callback({ requestHeaders });
  });
}

function resolveWebDist(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "web");
  }
  return path.join(__dirname, "..", "web");
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

if (process.platform === "darwin") {
  app.dock?.hide();
}

app.on("window-all-closed", () => {
  // Tray-driven app: BrowserWindow teardown must not terminate the process.
});

void app.whenReady().then(async () => {
  const logger = Logger.getInstance();
  logger.info("[Desktop] App ready");

  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
  }

  setWebDistPath(resolveWebDist());
  registerDashboardProtocolHandler(resolveWebDist());

  const configManager = new ConfigManager();
  setLogDatabaseDriverConfigResolver(() => {
    const base = loggingDatabaseConfigToDriver(configManager.configValue.logging.database);
    if (base?.type === "sqlite") {
      return { ...base, driver: base.driver === "cli" ? "cli" : "native" };
    }
    return base;
  });

  const leaderElection = new LeaderElection(configManager.port, configManager.host, () =>
    configManager.getApiBearerToken()
  );
  const server = new ProxyServer(configManager, leaderElection);

  registerLocalCcrelayRequestHeaders(configManager);

  app.on("second-instance", () => {
    try {
      logger.info("[Desktop] Second instance attempted launch");
    } catch {
      console.log("[Desktop] Second instance attempted launch");
    }
    showDashboardWindow(server, configManager);
  });

  Api.setServer(server);

  if (configManager.autoStart) {
    try {
      await server.start();
    } catch (err: unknown) {
      logger.error("[Desktop] Failed to auto-start server", err);
    }
  }

  createTray(server, configManager);
  showDashboardWindow(server, configManager);
});
