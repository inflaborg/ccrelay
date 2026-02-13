/**
 * Anthropic API format to OpenAI API format converter
 * Converts Anthropic Messages API requests to OpenAI Chat Completions format
 *
 * Key design: Stateless conversion, no external storage required.
 * Tool_use IDs are preserved directly without mapping.
 *
 * Reference: claude-code-router/anthropic.transformer.ts
 */

/* eslint-disable @typescript-eslint/naming-convention */
// External API fields use snake_case (max_tokens, tool_choice, etc.)

import type { MessageParam, ContentBlockParam } from "../types";

/**
 * Anthropic Messages API request format
 */
export interface AnthropicMessageRequest {
  model: string;
  max_tokens: number;
  messages: MessageParam[];
  system?: string | AnthropicSystemBlock[];
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  stop_sequences?: string[];
  thinking?: {
    type: string;
    budget_tokens?: number;
  };
}

/**
 * Anthropic system block (array form)
 */
export interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: string; ttl?: string };
}

/**
 * Anthropic tool definition
 */
export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

/**
 * Anthropic tool choice
 */
export type AnthropicToolChoice =
  | "auto"
  | "any"
  | "none"
  | { type: string; name?: string; disable_parallel_tool_use?: boolean };

/**
 * OpenAI Chat Completions API request format
 */
export interface OpenAIMessageRequest {
  model: string;
  max_tokens?: number;
  messages: OpenAIMessage[];
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  stop?: string | string[];
  reasoning?: {
    effort?: string;
    enabled?: boolean;
  };
}

/**
 * OpenAI message format
 */
export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIContent[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  thinking?: {
    content?: string;
    signature?: string;
  };
}

/**
 * OpenAI content block
 */
export type OpenAIContent = OpenAITextContent | OpenAIImageContent;

/**
 * OpenAI text content
 */
export interface OpenAITextContent {
  type: "text";
  text: string;
}

/**
 * OpenAI image content
 */
export interface OpenAIImageContent {
  type: "image_url";
  image_url: {
    url: string;
  };
  media_type?: string;
}

/**
 * OpenAI tool definition
 */
export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * OpenAI tool choice
 */
export type OpenAIToolChoice = "auto" | "none" | { type: "function"; function: { name: string } };

/**
 * OpenAI tool call in assistant message
 */
export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
  // Gemini-specific: thought_signature for extended thinking
  extra_content?: {
    google?: {
      thought_signature?: string;
    };
  };
}

/**
 * Result of the conversion with metadata
 */
export interface ConversionResult {
  request: OpenAIMessageRequest;
  originalPath: string;
  newPath: string;
}

/**
 * Convert Anthropic API request to OpenAI API format
 *
 * Design: Stateless conversion, preserves IDs without external storage.
 * Follows the message splitting pattern from claude-code-router:
 * - user messages with tool_result → split into separate tool messages
 * - assistant messages → join text, extract tool_calls & thinking
 * - system → supports both string and array forms
 */
export function convertRequestToOpenAI(
  anthropic: AnthropicMessageRequest,
  originalPath: string
): ConversionResult {
  const openai: OpenAIMessageRequest = {
    model: anthropic.model,
    messages: [],
  };

  const messages: OpenAIMessage[] = [];

  // Convert system message - handle both string and array forms
  if (anthropic.system) {
    if (typeof anthropic.system === "string") {
      messages.push({
        role: "system",
        content: anthropic.system,
      });
    } else if (Array.isArray(anthropic.system) && anthropic.system.length) {
      // Array form: [{type:"text", text:"...", cache_control?:...}, ...]
      const textParts = anthropic.system
        .filter(item => item.type === "text" && item.text)
        .map(item => ({
          type: "text" as const,
          text: item.text,
          cache_control: item.cache_control,
        }));
      messages.push({
        role: "system",
        content: textParts,
      });
    }
  }

  // Convert each message - a single Anthropic message may produce multiple OpenAI messages
  const requestMessages = JSON.parse(JSON.stringify(anthropic.messages || [])) as MessageParam[];
  const targetModel = openai.model;
  for (const msg of requestMessages) {
    const converted = convertMessage(msg, targetModel);
    messages.push(...converted);
  }

  openai.messages = messages;

  // temperature
  if (anthropic.temperature !== undefined) {
    openai.temperature = anthropic.temperature;
  }

  // top_p
  if (anthropic.top_p !== undefined) {
    openai.top_p = anthropic.top_p;
  }

  // stream
  if (anthropic.stream !== undefined) {
    openai.stream = anthropic.stream;
  }

  // max_tokens
  if (anthropic.max_tokens) {
    openai.max_tokens = anthropic.max_tokens;
  }

  // tools - format conversion
  if (anthropic.tools && anthropic.tools.length > 0) {
    openai.tools = convertTools(anthropic.tools);
  }

  // tool_choice
  if (anthropic.tool_choice) {
    openai.tool_choice = convertToolChoice(anthropic.tool_choice);
  }

  // stop_sequences -> stop
  if (anthropic.stop_sequences) {
    openai.stop = anthropic.stop_sequences;
  }

  // thinking -> reasoning (conditionally, based on target model)
  // Gemini's OpenAI-compatible API rejects unknown fields like "reasoning",
  // so only include it for providers that support it.
  if (anthropic.thinking && !isGeminiModel(openai.model)) {
    openai.reasoning = {
      effort: getThinkLevel(anthropic.thinking.budget_tokens),
      enabled: anthropic.thinking.type === "enabled",
    };
  }

  // Convert path: /v1/messages -> /chat/completions
  let newPath = originalPath;
  if (originalPath === "/v1/messages" || originalPath === "/messages") {
    newPath = "/chat/completions";
  }

  return {
    request: openai,
    originalPath,
    newPath,
  };
}

/**
 * Convert thinking budget_tokens to effort level string
 * Reference: claude-code-router getThinkLevel utility
 */
function getThinkLevel(budgetTokens?: number): string {
  if (!budgetTokens) {
    return "medium";
  }
  if (budgetTokens <= 1024) {
    return "low";
  }
  if (budgetTokens <= 8192) {
    return "medium";
  }
  return "high";
}

/**
 * Check if a model name is a Gemini model
 * Gemini's OpenAI-compatible API rejects unknown fields like "reasoning"
 */
function isGeminiModel(model: string): boolean {
  return model.toLowerCase().startsWith("gemini");
}

/**
 * Convert a single Anthropic message to one or more OpenAI messages.
 *
 * Key patterns (from claude-code-router reference):
 * - user message with tool_result blocks → each tool_result becomes a separate {role:"tool"} message
 * - user message with text/image blocks → single {role:"user"} message
 * - assistant message → joins text into string, extracts tool_calls, extracts thinking
 */
function convertMessage(msg: MessageParam, targetModel: string): OpenAIMessage[] {
  const content = msg.content;

  // If content is a string, simple conversion
  if (typeof content === "string") {
    return [
      {
        role: msg.role,
        content,
      },
    ];
  }

  if (!Array.isArray(content) || content.length === 0) {
    return [
      {
        role: msg.role,
        content: "",
      },
    ];
  }

  // === USER MESSAGES ===
  if (msg.role === "user") {
    return convertUserMessage(content);
  }

  // === ASSISTANT MESSAGES ===
  if (msg.role === "assistant") {
    return [convertAssistantMessage(content, targetModel)];
  }

  // Fallback for any other role
  return [
    {
      role: msg.role,
      content: convertContentBlocksToString(content),
    },
  ];
}

/**
 * Convert user message content blocks to OpenAI messages.
 * Splits tool_result blocks into separate tool messages,
 * groups text/image blocks into a single user message.
 */
function convertUserMessage(content: ContentBlockParam[]): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];

  // 1. Extract tool_result blocks → separate tool messages
  const toolResultBlocks = content.filter(c => c.type === "tool_result");
  if (toolResultBlocks.length) {
    for (const tool of toolResultBlocks) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Type narrowing after filter
      const block = tool as Extract<ContentBlockParam, { type: "tool_result" }>;
      const toolMessage: OpenAIMessage = {
        role: "tool",
        content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
        tool_call_id: block.tool_use_id,
      };
      messages.push(toolMessage);
    }
  }

  // 2. Extract text and image blocks → single user message
  // Reference: passes through original part object (including cache_control)
  const textAndMediaParts = content.filter(
    c =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Type narrowing after filter
      (c.type === "text" && (c as Extract<ContentBlockParam, { type: "text" }>).text) ||
      c.type === "image"
  );

  if (textAndMediaParts.length) {
    messages.push({
      role: "user",
      content: textAndMediaParts.map((part): OpenAIContent => {
        if (part.type === "image") {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Type narrowing in conditional
          const imgBlock = part as Extract<ContentBlockParam, { type: "image" }>;
          const imageUrl = convertImageSource(imgBlock.source);
          // Only include media_type if both data and media_type are present (valid image)
          const hasValidImage =
            imgBlock.source.type === "base64" && imgBlock.source.data && imgBlock.source.media_type;
          const imageContent: OpenAIImageContent = {
            type: "image_url" as const,
            image_url: {
              url: imageUrl,
            },
          };
          if (hasValidImage && imgBlock.source.media_type) {
            imageContent.media_type = imgBlock.source.media_type;
          }
          return imageContent;
        }
        // Pass through original text part (including cache_control if present)
        // Reference: returns the raw part object
        return part as unknown as OpenAIContent;
      }),
    });
  }

  return messages;
}

/**
 * Convert assistant message content blocks to a single OpenAI message.
 * - Joins text blocks into a single string for content
 * - Extracts tool_use blocks into tool_calls
 * - For Gemini: attaches thought_signature to each tool_call function part
 * - For non-Gemini: extracts thinking block as standalone thinking field
 */
function convertAssistantMessage(content: ContentBlockParam[], targetModel: string): OpenAIMessage {
  const assistantMessage: OpenAIMessage = {
    role: "assistant",
    content: "",
  };

  const gemini = isGeminiModel(targetModel);

  // Extract thinking block signature first (needed for both paths)
  let thoughtSignature: string | undefined;
  const thinkingPart = content.find(c => c.type === "thinking");
  if (thinkingPart) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Type narrowing after find
    const thinking = thinkingPart as Extract<ContentBlockParam, { type: "thinking" }>;
    thoughtSignature = thinking.signature;
  }

  // Extract text blocks → join into single string
  const textParts = content.filter(
    (c): c is Extract<ContentBlockParam, { type: "text" }> =>
      c.type === "text" && "text" in c && typeof c.text === "string"
  );
  if (textParts.length) {
    assistantMessage.content = textParts.map(t => t.text).join("\n");
  }

  // Extract tool_use blocks → tool_calls
  const toolCallParts = content.filter(
    (c): c is Extract<ContentBlockParam, { type: "tool_use" }> =>
      c.type === "tool_use" && "id" in c && typeof c.id === "string"
  );
  if (toolCallParts.length) {
    assistantMessage.tool_calls = toolCallParts.map(tool => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Type narrowing after filter
      const block = tool as Extract<ContentBlockParam, { type: "tool_use" }>;
      const toolCall: OpenAIToolCall = {
        id: block.id,
        type: "function" as const,
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
        // For Gemini: attach thought_signature in extra_content.google
        ...(gemini && thoughtSignature
          ? {
              extra_content: {
                google: {
                  thought_signature: thoughtSignature,
                },
              },
            }
          : {}),
      };
      return toolCall;
    });
  }

  // For non-Gemini: keep thinking as standalone field
  // For Gemini: signature is already attached to tool_calls above
  if (!gemini && thinkingPart && thoughtSignature) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Type narrowing after find
    const thinking = thinkingPart as Extract<ContentBlockParam, { type: "thinking" }>;
    assistantMessage.thinking = {
      content: thinking.thinking,
      signature: thinking.signature,
    };
  }

  return assistantMessage;
}

/**
 * Convert content blocks to a plain string (fallback)
 */
function convertContentBlocksToString(blocks: ContentBlockParam[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlockParam, { type: "text" }> => b.type === "text")
    .map(b => b.text)
    .join("\n");
}

/**
 * Convert image source from Anthropic to OpenAI format
 */
function convertImageSource(source: {
  type: string;
  media_type?: string;
  data?: string;
  url?: string;
}): string {
  if (source.type === "base64") {
    const mediaType = source.media_type ?? undefined;
    const data = source.data ?? undefined;
    return `data:${mediaType};base64,${data}`;
  }
  if (source.type === "url") {
    return source.url ?? "";
  }
  return "";
}

/**
 * Convert tools from Anthropic to OpenAI format
 */
function convertTools(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.input_schema,
    },
  }));
}

/**
 * Convert tool_choice from Anthropic to OpenAI format
 */
function convertToolChoice(choice: AnthropicToolChoice): OpenAIToolChoice {
  // Handle string forms
  if (choice === "auto" || choice === "none") {
    return choice;
  }
  if (choice === "any") {
    return "auto";
  }
  // Handle object form: {type: "tool", name: "X"} or {type: "auto"}, etc.
  // Reference: if type === "tool" → {type:"function", function:{name}}, else → choice.type as string
  if (typeof choice === "object") {
    if (choice.type === "tool" && choice.name) {
      return {
        type: "function",
        function: {
          name: choice.name,
        },
      };
    }
    // {type: "auto"}, {type: "none"}, {type: "any"}, etc.
    return (choice.type === "any" ? "auto" : choice.type) as OpenAIToolChoice;
  }

  return "auto";
}
