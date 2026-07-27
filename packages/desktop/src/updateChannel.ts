/**
 * Persist Electron update channel preference (Stable/prod vs Dev) under userData.
 */

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

export type UpdateChannel = "prod" | "dev";

const PREFS_FILENAME = "update-channel.json";
const FEED_BASE = "https://github.com/inflaborg/ccrelay/releases/download";

function prefsPath(): string {
  return path.join(app.getPath("userData"), PREFS_FILENAME);
}

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return value === "prod" || value === "dev";
}

export function feedUrlForChannel(channel: UpdateChannel): string {
  return `${FEED_BASE}/channel-${channel}`;
}

export function labelForChannel(channel: UpdateChannel): string {
  return channel === "prod" ? "Stable" : "Dev";
}

export function loadUpdateChannel(): UpdateChannel | null {
  try {
    const raw = fs.readFileSync(prefsPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      isUpdateChannel((parsed as { channel?: unknown }).channel)
    ) {
      return (parsed as { channel: UpdateChannel }).channel;
    }
  } catch {
    // Missing or invalid file — use pack-time feed.
  }
  return null;
}

export function saveUpdateChannel(channel: UpdateChannel): void {
  const file = prefsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ channel }, null, 2)}\n`, "utf8");
}
