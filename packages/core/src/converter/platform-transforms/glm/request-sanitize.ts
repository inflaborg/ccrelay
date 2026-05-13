/**
 * GLM OpenAI-compatible Chat Completions: map Chat `reasoning_effort` to GLM's native `thinking`.
 * GLM does not accept `reasoning_effort`; it uses top-level `thinking: { type: "enabled" | "disabled" }`.
 */

/** Injected on outbound `/v1/chat/completions` bodies when upstream host matches GLM (Z.AI). */
export function glmChatSanitize(body: Record<string, unknown>): void {
  const effort =
    typeof body.reasoning_effort === "string" ? body.reasoning_effort.toLowerCase() : undefined;
  if (effort === undefined) {
    return;
  }
  body.thinking = { type: effort === "none" ? "disabled" : "enabled" };
  delete body.reasoning_effort;
  delete body.reasoning;
}
