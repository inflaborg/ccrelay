/**
 * MiMo inbound: OpenAI Chat `choices[0].message.annotations` (`url_citation`, …)
 * → prepend Anthropic `server_tool_use` + `web_search_tool_result` (same pattern as GLM).
 */

/* eslint-disable @typescript-eslint/naming-convention -- Anthropic / OpenAI wire keys */

import { randomUUID } from "crypto";

import type {
  AnthropicContentBlock,
  AnthropicWebSearchResult,
} from "../../adapters/openai-chat-to-anthropic-response";

function extractAnnotations(body: Record<string, unknown>): unknown[] | undefined {
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const firstUnknown: unknown = choices[0];
  if (!firstUnknown || typeof firstUnknown !== "object") {
    return undefined;
  }
  const message = (firstUnknown as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const annotations = (message as Record<string, unknown>).annotations;
  if (!Array.isArray(annotations)) {
    return undefined;
  }
  return annotations as unknown[];
}

function mapAnnotationEntry(entry: Record<string, unknown>): AnthropicWebSearchResult | null {
  const typ = typeof entry.type === "string" ? entry.type : "";
  const urlRaw = entry.url;
  const url = typeof urlRaw === "string" ? urlRaw.trim() : "";
  if (url.length === 0) {
    return null;
  }
  if (typ.length > 0 && typ !== "url_citation") {
    return null;
  }
  const title = typeof entry.title === "string" ? entry.title : "";
  const summary = typeof entry.summary === "string" ? entry.summary : "";
  return {
    type: "web_search_result",
    url,
    title,
    ...(summary.length > 0 ? { encrypted_content: summary } : {}),
  };
}

function filterRedundantAnnotationTextBlock(
  blocks: AnthropicContentBlock[],
  annotationsJson: string
): AnthropicContentBlock[] {
  return blocks.filter(b => {
    if (b.type !== "text") {
      return true;
    }
    if (b.text === annotationsJson) {
      return false;
    }
    return true;
  });
}

/** Prepend synthesized server-tool blocks when MiMo returned `url_citation` annotations on Chat JSON. */
export function mimoAnnotationsWebSearchResponseTransform(
  openaiCompletionBody: Record<string, unknown>,
  anthropicBlocks: AnthropicContentBlock[]
): AnthropicContentBlock[] {
  const annotations = extractAnnotations(openaiCompletionBody);
  if (!annotations || annotations.length === 0) {
    return anthropicBlocks;
  }

  const results: AnthropicWebSearchResult[] = [];
  for (const raw of annotations) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const mapped = mapAnnotationEntry(raw as Record<string, unknown>);
    if (mapped) {
      results.push(mapped);
    }
  }
  if (results.length === 0) {
    return anthropicBlocks;
  }

  const annotationsJson = JSON.stringify(annotations);
  const trimmed = filterRedundantAnnotationTextBlock(anthropicBlocks, annotationsJson);

  const toolUseId = `srvtoolu_${randomUUID().replace(/-/g, "")}`;

  const serverToolUse: AnthropicContentBlock = {
    type: "server_tool_use",
    id: toolUseId,
    name: "web_search",
    input: {},
  };

  const toolResult: AnthropicContentBlock = {
    type: "web_search_tool_result",
    tool_use_id: toolUseId,
    content: results,
  };

  return [serverToolUse, toolResult, ...trimmed];
}
