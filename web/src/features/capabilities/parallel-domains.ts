/** Parse comma- or newline-separated domain list from UI text input. */
export function parseParallelDomainList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Format domain array for display in a text input. */
export function formatParallelDomainList(domains?: string[]): string {
  return (domains ?? []).join(", ");
}

/** Normalize optional positive integer from form text; empty string → undefined. */
export function parseOptionalPositiveInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    return undefined;
  }
  return n;
}

/** Format optional number for form input. */
export function formatOptionalPositiveInt(value?: number): string {
  return typeof value === "number" && value > 0 ? String(value) : "";
}
