/** Default session memory markdown (History / Plan / Insights). */
export const INITIAL_MEMORY_MARKDOWN = `# Session Memory

## History Summary
(empty)

## Plan
- [ ] Understand the user's question

## Insights
-
`;

export function normalizeMemoryMarkdown(raw: unknown): string {
  if (typeof raw !== "string") {
    return INITIAL_MEMORY_MARKDOWN;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return INITIAL_MEMORY_MARKDOWN;
  }
  return trimmed;
}
