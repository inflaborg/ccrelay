/**
 * Preload bridge for frameless window controls (Windows/Linux).
 * Drag uses CSS -webkit-app-region in the renderer — not simulated here.
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ccrelayDesktop", {
  platform: process.platform,
  minimize: (): Promise<void> => ipcRenderer.invoke("desktop:window-minimize"),
  toggleMaximize: (): Promise<void> => ipcRenderer.invoke("desktop:window-toggle-maximize"),
  close: (): Promise<void> => ipcRenderer.invoke("desktop:window-close"),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("desktop:window-is-maximized"),
  onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void => {
      callback(maximized);
    };
    ipcRenderer.on("desktop:window-maximized", handler);
    return () => {
      ipcRenderer.removeListener("desktop:window-maximized", handler);
    };
  },
});
