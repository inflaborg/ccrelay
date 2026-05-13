// Environment variable pattern for substitution
const ENV_VAR_PATTERN = /\$\{(\w+)\}/g;

/**
 * Expand environment variables in a string
 * Supports ${VAR_NAME} syntax
 */
export function expandEnvVars(value: string): string {
  if (!value || typeof value !== "string") {
    return value;
  }
  return value.replace(ENV_VAR_PATTERN, (_, varName: string) => {
    return process.env[varName] || "";
  });
}

/**
 * Recursively expand environment variables in an object
 * Preserves the structure of the input object
 *
 * @param isProvidersMap — When true, object keys are **not** run through snake→camel, because
 *   those keys are provider **ids** (e.g. `minimax-m2-5_copy`). The previous behavior mangled
 *   `_copy` into `Copy` by turning `_c` into `C`.
 */
export function expandEnvVarsInObject<T>(obj: T, options?: { isProvidersMap?: boolean }): T {
  if (!obj) {
    return obj;
  }
  if (typeof obj === "string") {
    return expandEnvVars(obj) as T;
  }
  if (Array.isArray(obj)) {
    const out: unknown[] = [];
    for (const item of obj) {
      out.push(expandEnvVarsInObject(item as never));
    }
    return out as T;
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (options?.isProvidersMap) {
        // Provider ids are arbitrary; never treat them as snake_case field names.
        result[key] = expandEnvVarsInObject(value);
      } else {
        // Convert snake_case to camelCase for config field names (not provider map keys)
        const camelKey = key.replace(/(?<!^)_([a-zA-Z])/g, (_, letter: string) =>
          letter.toUpperCase()
        );
        const isProvidersObject =
          key === "providers" &&
          value !== null &&
          value !== undefined &&
          typeof value === "object" &&
          !Array.isArray(value);
        result[camelKey] = isProvidersObject
          ? expandEnvVarsInObject(value, { isProvidersMap: true })
          : expandEnvVarsInObject(value);
      }
    }
    return result as T;
  }
  return obj;
}
