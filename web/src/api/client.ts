import type {
  ProvidersResponse,
  ServerStatus,
  SwitchResponse,
  LogEntry,
  LogsResponse,
  LogsQuery,
  LogStats,
  VersionResponse,
} from "../types/api";

// Re-export types for convenience
export type { LogEntry, LogsQuery };

// Extend Window interface for custom property
declare global {
  interface Window {
    CCRELAY_API_URL?: string;
  }
}

// Check for injected API URL (VSCode webview) or use relative path (dev server)
const API_BASE = window.CCRELAY_API_URL ? `${window.CCRELAY_API_URL}/ccrelay/api` : "/ccrelay/api";

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Status
  getStatus: (): Promise<ServerStatus> => fetchAPI<ServerStatus>("/status"),

  // Providers
  getProviders: (): Promise<ProvidersResponse> => fetchAPI<ProvidersResponse>("/providers"),

  switchProvider: (providerId: string): Promise<SwitchResponse> =>
    fetchAPI<SwitchResponse>("/switch", {
      method: "POST",
      body: JSON.stringify({ provider: providerId }),
    }),

  // Logs
  getLogs: (query: LogsQuery = {}): Promise<LogsResponse> => {
    const params = new URLSearchParams();
    if (query.limit) params.append("limit", query.limit.toString());
    if (query.offset) params.append("offset", query.offset.toString());
    if (query.providerId) params.append("providerId", query.providerId);
    if (query.method) params.append("method", query.method);
    if (query.pathPattern) params.append("pathPattern", query.pathPattern);
    if (query.hasError !== undefined) params.append("hasError", query.hasError.toString());

    return fetchAPI<LogsResponse>(`/logs?${params.toString()}`);
  },

  getLogById: (id: number): Promise<{ log: LogEntry | null }> =>
    fetchAPI<{ log: LogEntry | null }>(`/logs/${id}`),

  deleteLogs: (ids: number[]): Promise<void> =>
    fetchAPI<void>("/logs", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),

  clearAllLogs: (): Promise<void> =>
    fetchAPI<void>("/logs", {
      method: "DELETE",
      body: JSON.stringify({ clearAll: true }),
    }),

  // Stats
  getStats: (): Promise<LogStats> => fetchAPI<LogStats>("/stats"),

  // Version
  getVersion: (): Promise<VersionResponse> => fetchAPI<VersionResponse>("/version"),
};
