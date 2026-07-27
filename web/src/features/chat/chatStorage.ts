import { INITIAL_MEMORY_MARKDOWN, normalizeMemoryMarkdown } from "./agent/memory";
import type {
  ChatImageAttachment,
  ChatMessage,
  ChatMode,
  ChatProtocol,
  ChatSession,
  ChatStoreV1,
} from "./types";

const STORAGE_KEY = "ccrelay-chat-sessions-v1";

function now(): number {
  return Date.now();
}

export function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function newMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeMode(raw: unknown): ChatMode {
  return raw === "playground" ? "playground" : "agent";
}

/** Migrate legacy sessions missing mode / memoryMarkdown. */
export function normalizeSession(raw: Partial<ChatSession> & { id: string }): ChatSession {
  const t = now();
  return {
    id: raw.id,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : "New chat",
    protocol:
      raw.protocol === "openai_chat" ||
      raw.protocol === "openai_responses" ||
      raw.protocol === "anthropic"
        ? raw.protocol
        : "openai_chat",
    model: typeof raw.model === "string" ? raw.model : "",
    mode: normalizeMode(raw.mode),
    memoryMarkdown: normalizeMemoryMarkdown(raw.memoryMarkdown),
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : t,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : t,
  };
}

export function createSession(protocol: ChatProtocol, model: string, title?: string): ChatSession {
  const t = now();
  return {
    id: newSessionId(),
    title: title?.trim() || "New chat",
    protocol,
    model,
    mode: "agent",
    memoryMarkdown: INITIAL_MEMORY_MARKDOWN,
    messages: [],
    createdAt: t,
    updatedAt: t,
  };
}

function stripImagePayload(img: ChatImageAttachment): ChatImageAttachment {
  if (!img.dataUrl) {
    return img.omitted ? img : { ...img, omitted: true };
  }
  return {
    id: img.id,
    mimeType: img.mimeType,
    dataUrl: "",
    omitted: true,
  };
}

function stripMessageImagePayloads(message: ChatMessage): ChatMessage {
  if (!message.images?.length) {
    return message;
  }
  return {
    ...message,
    images: message.images.map(stripImagePayload),
  };
}

/** Drop base64 image bodies so localStorage stays under quota. */
export function stripImagePayloadsFromStore(store: ChatStoreV1): ChatStoreV1 {
  return {
    ...store,
    sessions: store.sessions.map(session => ({
      ...session,
      messages: session.messages.map(stripMessageImagePayloads),
    })),
  };
}

function storeHasImagePayloads(store: ChatStoreV1): boolean {
  for (const session of store.sessions) {
    for (const message of session.messages) {
      if (message.images?.some(img => Boolean(img.dataUrl))) {
        return true;
      }
    }
  }
  return false;
}

function writePersistedStore(store: ChatStoreV1): void {
  const persisted = stripImagePayloadsFromStore(store);
  const raw = JSON.stringify(persisted);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Quota may still be full from a previous bloated write — clear then retry.
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      // Private mode / hard quota — in-memory UI still works.
    }
  }
}

export function loadChatStore(): ChatStoreV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { version: 1, sessions: [], activeSessionId: null };
    }
    const parsed = JSON.parse(raw) as ChatStoreV1;
    if (parsed?.version !== 1 || !Array.isArray(parsed.sessions)) {
      return { version: 1, sessions: [], activeSessionId: null };
    }
    const store: ChatStoreV1 = {
      version: 1,
      sessions: parsed.sessions.map(s =>
        normalizeSession(s as Partial<ChatSession> & { id: string })
      ),
      activeSessionId: parsed.activeSessionId ?? null,
    };
    // Migrate legacy sessions that stored full data-URLs (often breaks later writes/clears).
    if (storeHasImagePayloads(store)) {
      const cleaned = stripImagePayloadsFromStore(store);
      writePersistedStore(cleaned);
      return cleaned;
    }
    return store;
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return { version: 1, sessions: [], activeSessionId: null };
  }
}

export function saveChatStore(store: ChatStoreV1): void {
  writePersistedStore(store);
}

/** Force-remove persisted chat history (used by clear-all). */
export function clearPersistedChatStore(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function titleFromFirstUserMessage(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    return "New chat";
  }
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}
