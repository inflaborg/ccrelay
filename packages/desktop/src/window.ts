/**
 * Electron BrowserWindow loads the dashboard from bundled web assets (custom protocol).
 * API calls still target the proxy server on the configured host/port.
 *
 * Frameless chrome:
 * - macOS: hiddenInset title bar + native traffic lights; drag via CSS app-region
 * - Windows/Linux: frame:false + renderer caption buttons via preload IPC
 */

import { BrowserWindow, app } from "electron";
import * as path from "path";
import type { ProxyServer, ConfigManager } from "@ccrelay/core";
import { getUpdateChannel, isNativeUpdaterEnabled } from "./autoUpdate";
import {
  dashboardLocalUrl,
  setDashboardInjectConfig,
  type DashboardInjectConfig,
} from "./dashboardProtocol";
import { attachExternalLinkHandlers } from "./externalLinks";
import { attachMaximizedEvents, registerWindowControlIpc } from "./windowControlsIpc";

let dashboardWin: BrowserWindow | null = null;

function resolveApiOrigin(server: ProxyServer, config: ConfigManager): string {
  const base = server.getLeaderUrl() ?? `http://${config.host}:${config.port}`;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function buildInjectConfig(server: ProxyServer, config: ConfigManager): DashboardInjectConfig {
  return {
    apiOrigin: resolveApiOrigin(server, config),
    apiBearer: config.getApiBearerToken(),
    locale: config.locale,
    nativeUpdater: isNativeUpdaterEnabled(),
    desktopPlatform: process.platform,
    updateChannel: getUpdateChannel(),
  };
}

function pushUpdateChannelToDashboard(channel: "prod" | "dev"): void {
  if (!dashboardWin || dashboardWin.isDestroyed()) {
    return;
  }
  const payload = JSON.stringify(channel);
  void dashboardWin.webContents
    .executeJavaScript(
      `window.CCRELAY_UPDATE_CHANNEL=${payload};window.dispatchEvent(new CustomEvent("ccrelay-update-channel",{detail:${payload}}));`
    )
    .catch(() => {
      /* dashboard may be mid-navigation */
    });
}

export function updateDashboardInjectConfig(server: ProxyServer, config: ConfigManager): void {
  const inject = buildInjectConfig(server, config);
  setDashboardInjectConfig(inject);
  if (inject.updateChannel) {
    pushUpdateChannelToDashboard(inject.updateChannel);
  }
}

function preloadPath(): string {
  return path.join(__dirname, "preload.js");
}

export function showDashboardWindow(server: ProxyServer, config: ConfigManager): void {
  updateDashboardInjectConfig(server, config);
  const url = dashboardLocalUrl();

  if (dashboardWin) {
    if (dashboardWin.webContents.getURL() !== url) {
      void dashboardWin.loadURL(url).catch(() => {
        /* load errors surface in renderer */
      });
    }
    dashboardWin.show();
    dashboardWin.focus();
    if (process.platform === "darwin") {
      void app.dock?.show();
    }
    return;
  }

  registerWindowControlIpc();

  const isMac = process.platform === "darwin";

  dashboardWin = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: "CCRelay",
    show: false,
    backgroundColor: "#1f1f1f",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 12 },
        }
      : {
          frame: false,
          autoHideMenuBar: true,
        }),
    webPreferences: {
      preload: preloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  attachMaximizedEvents(dashboardWin);
  attachExternalLinkHandlers(dashboardWin.webContents);

  void dashboardWin.loadURL(url).catch(() => {
    /* ERR_CONNECTION_* etc.: user sees Electron error page */
  });

  dashboardWin.once("ready-to-show", () => {
    dashboardWin?.show();
    dashboardWin?.focus();
  });

  if (isMac) {
    void app.dock?.show();
  }

  dashboardWin.on("closed", () => {
    dashboardWin = null;
    if (process.platform === "darwin") {
      void app.dock?.hide();
    }
  });
}
