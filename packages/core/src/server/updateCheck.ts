/**
 * Checks GitHub for a newer formal release than the running build.
 * Uses the latest non-prerelease GitHub Release (not main branch package.json).
 * Scheduled on leader HTTP start: once after 60s, then every 24 hours.
 */

import semver from "semver";
import { getBuildVersionInfo } from "../api/version";
import { ScopedLogger } from "../utils/logger";

const log = new ScopedLogger("UpdateCheck");

const REPO = "inflaborg/ccrelay";
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_DELAY_MS = 60_000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

export type UpdateCheckStatus = "pending" | "checking" | "idle" | "available";

export type UpdateCheckState = {
  status: UpdateCheckStatus;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  checkedAt?: string;
};

type GitHubRelease = {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field
  tag_name?: string;
  prerelease?: boolean;
  draft?: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field
  html_url?: string;
  body?: string;
};

let startupTimer: ReturnType<typeof setTimeout> | null = null;
let dailyInterval: ReturnType<typeof setInterval> | null = null;
let schedulersStarted = false;
let checkInProgress = false;

let cachedState: UpdateCheckState = {
  status: "pending",
  currentVersion: getBuildVersionInfo().packageVersion,
};

function userAgent(): string {
  return `CCRelay/${cachedState.currentVersion}`;
}

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header names
      Accept: "application/json",
      // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header names
      "User-Agent": userAgent(),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

function parseReleaseVersion(tagName: string): string | null {
  const stripped = tagName.trim().replace(/^v/i, "");
  return semver.coerce(stripped)?.version ?? null;
}

function finishIdle(): void {
  cachedState = {
    status: "idle",
    currentVersion: getBuildVersionInfo().packageVersion,
    checkedAt: new Date().toISOString(),
  };
}

function finishAvailable(latestVersion: string, releaseUrl: string, releaseNotes: string): void {
  cachedState = {
    status: "available",
    currentVersion: getBuildVersionInfo().packageVersion,
    latestVersion,
    releaseUrl,
    releaseNotes,
    checkedAt: new Date().toISOString(),
  };
}

function clearSchedulers(): void {
  if (startupTimer !== null) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (dailyInterval !== null) {
    clearInterval(dailyInterval);
    dailyInterval = null;
  }
  schedulersStarted = false;
}

export function getUpdateCheckState(): UpdateCheckState {
  return { ...cachedState };
}

export function cancelUpdateCheck(): void {
  clearSchedulers();
  checkInProgress = false;
  cachedState = {
    status: "pending",
    currentVersion: getBuildVersionInfo().packageVersion,
  };
  log.info("Update check cancelled (server stopped)");
}

/** Run an update check immediately (e.g. user clicked "check again" in the UI). */
export async function requestUpdateCheck(): Promise<UpdateCheckState> {
  log.info("Manual update check requested");
  if (startupTimer !== null) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (!checkInProgress) {
    await runUpdateCheck();
  } else {
    log.debug("Update check already in progress (manual request ignored)");
  }
  return getUpdateCheckState();
}

export function scheduleUpdateCheck(): void {
  if (schedulersStarted) {
    return;
  }
  schedulersStarted = true;

  const currentVersion = getBuildVersionInfo().packageVersion;
  cachedState = {
    status: "pending",
    currentVersion,
  };

  log.info(
    `Update check scheduled: first in ${CHECK_DELAY_MS / 1000}s, then every ${DAILY_INTERVAL_MS / 1000 / 60 / 60}h (current version ${currentVersion})`
  );

  startupTimer = setTimeout(() => {
    startupTimer = null;
    void runUpdateCheck();
  }, CHECK_DELAY_MS);

  dailyInterval = setInterval(() => {
    log.info("Daily update check triggered");
    void runUpdateCheck();
  }, DAILY_INTERVAL_MS);
}

export async function runUpdateCheck(): Promise<void> {
  if (checkInProgress) {
    log.debug("Update check already in progress, skipping duplicate run");
    return;
  }
  checkInProgress = true;

  const buildInfo = getBuildVersionInfo();
  cachedState = {
    status: "checking",
    currentVersion: buildInfo.packageVersion,
  };

  log.info(`Starting update check (current version ${buildInfo.packageVersion})`);

  try {
    log.debug(`Fetching latest release from ${LATEST_RELEASE_URL}`);
    const releaseRes = await fetchWithTimeout(LATEST_RELEASE_URL);
    if (!releaseRes.ok) {
      log.warn(`latest release fetch failed: HTTP ${releaseRes.status}`);
      finishIdle();
      return;
    }

    const release = (await releaseRes.json()) as GitHubRelease;
    if (release.draft === true || release.prerelease === true) {
      log.info("Latest release is draft or prerelease, update check complete");
      finishIdle();
      return;
    }

    const tagName = release.tag_name;
    if (!tagName || typeof tagName !== "string") {
      log.warn("latest release missing tag_name");
      finishIdle();
      return;
    }

    const latestForCompare = parseReleaseVersion(tagName);
    const currentCoerced =
      semver.coerce(buildInfo.packageVersion) ?? semver.coerce(buildInfo.version);
    const currentForCompare = currentCoerced?.version ?? "0.0.0";

    log.info(
      `Latest release ${tagName} (resolved ${latestForCompare ?? "invalid"}), current ${currentForCompare}`
    );

    if (!latestForCompare || !semver.gt(latestForCompare, currentForCompare)) {
      log.info("No newer formal release, update check complete");
      finishIdle();
      return;
    }

    const releaseUrl =
      typeof release.html_url === "string"
        ? release.html_url
        : `https://github.com/${REPO}/releases/tag/v${latestForCompare}`;
    const releaseNotes = typeof release.body === "string" ? release.body : "";

    finishAvailable(latestForCompare, releaseUrl, releaseNotes);
    log.info(
      `Update available: v${latestForCompare} (current ${buildInfo.packageVersion}), release ${releaseUrl}`
    );
  } catch (err) {
    log.warn(`Update check failed: ${err instanceof Error ? err.message : String(err)}`);
    finishIdle();
  } finally {
    checkInProgress = false;
    log.debug(`Update check ended (status=${cachedState.status})`);
  }
}
