import type { ChatProtocol, ChatSession, ChatStoreV1 } from "./types";

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

export function createSession(protocol: ChatProtocol, model: string, title?: string): ChatSession {
  const t = now();
  return {
    id: newSessionId(),
    title: title?.trim() || "New chat",
    protocol,
    model,
    messages: [],
    createdAt: t,
    updatedAt: t,
  };
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
    return {
      version: 1,
      sessions: parsed.sessions,
      activeSessionId: parsed.activeSessionId ?? null,
    };
  } catch {
    return { version: 1, sessions: [], activeSessionId: null };
  }
}

export function saveChatStore(store: ChatStoreV1): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or private mode — ignore
  }
}

export function titleFromFirstUserMessage(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    return "New chat";
  }
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}
