/**
 * Rewrite Claude/Cowork embedded wire model aliases in Anthropic system prompts.
 * When CCRelay maps a hashed alias (e.g. claude-93e5ab20) to an upstream model id,
 * matching mentions in system text are updated so prompt identity matches JSON `model`.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceWholeWordModelId(text: string, fromModel: string, toModel: string): string {
  if (!fromModel || fromModel === toModel) {
    return text;
  }
  const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(fromModel)}(?![\\w-])`, "g");
  return text.replace(pattern, toModel);
}

function rewriteSystemValue(
  system: unknown,
  fromModel: string,
  toModel: string
): { system: unknown; changed: boolean } {
  if (typeof system === "string") {
    const next = replaceWholeWordModelId(system, fromModel, toModel);
    return { system: next, changed: next !== system };
  }

  if (!Array.isArray(system)) {
    return { system, changed: false };
  }

  let changed = false;
  const next: unknown[] = [];
  for (const block of system as unknown[]) {
    if (!block || typeof block !== "object") {
      next.push(block);
      continue;
    }
    const b = block as Record<string, unknown>;
    if (b.type !== "text" || typeof b.text !== "string") {
      next.push(block);
      continue;
    }
    const rewritten = replaceWholeWordModelId(b.text, fromModel, toModel);
    if (rewritten === b.text) {
      next.push(block);
      continue;
    }
    changed = true;
    next.push({ ...b, text: rewritten });
  }

  return { system: next, changed };
}

/**
 * Replace embedded alias wire model id in Anthropic `system` when model mapping applies.
 * Returns the original buffer when nothing changes.
 */
export function rewriteEmbeddedModelAliasInAnthropicBody(
  body: Buffer,
  fromModel: string,
  toModel: string
): Buffer {
  if (!body || body.length === 0) {
    return body;
  }
  if (!fromModel || !toModel || fromModel === toModel) {
    return body;
  }

  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body.toString("utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return body;
    }
    data = parsed as Record<string, unknown>;
  } catch {
    return body;
  }

  if (data.system === undefined) {
    return body;
  }

  const { system, changed } = rewriteSystemValue(data.system, fromModel, toModel);
  if (!changed) {
    return body;
  }

  data.system = system;
  return Buffer.from(JSON.stringify(data), "utf-8");
}
