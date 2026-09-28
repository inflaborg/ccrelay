/**
 * Shared effort names across Codex, Claude Code, and upstream APIs.
 *
 * Wire values both sides can carry: low, medium, high, xhigh, max.
 * Claude Code also offers `ultracode` and `auto` in the picker. Those are not
 * extra API levels: ultracode is xhigh plus a client-side workflow flag, and
 * auto means the model default (omit the field).
 */

/** `undefined` means omit the effort and let the upstream use its default. */
export function canonicalClientEffort(effort: string): string | undefined {
  const e = effort.trim().toLowerCase();
  if (!e || e === "auto") {
    return undefined;
  }
  if (e === "ultracode") {
    return "xhigh";
  }
  if (e === "minimal") {
    return "low";
  }
  return e;
}

/**
 * Distinguish "no effort was set" (caller may apply a fallback) from
 * "client asked for the model default" (`auto` → effort omitted).
 */
export function resolveClientEffort(
  effort: string | undefined
): { specified: false } | { specified: true; effort?: string } {
  if (effort === undefined || effort.trim() === "") {
    return { specified: false };
  }
  return { specified: true, effort: canonicalClientEffort(effort) };
}
