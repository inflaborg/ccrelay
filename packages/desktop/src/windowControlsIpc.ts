/**
 * IPC handlers for frameless window caption buttons (Windows/Linux).
 */

import { BrowserWindow, ipcMain } from "electron";

let registered = false;

function windowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerWindowControlIpc(): void {
  if (registered) {
    return;
  }
  registered = true;

  ipcMain.handle("desktop:window-minimize", event => {
    windowFromEvent(event)?.minimize();
  });

  ipcMain.handle("desktop:window-toggle-maximize", event => {
    const win = windowFromEvent(event);
    if (!win) {
      return;
    }
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle("desktop:window-close", event => {
    windowFromEvent(event)?.close();
  });

  ipcMain.handle("desktop:window-is-maximized", event => {
    return windowFromEvent(event)?.isMaximized() ?? false;
  });
}

export function attachMaximizedEvents(win: BrowserWindow): void {
  const send = (maximized: boolean): void => {
    if (!win.isDestroyed()) {
      win.webContents.send("desktop:window-maximized", maximized);
    }
  };
  win.on("maximize", () => send(true));
  win.on("unmaximize", () => send(false));
}
