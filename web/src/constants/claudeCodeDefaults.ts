/** Suggested ANTHROPIC_DEFAULT_*_MODEL values for Claude Code → CCRelay (user can change). */
export const CLAUDE_CODE_DEFAULT_MODELS = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
} as const;

/** Default model name for Codex config.toml when user leaves the field empty. */
export const CODEX_DEFAULT_MODEL = "gpt-5.4-mini";
