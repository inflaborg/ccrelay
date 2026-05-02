/**
 * CCRelay desktop — Electron main process (system tray + shared core runtime)
 */

import { Menu, app } from "electron";
import * as path from "path";
import {
  Api,
  ConfigManager,
  LeaderElection,
  Logger,
  ProxyServer,
  setWebDistPath,
} from "@ccrelay/core";
import { createTray } from "./tray";
import { showDashboardWindow, dashboardWebUrl } from "./window";

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

  const configManager = new ConfigManager();
  const leaderElection = new LeaderElection(configManager.port, configManager.host);
  const server = new ProxyServer(configManager, leaderElection);

  app.on("second-instance", () => {
    try {
      logger.info("[Desktop] Second instance attempted launch");
    } catch {
      console.log("[Desktop] Second instance attempted launch");
    }
    showDashboardWindow(dashboardWebUrl(server, configManager));
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
});
