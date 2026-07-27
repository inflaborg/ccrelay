import { api } from "@/api/client";
import type { LogEntry, LogsQuery, StatsRange } from "@/types/api";
import { LOGS_SCHEMA_KNOWLEDGE } from "./prompts";
import { normalizeMemoryMarkdown } from "./memory";

/** OpenAI Chat Completions tool definition. */
export interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const STATS_RANGES = new Set<StatsRange>(["1d", "7d", "30d", "all"]);

const LOG_TOOL_DEFINITIONS: OpenAiToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_logs_schema",
      description:
        "Return schema and investigation tips for this machine's CCRelay request logs and metrics. Use only when helping with local proxy/log/token questions.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_stats",
      description:
        "Aggregated request and token stats for this local CCRelay instance. Use only for local traffic/token questions on this machine.",
      parameters: {
        type: "object",
        properties: {
          range: {
            type: "string",
            enum: ["1d", "7d", "30d", "all"],
            description: "Time window. Default 1d for recent usage.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_logs",
      description:
        "List this machine's CCRelay request logs (metadata and per-request tokens). Use only for local operational investigation.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 20, max 100)" },
          offset: { type: "integer", description: "Pagination offset (default 0)" },
          providerId: { type: "string", description: "Filter by provider id" },
          method: { type: "string", description: "HTTP method filter, e.g. POST" },
          pathPattern: {
            type: "string",
            description: "Substring / LIKE pattern matched against path",
          },
          hasError: { type: "boolean", description: "If true, only unsuccessful requests" },
          startTime: {
            type: "integer",
            description: "Inclusive lower bound timestamp (ms epoch)",
          },
          endTime: {
            type: "integer",
            description: "Inclusive upper bound timestamp (ms epoch)",
          },
          minDuration: { type: "integer", description: "Minimum duration in ms" },
          maxDuration: { type: "integer", description: "Maximum duration in ms" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_log_by_id",
      description:
        "Fetch one local CCRelay request log by id, including bodies/headers. Use only when inspecting a specific local request.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "Log id from query_logs" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
];

const MEMORY_TOOL_DEFINITION: OpenAiToolDefinition = {
  type: "function",
  function: {
    name: "update_memory",
    description:
      "Optional. Replace session memory markdown (History Summary, Plan, Insights) for multi-step work. Skip for simple answers.",
    parameters: {
      type: "object",
      properties: {
        memoryMarkdown: {
          type: "string",
          description: "Full markdown document for session memory",
        },
      },
      required: ["memoryMarkdown"],
      additionalProperties: false,
    },
  },
};

const WEB_SEARCH_TOOL_DEFINITION: OpenAiToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the public web via the configured Capabilities search backend. Use when the answer needs external or up-to-date information beyond this chat and local logs.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

const WEB_FETCH_TOOL_DEFINITION: OpenAiToolDefinition = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "Fetch readable content from a specific http(s) URL. Use after web_search or when the user provides a URL.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute http(s) URL to fetch",
        },
        query: {
          type: "string",
          description: "Optional focus query to rank/extract relevant chunks (Tavily only)",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
};

export interface AgentToolOptions {
  webSearchAvailable: boolean;
  webFetchAvailable: boolean;
}

/** Tools exposed to the model for this turn. */
export function getAgentToolDefinitions(options: AgentToolOptions): OpenAiToolDefinition[] {
  const tools = [...LOG_TOOL_DEFINITIONS, MEMORY_TOOL_DEFINITION];
  if (options.webSearchAvailable) {
    tools.push(WEB_SEARCH_TOOL_DEFINITION);
  }
  if (options.webFetchAvailable) {
    tools.push(WEB_FETCH_TOOL_DEFINITION);
  }
  return tools;
}

/** @deprecated Use getAgentToolDefinitions — kept for any stray imports. */
export const AGENT_TOOL_DEFINITIONS = getAgentToolDefinitions({
  webSearchAvailable: false,
  webFetchAvailable: false,
});

const BODY_TRUNCATE = 12_000;

function truncateField(value: string | undefined, max = BODY_TRUNCATE): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}

function summarizeLogListItem(log: LogEntry): Record<string, unknown> {
  return {
    id: log.id,
    timestamp: log.timestamp,
    providerId: log.providerId,
    providerName: log.providerName,
    method: log.method,
    path: log.path,
    targetUrl: log.targetUrl,
    statusCode: log.statusCode,
    success: log.success,
    errorMessage: log.errorMessage,
    status: log.status,
    routeType: log.routeType,
    model: log.model,
    mappedModel: log.mappedModel,
    duration: log.duration,
    ttfb: log.ttfb,
    queueWaitMs: log.queueWaitMs,
    upstreamTtfbMs: log.upstreamTtfbMs,
    genMs: log.genMs,
    totalMs: log.totalMs,
    inputTokens: log.inputTokens,
    outputTokens: log.outputTokens,
    cacheTokens: log.cacheTokens,
  };
}

function summarizeLogDetail(log: LogEntry): Record<string, unknown> {
  return {
    ...summarizeLogListItem(log),
    serviceHandler: log.serviceHandler,
    serviceMeta: truncateField(log.serviceMeta, 4000),
    requestHeaders: truncateField(log.requestHeaders),
    responseHeaders: truncateField(log.responseHeaders),
    requestBody: truncateField(log.requestBody),
    responseBody: truncateField(log.responseBody),
    originalRequestBody: truncateField(log.originalRequestBody),
    originalResponseBody: truncateField(log.originalResponseBody),
  };
}

function asObject(argsJson: string): Record<string, unknown> {
  if (!argsJson.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function optionalString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function optionalInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === "string" && v.trim()) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function optionalBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") {
    return v;
  }
  return undefined;
}

export interface ToolExecutionContext {
  getMemory: () => string;
  setMemory: (markdown: string) => void;
}

export interface ToolExecutionResult {
  /** JSON-serializable or plain text content returned to the model. */
  content: string;
  ok: boolean;
  /** Short label for UI (args summary). */
  summary: string;
}

export async function executeAgentTool(
  name: string,
  argsJson: string,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const args = asObject(argsJson);

  switch (name) {
    case "get_logs_schema": {
      return {
        ok: true,
        summary: "schema",
        content: LOGS_SCHEMA_KNOWLEDGE,
      };
    }
    case "get_stats": {
      const rawRange = optionalString(args.range) ?? "1d";
      const range: StatsRange = STATS_RANGES.has(rawRange as StatsRange)
        ? (rawRange as StatsRange)
        : "1d";
      try {
        const stats = await api.getStats(range);
        return {
          ok: true,
          summary: `range=${range}`,
          content: JSON.stringify({ range, ...stats }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          summary: `range=${range}`,
          content: JSON.stringify({ error: message }),
        };
      }
    }
    case "query_logs": {
      const limitRaw = optionalInt(args.limit) ?? 20;
      const limit = Math.min(100, Math.max(1, limitRaw));
      const offset = Math.max(0, optionalInt(args.offset) ?? 0);
      const query: LogsQuery = {
        limit,
        offset,
        providerId: optionalString(args.providerId),
        method: optionalString(args.method),
        pathPattern: optionalString(args.pathPattern),
        hasError: optionalBool(args.hasError),
        startTime: optionalInt(args.startTime),
        endTime: optionalInt(args.endTime),
        minDuration: optionalInt(args.minDuration),
        maxDuration: optionalInt(args.maxDuration),
      };
      const filterBits = Object.entries(query)
        .filter(([k, v]) => k !== "limit" && k !== "offset" && v !== undefined)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(", ");
      try {
        const res = await api.getLogs(query);
        const payload = {
          total: res.total,
          hasMore: res.hasMore,
          count: res.logs.length,
          logs: res.logs.map(summarizeLogListItem),
        };
        return {
          ok: true,
          summary: filterBits ? `n=${limit} ${filterBits}` : `n=${limit} offset=${offset}`,
          content: JSON.stringify(payload),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, summary: "failed", content: JSON.stringify({ error: message }) };
      }
    }
    case "get_log_by_id": {
      const id = optionalInt(args.id);
      if (id === undefined) {
        return {
          ok: false,
          summary: "missing id",
          content: JSON.stringify({ error: "id is required" }),
        };
      }
      try {
        const res = await api.getLogById(id);
        if (!res.log) {
          return {
            ok: false,
            summary: `id=${id}`,
            content: JSON.stringify({ error: "log not found", id }),
          };
        }
        return {
          ok: true,
          summary: `id=${id}`,
          content: JSON.stringify(summarizeLogDetail(res.log)),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          summary: `id=${id}`,
          content: JSON.stringify({ error: message }),
        };
      }
    }
    case "update_memory": {
      const raw = optionalString(args.memoryMarkdown);
      if (!raw) {
        return {
          ok: false,
          summary: "empty",
          content: JSON.stringify({ error: "memoryMarkdown is required" }),
        };
      }
      const next = normalizeMemoryMarkdown(raw);
      ctx.setMemory(next);
      return {
        ok: true,
        summary: "updated",
        content: JSON.stringify({ ok: true, length: next.length }),
      };
    }
    case "web_search": {
      const query = optionalString(args.query);
      if (!query) {
        return {
          ok: false,
          summary: "missing query",
          content: JSON.stringify({ error: "query is required" }),
        };
      }
      try {
        const res = await api.webSearch(query);
        return {
          ok: true,
          summary: query.length > 40 ? `${query.slice(0, 40)}…` : query,
          content: JSON.stringify(res),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          summary: query.length > 40 ? `${query.slice(0, 40)}…` : query,
          content: JSON.stringify({ error: message }),
        };
      }
    }
    case "web_fetch": {
      const url = optionalString(args.url);
      if (!url) {
        return {
          ok: false,
          summary: "missing url",
          content: JSON.stringify({ error: "url is required" }),
        };
      }
      const focus = optionalString(args.query);
      try {
        const res = await api.webFetch(url, focus);
        const host = (() => {
          try {
            return new URL(url).hostname;
          } catch {
            return url.slice(0, 40);
          }
        })();
        return {
          ok: true,
          summary: host,
          content: JSON.stringify(res),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          summary: url.slice(0, 40),
          content: JSON.stringify({ error: message }),
        };
      }
    }
    default:
      return {
        ok: false,
        summary: name,
        content: JSON.stringify({ error: `Unknown tool: ${name}` }),
      };
  }
}

/** One-line UI label for a tool call. */
export function formatToolCallLabel(name: string, argsJson: string): string {
  const args = asObject(argsJson);
  switch (name) {
    case "get_log_by_id":
      return `get_log_by_id id=${optionalInt(args.id) ?? "?"}`;
    case "query_logs": {
      const bits: string[] = [];
      if (args.hasError === true) bits.push("errors");
      if (optionalString(args.pathPattern)) bits.push(`path~${optionalString(args.pathPattern)}`);
      if (optionalString(args.providerId)) bits.push(`provider=${optionalString(args.providerId)}`);
      return bits.length ? `query_logs ${bits.join(" ")}` : "query_logs";
    }
    case "update_memory":
      return "update_memory";
    case "get_logs_schema":
      return "get_logs_schema";
    case "get_stats": {
      const range = optionalString(args.range) ?? "1d";
      return `get_stats range=${range}`;
    }
    case "web_search": {
      const q = optionalString(args.query) ?? "";
      return q ? `web_search ${q.length > 40 ? `${q.slice(0, 40)}…` : q}` : "web_search";
    }
    case "web_fetch": {
      const url = optionalString(args.url) ?? "";
      try {
        return url ? `web_fetch ${new URL(url).hostname}` : "web_fetch";
      } catch {
        return url ? `web_fetch ${url.slice(0, 40)}` : "web_fetch";
      }
    }
    default:
      return name;
  }
}
