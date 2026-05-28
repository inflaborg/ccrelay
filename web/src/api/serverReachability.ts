import type { ServerStatus } from "../types/api";

type CcrelayRuntime = {
  CCRELAY_API_URL?: string;
  CCRELAY_API_BEARER?: string;
  location?: { host: string; origin: string };
};

function readRuntime(): CcrelayRuntime {
  if (typeof globalThis === "undefined") {
    return {};
  }
  return globalThis as CcrelayRuntime;
}

function buildDefaultHeaders(includeJsonBody: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (includeJsonBody) {
    h["Content-Type"] = "application/json";
  }
  const runtime = readRuntime();
  const bearer =
    typeof runtime.CCRELAY_API_BEARER === "string" ? runtime.CCRELAY_API_BEARER.trim() : "";
  if (bearer.length > 0) {
    h.Authorization = `Bearer ${bearer}`;
  }
  return h;
}

export function getApiBase(): string {
  const runtime = readRuntime();
  return runtime.CCRELAY_API_URL ? `${runtime.CCRELAY_API_URL}/ccrelay/api` : "/ccrelay/api";
}

/** Human-readable API origin for the stopped-server screen. */
export function getApiOriginLabel(): string {
  const runtime = readRuntime();
  if (runtime.CCRELAY_API_URL) {
    try {
      return new URL(runtime.CCRELAY_API_URL).host;
    } catch {
      return runtime.CCRELAY_API_URL;
    }
  }
  return runtime.location?.host || "127.0.0.1:7575";
}

export const STOPPED_SERVER_STATUS: ServerStatus = {
  status: "stopped",
  currentProvider: "",
  providerName: null,
  providerMode: null,
  port: 0,
  host: "",
};

export function isServerUnreachableHttpStatus(status: number): boolean {
  return status === 503 || status >= 502;
}

export async function probeServerReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/status`, {
      headers: buildDefaultHeaders(false),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchServerStatus(): Promise<ServerStatus> {
  try {
    const response = await fetch(`${getApiBase()}/status`, {
      headers: buildDefaultHeaders(false),
    });
    if (response.ok) {
      return response.json() as Promise<ServerStatus>;
    }
    if (isServerUnreachableHttpStatus(response.status)) {
      return STOPPED_SERVER_STATUS;
    }
    const errorBody = (await response.json().catch(() => ({ message: "Unknown error" }))) as {
      message?: string;
    };
    throw new Error(errorBody.message || `HTTP ${response.status}`);
  } catch (err) {
    if (err instanceof TypeError) {
      return STOPPED_SERVER_STATUS;
    }
    throw err;
  }
}
