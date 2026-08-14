import { isSseLogBody, reconstructMessageFromSseLogBody } from "./reconstructAnthropicSseMessage";
import { reconstructOpenAIChatFromSseLogBody } from "./reconstructOpenAIChatSseMessage";
import { reconstructOpenAIResponsesFromSseLogBody } from "./reconstructOpenAIResponsesSseMessage";

/** Pretty-print JSON when possible; leave SSE and invalid JSON unchanged. */
export function formatJson(str: string): string {
  if (!str) return str;

  const trimmed = str.trim();

  if (isSseLogBody(trimmed)) {
    return str;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return str;
  }
}

export function parseRequestMarkdownAnalysis(str: string): string {
  if (!str) return "";

  const trimmed = str.trim();
  let markdown = "";

  try {
    const parsed = JSON.parse(trimmed);

    if (parsed.system) {
      markdown += `### System\n\n`;
      if (typeof parsed.system === "string") {
        markdown += `> ${parsed.system.replace(/\n/g, "\n> ")}\n\n`;
      } else if (Array.isArray(parsed.system)) {
        parsed.system.forEach((sys: Record<string, unknown>) => {
          if (sys.type === "text" && typeof sys.text === "string") {
            markdown += `> ${sys.text.replace(/\n/g, "\n> ")}\n\n`;
          }
        });
      }
    }

    if (Array.isArray(parsed.messages)) {
      parsed.messages.forEach((msg: Record<string, unknown>) => {
        markdown += `### ${msg.role === "user" ? "User" : "Assistant"}\n\n`;
        if (typeof msg.content === "string") {
          markdown += `${msg.content}\n\n`;
        } else if (Array.isArray(msg.content)) {
          msg.content.forEach((contentPart: Record<string, unknown>) => {
            if (contentPart.type === "text" && typeof contentPart.text === "string") {
              markdown += `${contentPart.text}\n\n`;
            } else if (contentPart.type === "image_url" || contentPart.type === "image") {
              markdown += `*[Image Attached]*\n\n`;
            } else if (contentPart.type === "tool_use") {
              markdown += `### Tool Use: \`${contentPart.name}\`\n\n`;
              markdown += `\`\`\`json\n`;
              const inputStr = JSON.stringify(contentPart.input, null, 2) || "{}";
              markdown += `${inputStr}\n`;
              markdown += `\`\`\`\n\n`;
            } else if (contentPart.type === "tool_result") {
              markdown += `### Tool Result\n\n`;
              let resultContent = "";
              if (typeof contentPart.content === "string") {
                resultContent = contentPart.content;
              } else if (Array.isArray(contentPart.content)) {
                resultContent = contentPart.content
                  .map((c: Record<string, unknown>) =>
                    typeof c.text === "string" ? c.text : JSON.stringify(c)
                  )
                  .join("\n");
              }
              if (resultContent) {
                markdown += `\`\`\`text\n`;
                markdown += `${resultContent}\n`;
                markdown += `\`\`\`\n\n`;
              }
            }
          });
        }
      });
    }

    return markdown.trim() || "*No parseable content found.*";
  } catch {
    return "*Failed to parse content into markdown.*";
  }
}

export function parseToolsMarkdown(requestBody: string | undefined): string | null {
  if (!requestBody) return null;
  try {
    const parsed = JSON.parse(requestBody);
    if (parsed.tools && Array.isArray(parsed.tools) && parsed.tools.length > 0) {
      let markdown = "";
      parsed.tools.forEach((tool: Record<string, unknown>) => {
        if (tool.name) {
          markdown += `### \`${String(tool.name)}\`\n\n`;
        }
        if (tool.description) {
          markdown += `${String(tool.description)}\n\n`;
        }
        if (tool.input_schema) {
          markdown += `**Input Schema:**\n\`\`\`json\n${JSON.stringify(tool.input_schema, null, 2)}\n\`\`\`\n\n`;
        }
      });
      return markdown.trim();
    }
  } catch {
    // ignore
  }
  return null;
}

/** Pretty-printed merged message (SSE) or full JSON body (non-SSE). Empty when not reconstructable. */
export function reconstructResponseStructuredJson(responseBody: string): string {
  const raw = responseBody;
  const trimmed = raw.trim();
  const reconstructed = reconstructMessageFromSseLogBody(raw);
  if (reconstructed.ok) {
    return JSON.stringify(reconstructed.message, null, 2);
  }
  const openaiResponses = reconstructOpenAIResponsesFromSseLogBody(raw);
  if (openaiResponses.ok) {
    return JSON.stringify(openaiResponses.message, null, 2);
  }
  const openaiChat = reconstructOpenAIChatFromSseLogBody(raw);
  if (openaiChat.ok) {
    return JSON.stringify(openaiChat.message, null, 2);
  }
  if (!isSseLogBody(trimmed)) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return "";
    }
  }
  return "";
}

export function renderResponseAnalysisMarkdown(responseBody: string | undefined): string {
  if (!responseBody) {
    return "*No parseable content found.*";
  }
  const structured = reconstructResponseStructuredJson(responseBody);
  if (!structured) {
    return "*No parseable content found.*";
  }
  return `\`\`\`json\n${structured}\n\`\`\``;
}

/** Pretty-print a stored header JSON string; empty object when missing/invalid. */
export function formatHeadersJson(headersJson: string | undefined): string {
  if (!headersJson) {
    return "{}";
  }
  try {
    return JSON.stringify(JSON.parse(headersJson), null, 2);
  } catch {
    return headersJson;
  }
}
