import type {
  ProvidersResponse,
  ServerStatus,
  SwitchResponse,
  LogEntry,
  LogsResponse,
  LogsQuery,
  LogStats,
  VersionResponse,
  AddProviderRequest,
  AddProviderResponse,
  DuplicateProviderRequest,
  DuplicateProviderResponse,
  DeleteProviderResponse,
  ReloadConfigResponse,
  ExportProvidersResponse,
  ImportProvidersResponse,
  ClientConfigGetResponse,
  SettingsConfig,
  PatchConfigResponse,
  StatsRange,
  QueueOverviewResponse,
  WizardProbeModelsRequest,
  WizardProbeModelsResponse,
  WizardEndpointTestRequest,
  WizardEndpointTestResponse,
} from "../types/api";

// Re-export types for convenience
export type { LogEntry, LogsQuery };

// Extend Window interface for custom property
declare global {
  interface Window {
    CCRELAY_API_URL?: string;
    /** Injected by VS Code / Cursor dashboard & log viewer webviews for /ccrelay/api Bearer auth */
    CCRELAY_API_BEARER?: string;
    /** Injected by VS Code webviews from backend config.server.locale */
    CCRELAY_LOCALE?: string;
  }
}

function buildDefaultHeaders(includeJsonBody: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (includeJsonBody) {
    h["Content-Type"] = "application/json";
  }
  const bearer =
    typeof window !== "undefined" && typeof window.CCRELAY_API_BEARER === "string"
      ? window.CCRELAY_API_BEARER.trim()
      : "";
  if (bearer.length > 0) {
    h.Authorization = `Bearer ${bearer}`;
  }
  return h;
}

// Check for injected API URL (VSCode webview) or use relative path (dev server)
const API_BASE = window.CCRELAY_API_URL ? `${window.CCRELAY_API_URL}/ccrelay/api` : "/ccrelay/api";

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      ...buildDefaultHeaders(true),
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

/** POST helper: parses JSON on any 2xx; throws only when HTTP status is not ok (e.g. 400). */
async function fetchWizardPostJson<T>(
  endpoint: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: buildDefaultHeaders(true),
    body: JSON.stringify(body),
    signal,
  });
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new Error(data.message || `HTTP ${response.status}`);
  }
  return data as T;
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

  addProvider: (data: AddProviderRequest): Promise<AddProviderResponse> =>
    fetchAPI<AddProviderResponse>("/providers", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  duplicateProvider: (data: DuplicateProviderRequest): Promise<DuplicateProviderResponse> =>
    fetchAPI<DuplicateProviderResponse>("/providers/duplicate", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteProvider: (id: string): Promise<DeleteProviderResponse> =>
    fetchAPI<DeleteProviderResponse>(`/providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  exportProviders: (ids: string[]): Promise<ExportProvidersResponse> =>
    fetchAPI<ExportProvidersResponse>("/providers/export", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  importProviders: (providers: AddProviderRequest[]): Promise<ImportProvidersResponse> =>
    fetchAPI<ImportProvidersResponse>("/providers/import", {
      method: "POST",
      body: JSON.stringify({ providers }),
    }),

  reloadConfig: (): Promise<ReloadConfigResponse> =>
    fetchAPI<ReloadConfigResponse>("/reload", {
      method: "POST",
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
  getStats: (range?: StatsRange): Promise<LogStats> => {
    const params = range && range !== "all" ? `?range=${range}` : "";
    return fetchAPI<LogStats>(`/stats${params}`);
  },

  getQueueStats: (): Promise<QueueOverviewResponse> => fetchAPI<QueueOverviewResponse>("/queue"),

  // Version
  getVersion: (): Promise<VersionResponse> => fetchAPI<VersionResponse>("/version"),

  getClientConfig: (): Promise<ClientConfigGetResponse> =>
    fetchAPI<ClientConfigGetResponse>("/client-config"),

  applyClientConfig: async (body: {
    target: "claudeCode" | "codex" | "claudeDesktop";
    overwrite?: boolean;
    model?: string;
    restore?: boolean;
    patchClaudeModelsOnly?: boolean;
    patchCodexModelOnly?: boolean;
    claudeDefaultModels?: { opus?: string; sonnet?: string; haiku?: string };
  }) => {
    const response = await fetch(`${API_BASE}/client-config/apply`, {
      method: "POST",
      headers: {
        ...buildDefaultHeaders(true),
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string; status?: string };
    if (response.status === 409) {
      const err = new Error(data.message || "Confirm overwrite to apply CCRelay settings");
      (err as Error & { status: number }).status = 409;
      throw err;
    }
    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }
    return data as { status: string; message?: string };
  },

  // Settings
  getConfig: (): Promise<SettingsConfig> => fetchAPI<SettingsConfig>("/config"),

  patchConfig: (body: {
    section: string;
    data?: Record<string, unknown>;
    resetRoutingDefaults?: boolean;
  }): Promise<PatchConfigResponse> =>
    fetchAPI<PatchConfigResponse>("/config", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  wizardProbeModels: (
    body: WizardProbeModelsRequest,
    signal?: AbortSignal
  ): Promise<WizardProbeModelsResponse> =>
    fetchWizardPostJson<WizardProbeModelsResponse>("/wizard/probe-models", body, signal),

  wizardEndpointTest: (
    body: WizardEndpointTestRequest,
    signal?: AbortSignal
  ): Promise<WizardEndpointTestResponse> =>
    fetchWizardPostJson<WizardEndpointTestResponse>("/wizard/endpoint-test", body, signal),
};
