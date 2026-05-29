/**
 * Open http(s) links in the system browser instead of the dashboard webview.
 */

import type { WebContents } from "electron";
import { shell } from "electron";
import { DASHBOARD_PROTOCOL } from "./dashboardProtocol";

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function isDashboardUrl(url: string): boolean {
  return url.startsWith(`${DASHBOARD_PROTOCOL}://`);
}

export function attachExternalLinkHandlers(webContents: WebContents): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  webContents.on("will-navigate", (event, url) => {
    if (isDashboardUrl(url)) {
      return;
    }
    event.preventDefault();
    if (isHttpUrl(url)) {
      void shell.openExternal(url);
    }
  });
}
