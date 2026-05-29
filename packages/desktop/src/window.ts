/**
 * Electron BrowserWindow loads the dashboard from bundled web assets (custom protocol).
 * API calls still target the proxy server on the configured host/port.
 */

import { BrowserWindow, app } from "electron";
import type { ProxyServer, ConfigManager } from "@ccrelay/core";
import {
  dashboardLocalUrl,
  setDashboardInjectConfig,
  type DashboardInjectConfig,
} from "./dashboardProtocol";
import { attachExternalLinkHandlers } from "./externalLinks";

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
  };
}

export function showDashboardWindow(server: ProxyServer, config: ConfigManager): void {
  setDashboardInjectConfig(buildInjectConfig(server, config));
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

  dashboardWin = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: "CCRelay",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  attachExternalLinkHandlers(dashboardWin.webContents);

  void dashboardWin.loadURL(url).catch(() => {
    /* ERR_CONNECTION_* etc.: user sees Electron error page */
  });

  dashboardWin.once("ready-to-show", () => {
    dashboardWin?.show();
    dashboardWin?.focus();
  });

  if (process.platform === "darwin") {
    void app.dock?.show();
  }

  dashboardWin.on("closed", () => {
    dashboardWin = null;
    if (process.platform === "darwin") {
      void app.dock?.hide();
    }
  });
}
