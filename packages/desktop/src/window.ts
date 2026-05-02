/**
 * Electron BrowserWindow loads the dashboard over HTTP served by ProxyServer.
 */

import { BrowserWindow, app } from "electron";
import type { ProxyServer, ConfigManager } from "@ccrelay/core";

let dashboardWin: BrowserWindow | null = null;

export function dashboardWebUrl(server: ProxyServer, config: ConfigManager): string {
  const base = server.getLeaderUrl() ?? `http://${config.host}:${config.port}`;
  const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalized}/ccrelay/`;
}

export function showDashboardWindow(url: string): void {
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
