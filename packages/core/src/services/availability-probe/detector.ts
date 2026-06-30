import type { ApiSurface } from "../../types";
import { detectApiSurface } from "../../server/request/apiSurfaceDetector";
import { isOpenAIChatCompletionsWirePath, pathOnly } from "../../converter/paths";
import type { AvailabilityProbeDetection } from "./types";

const OPENAI_RESPONSES_PATHS = new Set(["/responses", "/v1/responses", "/openai/responses"]);

const ANTHROPIC_MESSAGES_PATHS = new Set(["/v1/messages", "/anthropic/v1/messages"]);

function isProbeTokenLimit(value: unknown): boolean {
  return value === 1;
}

function hasProbeTokenLimit(body: Record<string, unknown>): boolean {
  return isProbeTokenLimit(body.max_tokens) || isProbeTokenLimit(body.max_completion_tokens);
}

function resolveProbeResponseSurface(
  method: string,
  path: string,
  clientSurface: ApiSurface
): ApiSurface {
  const p = pathOnly(path);
  if (isOpenAIChatCompletionsWirePath(p) || p === "/openai/chat/completions") {
    return "openai";
  }
  if (OPENAI_RESPONSES_PATHS.has(p)) {
    return "openai_responses";
  }
  if (ANTHROPIC_MESSAGES_PATHS.has(p)) {
    return "anthropic";
  }
  return detectApiSurface(method, path) ?? clientSurface;
}

/**
 * Detect one-token availability probes used to validate endpoint reachability.
 * Returns null when the body is not a probe request.
 */
export function detectAvailabilityProbe(
  rawBody: Buffer,
  method: string,
  path: string,
  clientSurface: ApiSurface
): AvailabilityProbeDetection | null {
  if (rawBody.length === 0) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!hasProbeTokenLimit(parsed)) {
    return null;
  }

  const model = typeof parsed.model === "string" ? parsed.model : "";
  const stream = parsed.stream === true;

  return {
    model,
    stream,
    responseSurface: resolveProbeResponseSurface(method, path, clientSurface),
  };
}
