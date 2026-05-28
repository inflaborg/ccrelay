import * as os from "os";
import * as path from "path";

function homePathVar(platform: NodeJS.Platform): string {
  return platform === "win32" ? "%HOME%" : "$HOME";
}

/**
 * Replace the user home directory in an absolute path with $HOME (or %HOME% on Windows).
 */
export function redactHomeInPath(
  filePath: string,
  options?: { home?: string; platform?: NodeJS.Platform }
): string {
  const home = path.normalize(options?.home ?? os.homedir());
  const platform = options?.platform ?? process.platform;
  const normalized = path.normalize(filePath);

  const homeKey = platform === "win32" ? home.toLowerCase() : home;
  const pathKey = platform === "win32" ? normalized.toLowerCase() : normalized;

  if (!pathKey.startsWith(homeKey)) {
    return filePath;
  }

  const rest = normalized.slice(home.length).replace(/^[/\\]+/, "");
  const homeVar = homePathVar(platform);
  if (!rest) {
    return homeVar;
  }

  const sep = platform === "win32" ? "\\" : "/";
  const displayRest = platform === "win32" ? rest.replace(/\//g, "\\") : rest.replace(/\\/g, "/");
  return `${homeVar}${sep}${displayRest}`;
}
