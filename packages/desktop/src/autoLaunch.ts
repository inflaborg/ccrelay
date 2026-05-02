import { app } from "electron";

/**
 * Register / unregister launching CCRelay when the user logs in (macOS / Windows).
 */
export function setOpenAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    path: process.execPath,
    args: [],
  });
}

export function getOpenAtLogin(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}
