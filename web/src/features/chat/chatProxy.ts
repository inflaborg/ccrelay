import type { ChatMessage, ChatProtocol } from "./types";

/** Origin of the CCRelay proxy (same host that serves /openai and /anthropic). */
export function getProxyOrigin(): string {
  const injected =
    typeof window !== "undefined" && typeof window.CCRELAY_API_URL === "string"
      ? window.CCRELAY_API_URL.trim()
      : "";
  if (injected) {
    return injected.replace(/\/$/, "");
  }
  return window.location.origin;
}

function proxyHeaders(protocol: ChatProtocol): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Inject-mode providers replace this with the real key.
    Authorization: "Bearer ccrelay-chat",
  };
  if (protocol === "anthropic") {
    headers["x-api-key"] = "ccrelay-chat";
    headers["anthropic-version"] = "2023-06-01";
  }
  return headers;
}

export async function fetchProxyModels(protocol: ChatProtocol): Promise<string[]> {
  const origin = getProxyOrigin();
  const path = protocol === "anthropic" ? "/anthropic/v1/models" : "/openai/models";
  const res = await fetch(`${origin}${path}`, {
    method: "GET",
    headers: proxyHeaders(protocol),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  const ids: string[] = [];
  for (const item of data.data ?? []) {
    const id = item.id?.trim();
    if (id) {
      ids.push(id);
    }
  }
  return ids;
}

export interface StreamChatParams {
  protocol: ChatProtocol;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}

function toOpenAiChatMessages(
  messages: ChatMessage[]
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .filter(m => !(m.role === "assistant" && m.error))
    .map(m => ({ role: m.role, content: m.content }));
}

async function* iterateSse(
  response: Response,
  signal?: AbortSignal
): AsyncGenerator<{ event: string; data: string }> {
  if (!response.body) {
    throw new Error("No response body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          yield { event: eventName, data };
          eventName = "";
          continue;
        }
        if (line === "") {
          eventName = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function streamOpenAiChat(params: StreamChatParams): Promise<void> {
  const origin = getProxyOrigin();
  const history = toOpenAiChatMessages(params.messages);
  const res = await fetch(`${origin}/openai/chat/completions`, {
    method: "POST",
    headers: proxyHeaders("openai_chat"),
    signal: params.signal,
    body: JSON.stringify({
      model: params.model,
      messages: history,
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }

  for await (const { data } of iterateSse(res, params.signal)) {
    if (data === "[DONE]") {
      break;
    }
    try {
      const json = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string | null } }>;
        error?: { message?: string };
      };
      if (json.error?.message) {
        throw new Error(json.error.message);
      }
      const chunk = json.choices?.[0]?.delta?.content;
      if (typeof chunk === "string" && chunk.length > 0) {
        params.onDelta(chunk);
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        continue;
      }
      throw e;
    }
  }
}

async function streamOpenAiResponses(params: StreamChatParams): Promise<void> {
  const origin = getProxyOrigin();
  const history = toOpenAiChatMessages(params.messages);
  const res = await fetch(`${origin}/openai/responses`, {
    method: "POST",
    headers: proxyHeaders("openai_responses"),
    signal: params.signal,
    body: JSON.stringify({
      model: params.model,
      input: history,
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }

  for await (const { event, data } of iterateSse(res, params.signal)) {
    if (data === "[DONE]") {
      break;
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof json.error === "object" && json.error && "message" in json.error) {
      throw new Error(String((json.error as { message?: string }).message ?? "error"));
    }
    const type = (typeof json.type === "string" ? json.type : event) || "";
    if (type === "response.output_text.delta" || type === "response.refusal.delta") {
      const delta = json.delta;
      if (typeof delta === "string" && delta.length > 0) {
        params.onDelta(delta);
      }
    }
  }
}

async function streamAnthropic(params: StreamChatParams): Promise<void> {
  const origin = getProxyOrigin();
  const history = toOpenAiChatMessages(params.messages);
  const res = await fetch(`${origin}/anthropic/v1/messages`, {
    method: "POST",
    headers: proxyHeaders("anthropic"),
    signal: params.signal,
    body: JSON.stringify({
      model: params.model,
      max_tokens: 4096,
      messages: history,
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }

  for await (const { data } of iterateSse(res, params.signal)) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = typeof json.type === "string" ? json.type : "";
    if (type === "error") {
      const err = json.error as { message?: string } | undefined;
      throw new Error(err?.message || "Anthropic error");
    }
    if (type === "content_block_delta") {
      const delta = json.delta as { type?: string; text?: string } | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        params.onDelta(delta.text);
      }
    }
  }
}

/** Stream a completion for the given protocol; calls onDelta for each text chunk. */
export async function streamChat(params: StreamChatParams): Promise<void> {
  switch (params.protocol) {
    case "openai_chat":
      return streamOpenAiChat(params);
    case "openai_responses":
      return streamOpenAiResponses(params);
    case "anthropic":
      return streamAnthropic(params);
    default: {
      const _exhaustive: never = params.protocol;
      throw new Error(`Unknown protocol: ${_exhaustive}`);
    }
  }
}

export function defaultProtocolForProvider(
  providerType: ProviderTypeLike | undefined
): ChatProtocol {
  if (providerType === "anthropic") {
    return "anthropic";
  }
  if (providerType === "openai_chat") {
    return "openai_chat";
  }
  return "openai_responses";
}

type ProviderTypeLike = "anthropic" | "openai" | "openai_chat";
