/** Simple glob pattern matching (aligned with core smart-routing exclude patterns). */
export function minimatch(str: string, pattern: string): boolean {
  let regexStr = "";

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const nextChar = pattern[i + 1];

    switch (char) {
      case "*":
        if (nextChar === "*") {
          regexStr += ".*";
          i++;
        } else {
          regexStr += "[^/]*";
        }
        break;
      case "?":
        regexStr += "[^/]";
        break;
      case ".":
      case "^":
      case "$":
      case "+":
      case "(":
      case ")":
      case "[":
      case "]":
      case "{":
      case "}":
      case "|":
      case "\\":
        regexStr += "\\";
        regexStr += char;
        break;
      default:
        regexStr += char;
    }
  }

  return new RegExp(`^${regexStr}$`).test(str);
}

export function matchesSmartRoutingExclude(publicId: string, patterns: string[]): boolean {
  return patterns.some(p => minimatch(publicId, p));
}
