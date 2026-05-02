/**
 * Simple glob pattern matching (minimatch-like)
 * Used instead of external dependency
 */

export function minimatch(str: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regexStr = "";

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const nextChar = pattern[i + 1];

    switch (char) {
      case "*":
        if (nextChar === "*") {
          // ** matches any number of path segments
          regexStr += ".*";
          i++; // Skip next *
        } else {
          // * matches any characters within a path segment
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

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(str);
}
