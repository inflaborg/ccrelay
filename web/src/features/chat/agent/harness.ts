import { streamChatWithTools, type AgentLlmMessage, type StreamToolCall } from "../chatProxy";
import { newMessageId } from "../chatStorage";
import type { ChatMessage } from "../types";
import { buildAgentSystemPrompt } from "./prompts";
import { executeAgentTool, formatToolCallLabel, getAgentToolDefinitions } from "./tools";

export const AGENT_MAX_STEPS = 12;

export interface AgentLoopCallbacks {
  /** Append or update a visible chat message in the session. */
  appendMessage: (message: ChatMessage) => void;
  /** Patch an existing message by id. */
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  /** Remove a message by id (e.g. empty tool-call-only assistant placeholder). */
  removeMessage: (id: string) => void;
  /** Current memory markdown (may change after update_memory). */
  getMemory: () => string;
  setMemory: (markdown: string) => void;
  /** Stream text into the current assistant message. */
  onAssistantDelta: (assistantId: string, chunk: string) => void;
}

export interface RunAgentLoopParams {
  model: string;
  /** Visible session messages before this turn's assistant reply (includes new user msg). */
  historyMessages: ChatMessage[];
  /** When true, inject web_search tool + knowledge (Capabilities search configured). */
  webSearchAvailable: boolean;
  /** When true, inject web_fetch tool (Capabilities web search feature enabled). */
  webFetchAvailable: boolean;
  signal?: AbortSignal;
  callbacks: AgentLoopCallbacks;
}

function visibleToLlmHistory(messages: ChatMessage[]): AgentLlmMessage[] {
  const out: AgentLlmMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "assistant" && !m.error) {
      // Skip empty assistant placeholders from prior failed turns.
      if (m.content.trim()) {
        out.push({ role: "assistant", content: m.content });
      }
    }
    // tool rows are UI-only; not replayed into the LLM history
  }
  return out;
}

/**
 * Simple harness loop: LLM → tools → memory → until no tool_calls or maxSteps.
 */
export async function runAgentLoop(params: RunAgentLoopParams): Promise<void> {
  const { model, historyMessages, webSearchAvailable, webFetchAvailable, signal, callbacks } =
    params;
  const tools = getAgentToolDefinitions({ webSearchAvailable, webFetchAvailable });

  const buildSystem = () =>
    buildAgentSystemPrompt({
      memoryMarkdown: callbacks.getMemory(),
      webSearchAvailable,
      webFetchAvailable,
    });

  const llmMessages: AgentLlmMessage[] = [
    { role: "system", content: buildSystem() },
    ...visibleToLlmHistory(historyMessages),
  ];

  let step = 0;
  while (step < AGENT_MAX_STEPS) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    step += 1;

    // Refresh system prompt with latest memory each step.
    llmMessages[0] = {
      role: "system",
      content: buildSystem(),
    };

    const assistantId = newMessageId();
    callbacks.appendMessage({
      id: assistantId,
      role: "assistant",
      content: "",
    });

    let result: { content: string; toolCalls: StreamToolCall[] };
    try {
      result = await streamChatWithTools({
        model,
        messages: llmMessages,
        tools,
        signal,
        onDelta: chunk => {
          callbacks.onAssistantDelta(assistantId, chunk);
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      callbacks.patchMessage(assistantId, { error: message });
      throw err;
    }

    const content = result.content || "";
    if (content) {
      callbacks.patchMessage(assistantId, { content });
    }

    if (result.toolCalls.length === 0) {
      if (!content.trim()) {
        callbacks.patchMessage(assistantId, {
          content: "",
          error: "Empty response",
        });
      }
      return;
    }

    // Drop empty placeholder when the model only requested tools.
    if (!content.trim()) {
      callbacks.removeMessage(assistantId);
    }

    // Keep intermediate assistant text if any; append tool_calls to LLM history.
    llmMessages.push({
      role: "assistant",
      content: content || null,
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const tc of result.toolCalls) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const toolMsgId = newMessageId();
      const label = formatToolCallLabel(tc.name, tc.arguments);
      callbacks.appendMessage({
        id: toolMsgId,
        role: "tool",
        content: label,
        toolName: tc.name,
        toolStatus: "running",
      });

      const exec = await executeAgentTool(tc.name, tc.arguments, {
        getMemory: callbacks.getMemory,
        setMemory: callbacks.setMemory,
      });

      callbacks.patchMessage(toolMsgId, {
        content: exec.ok ? `${label} · ${exec.summary}` : `${label} · error`,
        toolStatus: exec.ok ? "done" : "error",
        error: exec.ok ? undefined : exec.content,
      });

      llmMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: exec.content,
      });
    }
  }

  // Max steps reached — surface a final note as assistant message.
  callbacks.appendMessage({
    id: newMessageId(),
    role: "assistant",
    content: "",
    error: `Stopped after ${AGENT_MAX_STEPS} steps. Ask a follow-up to continue.`,
  });
}
