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

function usableMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .filter(m => !(m.role === "assistant" && m.error));
}

function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) {
    return null;
  }
  return { mediaType: m[1]!.trim(), base64: m[2]! };
}

type OpenAiChatContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

function toOpenAiChatMessages(
  messages: ChatMessage[]
): Array<{ role: "user" | "assistant"; content: OpenAiChatContent }> {
  return usableMessages(messages).map(m => {
    const images = m.images?.filter(img => img.dataUrl) ?? [];
    if (m.role === "assistant" || images.length === 0) {
      return { role: m.role, content: m.content };
    }
    const parts: Array<
      { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
    > = [];
    if (m.content.trim()) {
      parts.push({ type: "text", text: m.content });
    }
    for (const img of images) {
      parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
    }
    if (parts.length === 0) {
      return { role: m.role, content: "" };
    }
    return { role: m.role, content: parts };
  });
}

type ResponsesInputContent =
  | string
  | Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string }
      | { type: "output_text"; text: string }
    >;

function toOpenAiResponsesInput(
  messages: ChatMessage[]
): Array<{ role: "user" | "assistant"; content: ResponsesInputContent }> {
  return usableMessages(messages).map(m => {
    const images = m.images?.filter(img => img.dataUrl) ?? [];
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content.trim() ? [{ type: "output_text", text: m.content }] : m.content,
      };
    }
    if (images.length === 0) {
      return { role: "user", content: m.content };
    }
    const parts: Array<
      { type: "input_text"; text: string } | { type: "input_image"; image_url: string }
    > = [];
    if (m.content.trim()) {
      parts.push({ type: "input_text", text: m.content });
    }
    for (const img of images) {
      parts.push({ type: "input_image", image_url: img.dataUrl });
    }
    return { role: "user", content: parts.length > 0 ? parts : m.content };
  });
}

type AnthropicContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
        }
    >;

function toAnthropicMessages(
  messages: ChatMessage[]
): Array<{ role: "user" | "assistant"; content: AnthropicContent }> {
  return usableMessages(messages).map(m => {
    const images = m.images?.filter(img => img.dataUrl) ?? [];
    if (m.role === "assistant" || images.length === 0) {
      return { role: m.role, content: m.content };
    }
    const parts: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
        }
    > = [];
    for (const img of images) {
      const parsed = parseDataUrl(img.dataUrl);
      if (!parsed) {
        continue;
      }
      parts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mimeType || parsed.mediaType,
          data: parsed.base64,
        },
      });
    }
    if (m.content.trim()) {
      parts.push({ type: "text", text: m.content });
    }
    return { role: "user", content: parts.length > 0 ? parts : m.content };
  });
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

function isEventStream(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("text/event-stream");
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

  // Non-streaming JSON: render complete content once (no fake typewriter).
  if (!isEventStream(res)) {
    applyOpenAiChatJsonBody(await res.text(), params.onDelta);
    return;
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

function applyOpenAiChatJsonBody(body: string, onDelta: (text: string) => void): void {
  const trimmed = body.trim();
  if (!trimmed) {
    return;
  }
  let json: {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string };
  };
  try {
    json = JSON.parse(trimmed) as typeof json;
  } catch {
    throw new Error(trimmed.slice(0, 500) || "Invalid OpenAI chat response");
  }
  if (json.error?.message) {
    throw new Error(json.error.message);
  }
  const content = json.choices?.[0]?.message?.content;
  if (typeof content === "string" && content) {
    onDelta(content);
  }
}

async function streamOpenAiResponses(params: StreamChatParams): Promise<void> {
  const origin = getProxyOrigin();
  const history = toOpenAiResponsesInput(params.messages);
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

  if (!isEventStream(res)) {
    applyOpenAiResponsesJsonBody(await res.text(), params.onDelta);
    return;
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

function applyOpenAiResponsesJsonBody(body: string, onDelta: (text: string) => void): void {
  const trimmed = body.trim();
  if (!trimmed) {
    return;
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new Error(trimmed.slice(0, 500) || "Invalid OpenAI Responses body");
  }
  if (typeof json.error === "object" && json.error && "message" in json.error) {
    throw new Error(String((json.error as { message?: string }).message ?? "error"));
  }
  const output = json.output;
  if (!Array.isArray(output)) {
    return;
  }
  let text = "";
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const p = part as { type?: string; text?: string };
      if ((p.type === "output_text" || p.type === "text") && typeof p.text === "string") {
        text += p.text;
      }
    }
  }
  if (text) {
    onDelta(text);
  }
}

async function streamAnthropic(params: StreamChatParams): Promise<void> {
  const origin = getProxyOrigin();
  const history = toAnthropicMessages(params.messages);
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

  // Non-streaming JSON: show full message at once.
  if (!isEventStream(res)) {
    applyAnthropicJsonBody(await res.text(), params.onDelta);
    return;
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
      const delta = json.delta as { type?: string; text?: string; thinking?: string } | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        params.onDelta(delta.text);
      } else if (
        delta?.type === "thinking_delta" &&
        typeof delta.thinking === "string" &&
        delta.thinking
      ) {
        params.onDelta(delta.thinking);
      }
    }
  }
}

function applyAnthropicJsonBody(body: string, onDelta: (text: string) => void): void {
  const trimmed = body.trim();
  if (!trimmed) {
    return;
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new Error(trimmed.slice(0, 500) || "Invalid Anthropic response");
  }
  if (json.type === "error") {
    const err = json.error as { message?: string } | undefined;
    throw new Error(err?.message || "Anthropic error");
  }
  const content = json.content;
  if (!Array.isArray(content)) {
    throw new Error("Anthropic response missing content");
  }
  let text = "";
  let thinking = "";
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const b = block as { type?: string; text?: string; thinking?: string };
    if (b.type === "text" && typeof b.text === "string") {
      text += b.text;
    } else if (b.type === "thinking" && typeof b.thinking === "string") {
      thinking += b.thinking;
    }
  }
  const out = text || thinking;
  if (out) {
    onDelta(out);
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
