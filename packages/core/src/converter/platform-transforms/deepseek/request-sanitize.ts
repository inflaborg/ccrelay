/**
 * DeepSeek OpenAI-compatible Chat Completions: emit native `thinking` toggle and normalize
 * `reasoning_effort` to `high` | `max` per DeepSeek docs. In thinking mode, temperature / top_p /
 * penalties are ignored upstream; strip them for a smaller payload.
 */

import { resolveModelMeta } from "../../model-meta/registry";

/** Injected on outbound `/v1/chat/completions` bodies when upstream host is `api.deepseek.com`. */
export function deepseekChatSanitize(body: Record<string, unknown>): void {
  const raw = body.reasoning_effort;
  const effort =
    typeof raw === "string" && raw.trim() !== "" ? raw.trim().toLowerCase() : undefined;

  if (effort === undefined) {
    return;
  }

  const model = typeof body.model === "string" ? body.model : "";
  const meta = resolveModelMeta(model, { vendor: "deepseek" });
  if (!meta.reasoning.supportsReasoningEffort) {
    delete body.reasoning_effort;
    return;
  }

  if (effort === "none") {
    body.thinking = { type: "disabled" };
    delete body.reasoning_effort;
    return;
  }

  body.thinking = { type: "enabled" };
  body.reasoning_effort = normalizeDeepseekEffort(effort);
  delete body.temperature;
  delete body.top_p;
  delete body.presence_penalty;
  delete body.frequency_penalty;
}

/** Map OpenAI-style effort to DeepSeek-accepted `high` | `max` (low/medium → high, xhigh → max). */
export function normalizeDeepseekEffort(effort: string): string {
  const e = effort.toLowerCase();
  if (e === "low" || e === "medium" || e === "minimal") {
    return "high";
  }
  if (e === "xhigh") {
    return "max";
  }
  return e;
}
