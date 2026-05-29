/**
 * SQLite version checks for migration and driver requirements.
 */

export const SQLITE_MIN_VERSION = "3.35.0";

export function parseSqliteVersion(versionStr: string): [number, number, number] | null {
  const match = versionStr.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

export function isSqliteVersionAtLeast(versionStr: string, minimum: string): boolean {
  const v = parseSqliteVersion(versionStr);
  const min = parseSqliteVersion(minimum);
  if (!v || !min) {
    return false;
  }
  if (v[0] !== min[0]) {
    return v[0] > min[0];
  }
  if (v[1] !== min[1]) {
    return v[1] > min[1];
  }
  return v[2] >= min[2];
}
