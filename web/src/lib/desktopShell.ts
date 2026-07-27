/** Electron desktop shell helpers (injected by packages/desktop dashboard protocol). */

export type DesktopPlatform = "darwin" | "win32" | "linux" | string;

export function getDesktopPlatform(): DesktopPlatform | "" {
  if (typeof window === "undefined") {
    return "";
  }
  const fromInject =
    typeof window.CCRELAY_DESKTOP_PLATFORM === "string"
      ? window.CCRELAY_DESKTOP_PLATFORM.trim()
      : "";
  if (fromInject) {
    return fromInject;
  }
  return window.ccrelayDesktop?.platform ?? "";
}

export function isElectronDesktop(): boolean {
  return getDesktopPlatform().length > 0;
}

export function isDarwinDesktop(): boolean {
  return getDesktopPlatform() === "darwin";
}

/** Frameless platforms that need in-page caption buttons. */
export function needsWindowCaptionButtons(): boolean {
  const platform = getDesktopPlatform();
  return platform === "win32" || platform === "linux";
}
