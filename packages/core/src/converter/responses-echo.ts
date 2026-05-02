/**
 * Echo fields from the original POST /v1/responses body into synthesized Responses SSE/JSON,
 * without forwarding hosted tools unsupported by upstream Chat Completions.
 */

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI Responses API wire names */

/** Subset of Responses request fields echoed back into `response.{...}` shells. */
export interface ResponsesRequestEcho {
  tools: unknown[];
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
  reasoning?: { effort?: string | null; summary?: string | null };
  text?: { format?: unknown };
  instructions?: string | null;
  metadata?: Record<string, unknown>;
  store?: boolean;
  previous_response_id?: string | null;
  user?: string | null;
  truncation?: string;
}

/** Collect tools suitable for echo: `type=function` entries and nested `namespace` bundles. Hosted tools omitted. */
export function extractFunctionToolsForEcho(tools: unknown): unknown[] {
  if (!Array.isArray(tools)) {
    return [];
  }
  const out: unknown[] = [];
  for (const t of tools) {
    if (!t || typeof t !== "object") {
      continue;
    }
    const o = t as Record<string, unknown>;
    if (o.type === "function") {
      out.push(t);
      continue;
    }
    if (o.type === "namespace" && Array.isArray(o.tools)) {
      for (const inner of o.tools as unknown[]) {
        if (
          inner &&
          typeof inner === "object" &&
          (inner as { type?: string }).type === "function"
        ) {
          out.push(inner);
        }
      }
    }
    // web_search / mcp / etc. intentionally skipped
  }
  return out;
}

function asRecord(val: unknown): Record<string, unknown> | undefined {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return undefined;
  }
  return val as Record<string, unknown>;
}

/**
 * Pull echo fields from parsed OpenAI Responses request JSON (`raw`).
 */
export function extractResponsesEcho(raw: Record<string, unknown>): ResponsesRequestEcho {
  const tools = extractFunctionToolsForEcho(raw.tools);
  const parallel =
    typeof raw.parallel_tool_calls === "boolean" ? raw.parallel_tool_calls : undefined;
  const store = typeof raw.store === "boolean" ? raw.store : undefined;
  const truncation = typeof raw.truncation === "string" ? raw.truncation : undefined;
  const previous =
    typeof raw.previous_response_id === "string"
      ? raw.previous_response_id
      : raw.previous_response_id === null
        ? null
        : undefined;
  const user = typeof raw.user === "string" ? raw.user : raw.user === null ? null : undefined;
  const instructions =
    typeof raw.instructions === "string"
      ? raw.instructions
      : raw.instructions === null
        ? null
        : undefined;

  let reasoning: ResponsesRequestEcho["reasoning"];
  const rRaw = raw.reasoning;
  const rec = asRecord(rRaw);
  if (rec) {
    reasoning = {
      effort: rec.effort as string | null | undefined,
      summary: rec.summary as string | null | undefined,
    };
  }

  let textFmt: ResponsesRequestEcho["text"];
  const txt = raw.text;
  const textRec = asRecord(txt);
  if (textRec) {
    textFmt = { format: textRec.format };
  }

  let meta: ResponsesRequestEcho["metadata"];
  const m = raw.metadata;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    meta = { ...(m as Record<string, unknown>) };
  }

  let tool_choice: unknown;
  if (raw.tool_choice !== undefined) {
    tool_choice = raw.tool_choice;
  }

  const echo: ResponsesRequestEcho = {
    tools,
    ...(tool_choice !== undefined ? { tool_choice } : {}),
    ...(parallel !== undefined ? { parallel_tool_calls: parallel } : {}),
    ...(store !== undefined ? { store } : {}),
    ...(truncation !== undefined ? { truncation } : {}),
    ...(previous !== undefined ? { previous_response_id: previous } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(textFmt ? { text: textFmt } : {}),
    ...(meta !== undefined ? { metadata: meta } : {}),
  };
  return echo;
}

/**
 * Merge echo into `response.created` / `response.in_progress` / `response.completed` shells (defaults when absent).
 */
export function mergedResponseShellEcho(echo?: ResponsesRequestEcho): Record<string, unknown> {
  return {
    parallel_tool_calls: echo?.parallel_tool_calls ?? true,
    previous_response_id:
      echo?.previous_response_id !== undefined ? echo.previous_response_id : null,
    reasoning: echo?.reasoning ?? { effort: null, summary: null },
    store: echo?.store ?? true,
    text: echo?.text ?? { format: { type: "text" } },
    tool_choice: echo?.tool_choice !== undefined ? echo.tool_choice : "auto",
    tools: echo?.tools ?? [],
    truncation: echo?.truncation ?? "disabled",
    user: echo?.user !== undefined ? echo.user : null,
    metadata: echo?.metadata !== undefined ? { ...echo.metadata } : {},
    instructions: echo?.instructions !== undefined ? echo.instructions : null,
  };
}
