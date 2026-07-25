export type ChatProtocol = "openai_chat" | "openai_responses" | "anthropic";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Set when the assistant turn failed. */
  error?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  protocol: ChatProtocol;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatModelOption {
  id: string;
  label: string;
}

export interface ChatStoreV1 {
  version: 1;
  sessions: ChatSession[];
  activeSessionId: string | null;
}
