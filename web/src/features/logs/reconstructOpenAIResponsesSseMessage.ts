/**
 * Reconstruct an OpenAI Responses API `response` object from an SSE log body
 * (`event: response.*` + `data:` JSON). Prefers the final `response.completed` payload;
 * falls back to merging `response.output_item.done` events with the `response.created` shell.
 */

export type ReconstructOpenAIResponsesResult =
  | { ok: true; message: Record<string, unknown> }
  | { ok: false; reason: string };

function parseDataPayload(line: string): string | null {
  const t = line.trim();
  if (!t.startsWith("data:")) {
    return null;
  }
  const rest = t.slice(5).trimStart();
  if (!rest || rest === "[DONE]") {
    return null;
  }
  return rest;
}

function parseSseDataLines(body: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of body.trim().split("\n")) {
    const dataStr = parseDataPayload(line);
    if (!dataStr) {
      continue;
    }
    try {
      events.push(JSON.parse(dataStr) as Record<string, unknown>);
    } catch {
      continue;
    }
  }
  return events;
}

/** True when the body contains OpenAI Responses API streaming events. */
export function isOpenAIResponsesSseBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) {
    return false;
  }
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (t.startsWith("event: response.")) {
      return true;
    }
    const dataStr = parseDataPayload(line);
    if (!dataStr) {
      continue;
    }
    try {
      const data = JSON.parse(dataStr) as Record<string, unknown>;
      if (typeof data.type === "string" && data.type.startsWith("response.")) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export function reconstructOpenAIResponsesFromSseLogBody(
  body: string
): ReconstructOpenAIResponsesResult {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }
  if (!isOpenAIResponsesSseBody(trimmed)) {
    return { ok: false, reason: "not_openai_responses_sse" };
  }

  const events = parseSseDataLines(trimmed);

  for (const data of events) {
    if (data.type === "response.completed" && data.response && typeof data.response === "object") {
      return { ok: true, message: data.response as Record<string, unknown> };
    }
  }

  let shell: Record<string, unknown> | null = null;
  const outputByIndex: Record<number, unknown> = {};

  for (const data of events) {
    if (data.type === "response.created" && data.response && typeof data.response === "object") {
      shell = structuredClone(data.response) as Record<string, unknown>;
    }
    if (data.type === "response.output_item.done") {
      const index = data.output_index;
      if (typeof index === "number" && data.item !== undefined) {
        outputByIndex[index] = data.item;
      }
    }
  }

  if (!shell) {
    return { ok: false, reason: "no_response_shell" };
  }

  const indices = Object.keys(outputByIndex)
    .map(Number)
    .sort((a, b) => a - b);
  if (indices.length === 0) {
    return { ok: false, reason: "no_output_items" };
  }

  shell.output = indices.map(i => outputByIndex[i]);
  return { ok: true, message: shell };
}
