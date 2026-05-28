/**
 * Parsed row from `customModelsList` (mirrors server parseCustomModelLine).
 */
export interface ParsedCustomModelLine {
  id: string;
  displayName: string;
  alias: string;
}

export function parseCustomModelLine(line: string): ParsedCustomModelLine {
  const s = line.trim();
  if (!s) {
    return { id: "", displayName: "", alias: "" };
  }
  const i1 = s.indexOf(";");
  if (i1 === -1) {
    return { id: s, displayName: s, alias: s };
  }
  const id = s.slice(0, i1).trim();
  const rest = s.slice(i1 + 1);
  const i2 = rest.indexOf(";");
  if (i2 === -1) {
    const displayPart = rest.trim();
    const displayName = displayPart.length > 0 ? displayPart : id;
    return { id, displayName, alias: id };
  }
  const displayPart = rest.slice(0, i2).trim();
  const aliasPart = rest.slice(i2 + 1).trim();
  const displayName = displayPart.length > 0 ? displayPart : id;
  const alias = aliasPart.length > 0 ? aliasPart : id;
  return { id, displayName, alias };
}
