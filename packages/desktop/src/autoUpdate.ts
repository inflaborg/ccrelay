/**
 * Packaged-build auto-update via electron-updater (generic provider).
 * Feed URL is baked at pack time from electron-builder `publish.url`
 * (channel-prod / channel-dev). Manifest filenames are always
 * latest-mac.yml / latest.yml (`publish.channel: latest`) so prerelease
 * app versions like 0.2.9-dev.N do not request missing dev-mac.yml files.
 */

import { BrowserWindow, app, dialog } from "electron";
import type { AppUpdater, UpdateInfo } from "electron-updater";
import { Logger } from "@ccrelay/core";

const log = Logger.getInstance();

const STARTUP_CHECK_DELAY_MS = 15_000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

let updater: AppUpdater | null = null;
/** Manual tray check should surface "up to date" / errors; startup check is quiet. */
let manualCheck = false;
let checking = false;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let dailyInterval: ReturnType<typeof setInterval> | null = null;

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
    updater.quitAndInstall();
  }
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
 * Wire electron-updater when packaged. Call once from `app.whenReady()`.
 */
export function initAutoUpdate(): void {
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

    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      void promptInstall(info);
    });

    autoUpdater.on("error", (err: Error) => {
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

    dailyInterval = setInterval(() => {
      void requestUpdateCheck(false);
    }, DAILY_INTERVAL_MS);
  } catch (e) {
    log.warn(`[autoUpdater] init skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function cancelAutoUpdate(): void {
  if (startupTimer !== null) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (dailyInterval !== null) {
    clearInterval(dailyInterval);
    dailyInterval = null;
  }
}
