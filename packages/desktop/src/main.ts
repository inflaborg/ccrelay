/**
 * CCRelay desktop — Electron main process (system tray + shared core runtime)
 */

import { app } from "electron";
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

app.on("second-instance", () => {
  try {
    Logger.getInstance().info("[Desktop] Second instance attempted launch");
  } catch {
    // Logger may not exist yet
    console.log("[Desktop] Second instance attempted launch");
  }
});

if (process.platform === "darwin") {
  app.dock?.hide();
}

void app.whenReady().then(async () => {
  const logger = Logger.getInstance();
  logger.info("[Desktop] App ready");

  setWebDistPath(resolveWebDist());

  const configManager = new ConfigManager();
  const leaderElection = new LeaderElection(configManager.port, configManager.host);
  const server = new ProxyServer(configManager, leaderElection);

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
