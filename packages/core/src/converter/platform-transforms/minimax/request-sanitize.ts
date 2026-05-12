/**
 * MiniMax OpenAI Chat Completions: enable interleaved thinking compatible format.
 * `reasoning_split: true` moves reasoning out of `<think>` tags in `content`
 * into `reasoning_details` (see MiniMax M2.7 docs).
 */

/** Injected on outbound `/v1/chat/completions` bodies when upstream host matches MiniMax. */
export function minimaxChatSanitize(body: Record<string, unknown>): void {
  body.reasoning_split = true;
}
