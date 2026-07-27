export type ChatProtocol = "openai_chat" | "openai_responses" | "anthropic";

export type ChatMode = "agent" | "playground";

export type ChatRole = "user" | "assistant" | "tool";

export interface ChatImageAttachment {
  id: string;
  mimeType: string;
  /** Full data URL: `data:image/png;base64,...` (empty when stripped from persistence). */
  dataUrl: string;
  /** True when the binary payload was omitted to keep localStorage small. */
  omitted?: boolean;
}

export type ToolTraceStatus = "running" | "done" | "error";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Optional images on user turns (multimodal models only). */
  images?: ChatImageAttachment[];
  /** Set when the assistant turn failed. */
  error?: string;
  /** Agent tool row: function name. */
  toolName?: string;
  /** Agent tool row: execution status. */
  toolStatus?: ToolTraceStatus;
}

export interface ChatSession {
  id: string;
  title: string;
  protocol: ChatProtocol;
  model: string;
  /** Agent = harness loop with tools; Playground = single-turn proxy chat. Default agent. */
  mode: ChatMode;
  /** Rolling markdown memory for agent mode (History / Plan / Insights). */
  memoryMarkdown: string;
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
