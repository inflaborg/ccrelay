/**
 * Packaged-build auto-update via electron-updater (generic provider).
 * Default channel: saved preference, else version-based (`X.Y.Z-dev.N` →
 * dev, else prod). Users can override via tray → Update Channel; preference
 * is stored in userData. Manifest filenames are always latest-mac.yml /
 * latest.yml (`publish.channel: latest`) so prerelease app versions like
 * 0.2.9-dev.N do not request missing dev-mac.yml files.
 *
 * Windows must quit the tray runtime first, then install silently and relaunch
 * (`quitAndInstall(true, true)`). A plain quit leaves the proxy, the unpacked
 * database worker, or a sqlite3 child holding files, so the installer reports
 * that CCRelay cannot be closed and the new instance never gets the single-
 * instance lock.
 */

import { BrowserWindow, app, dialog, ipcMain } from "electron";
import type { AppUpdater, UpdateInfo } from "electron-updater";
import { Logger } from "@ccrelay/core";
import {
  defaultUpdateChannelFromVersion,
  feedUrlForChannel,
  loadUpdateChannel,
  saveUpdateChannel,
  type UpdateChannel,
} from "./updateChannel";

const log = Logger.getInstance();

const STARTUP_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const BEFORE_QUIT_TIMEOUT_MS = 5_000;

export interface AutoUpdateOptions {
  /** Stop the proxy and child processes before the installer replaces files. */
  beforeQuitForUpdate?: () => Promise<void>;
}

let updater: AppUpdater | null = null;
/** Manual tray check should surface "up to date" / errors; startup check is quiet. */
let manualCheck = false;
let checking = false;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;
/** Resolved channel after init (preference or version default). */
let activeChannel: UpdateChannel | null = null;
let beforeQuitForUpdate: (() => Promise<void>) | null = null;
let progressIpcRegistered = false;

export interface UpdateDownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

let downloadProgress: UpdateDownloadProgress | null = null;

const UPDATE_DOWNLOAD_PROGRESS_CHANNEL = "desktop:update-download-progress";

function publishDownloadProgress(progress: UpdateDownloadProgress | null): void {
  downloadProgress = progress;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(UPDATE_DOWNLOAD_PROGRESS_CHANNEL, progress);
    }
  }
}

function registerDownloadProgressIpc(): void {
  if (progressIpcRegistered) {
    return;
  }
  progressIpcRegistered = true;
  ipcMain.handle(UPDATE_DOWNLOAD_PROGRESS_CHANNEL, () => downloadProgress);
}

function resolveUpdateChannel(): UpdateChannel {
  return loadUpdateChannel() ?? defaultUpdateChannelFromVersion(app.getVersion());
}

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function formatUpdaterLog(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }
  if (message instanceof Error) {
    return message.message;
  }
  if (message === null || message === undefined) {
    return "";
  }
  try {
    return JSON.stringify(message);
  } catch {
    return Object.prototype.toString.call(message);
  }
}

async function showInfoBox(
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  const parent = parentWindow();
  if (parent) {
    return dialog.showMessageBox(parent, options);
  }
  return dialog.showMessageBox(options);
}

async function promptDownload(info: UpdateInfo): Promise<void> {
  const version = info.version || "a newer version";
  const { response } = await showInfoBox({
    type: "info",
    title: "Update available",
    message: `CCRelay ${version} is available.`,
    detail: "Download and install now? The app will restart after the download finishes.",
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0 || !updater) {
    return;
  }
  try {
    await updater.downloadUpdate();
  } catch (e) {
    await showInfoBox({
      type: "error",
      title: "Update failed",
      message: "Could not download the update.",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

async function promptInstall(info: UpdateInfo): Promise<void> {
  const version = info.version || "the update";
  const { response } = await showInfoBox({
    type: "info",
    title: "Update ready",
    message: `CCRelay ${version} has been downloaded.`,
    detail: "Restart now to install?",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0 && updater) {
    await stopRuntimeBeforeUpdate();
    // Windows NSIS: silent (/S) + relaunch. An interactive installer, or a
    // quit that leaves the tray process running, deadlocks on file locks.
    if (process.platform === "win32") {
      updater.quitAndInstall(true, true);
    } else {
      updater.quitAndInstall();
    }
  }
}

async function stopRuntimeBeforeUpdate(): Promise<void> {
  if (!beforeQuitForUpdate) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      beforeQuitForUpdate(),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, BEFORE_QUIT_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    log.warn(
      `[autoUpdater] stop before update failed: ${e instanceof Error ? e.message : String(e)}`
    );
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function applyUpdateChannel(channel: UpdateChannel): void {
  activeChannel = channel;
  if (!updater) {
    return;
  }
  const url = feedUrlForChannel(channel);
  updater.setFeedURL({
    provider: "generic",
    url,
    channel: "latest",
  });
  updater.allowPrerelease = channel === "dev";
  log.info(`[autoUpdater] update channel set to ${channel} (${url})`);
}

/** Effective update channel for tray UI (after init, always set). */
export function getUpdateChannel(): UpdateChannel {
  return activeChannel ?? resolveUpdateChannel();
}

export async function setUpdateChannel(channel: UpdateChannel): Promise<void> {
  saveUpdateChannel(channel);
  applyUpdateChannel(channel);
  await requestUpdateCheck(true);
}

export function isNativeUpdaterEnabled(): boolean {
  return app.isPackaged && updater !== null;
}

export async function requestUpdateCheck(manual: boolean): Promise<void> {
  if (!updater) {
    if (manual) {
      await showInfoBox({
        type: "info",
        title: "Updates",
        message: "Auto-update is only available in packaged builds.",
      });
    }
    return;
  }
  if (checking) {
    return;
  }
  checking = true;
  manualCheck = manual;
  try {
    await updater.checkForUpdates();
  } catch (e) {
    if (manual) {
      await showInfoBox({
        type: "error",
        title: "Update check failed",
        message: "Could not check for updates.",
        detail: e instanceof Error ? e.message : String(e),
      });
    } else {
      log.warn(`[autoUpdater] check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    checking = false;
  }
}

/**
 * Resolve channel (and wire electron-updater when packaged). Call once from
 * `app.whenReady()` before building the tray so the menu matches reality.
 */
export function initAutoUpdate(options?: AutoUpdateOptions): void {
  beforeQuitForUpdate = options?.beforeQuitForUpdate ?? null;
  registerDownloadProgressIpc();
  const channel = resolveUpdateChannel();
  applyUpdateChannel(channel);

  if (!app.isPackaged) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime optional; kept external from esbuild
    const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
    autoUpdater.logger = {
      info: (message?: unknown) => log.info(`[autoUpdater] ${formatUpdaterLog(message)}`),
      warn: (message?: unknown) => log.warn(`[autoUpdater] ${formatUpdaterLog(message)}`),
      error: (message?: unknown) => log.error(`[autoUpdater] ${formatUpdaterLog(message)}`),
      debug: (message?: unknown) => log.debug(`[autoUpdater] ${formatUpdaterLog(message)}`),
    };
    autoUpdater.autoDownload = false;
    // Dev channel tags (dev-X.Y.Z-N) differ from app versions (X.Y.Z-dev.N), so
    // blockmap path rewriting always 404s; skip the failed attempt and full-download.
    autoUpdater.disableDifferentialDownload = true;
    updater = autoUpdater;
    applyUpdateChannel(channel);

    autoUpdater.on("update-available", (info: UpdateInfo) => {
      void promptDownload(info);
    });

    autoUpdater.on("update-not-available", () => {
      if (!manualCheck) {
        return;
      }
      void showInfoBox({
        type: "info",
        title: "Up to date",
        message: `CCRelay ${app.getVersion()} is the latest version.`,
      });
    });

    autoUpdater.on("download-progress", info => {
      publishDownloadProgress({
        percent: info.percent,
        transferred: info.transferred,
        total: info.total,
        bytesPerSecond: info.bytesPerSecond,
      });
    });

    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      publishDownloadProgress(null);
      void promptInstall(info);
    });

    autoUpdater.on("error", (err: Error) => {
      publishDownloadProgress(null);
      log.warn(`[autoUpdater] ${err?.message || err}`);
      if (manualCheck) {
        void showInfoBox({
          type: "error",
          title: "Update error",
          message: "An error occurred while updating.",
          detail: err?.message || String(err),
        });
      }
    });

    startupTimer = setTimeout(() => {
      startupTimer = null;
      void requestUpdateCheck(false);
    }, STARTUP_CHECK_DELAY_MS);

    checkInterval = setInterval(() => {
      void requestUpdateCheck(false);
    }, CHECK_INTERVAL_MS);
  } catch (e) {
    log.warn(`[autoUpdater] init skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function cancelAutoUpdate(): void {
  if (startupTimer !== null) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (checkInterval !== null) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
