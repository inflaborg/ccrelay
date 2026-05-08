/** True if `hostname` equals `expectedHost` (case-insensitive). Rules use fixed upstream hosts only. */
export function hostnameMatchesDomain(hostname: string, expectedHost: string): boolean {
  return hostname.toLowerCase() === expectedHost.toLowerCase();
}

/** Extract lowercase hostname from `baseUrl`; tolerate missing scheme. */
export function normalizedHostnameFromBaseUrl(baseUrl: string): string | undefined {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return undefined;
  }
  const withScheme = /^[a-zA-Z][a-zA-Z+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
