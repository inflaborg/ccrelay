/** True if `hostname` equals `expectedHost` (case-insensitive). Rules use fixed upstream hosts only. */
export function hostnameMatchesDomain(hostname: string, expectedHost: string): boolean {
  return hostname.toLowerCase() === expectedHost.toLowerCase();
}

/** True if `hostname` equals `parentHost` or is a direct/indirect subdomain (e.g. `*.cognitiveservices.azure.com`). */
export function hostnameMatchesDomainOrSubdomain(hostname: string, parentHost: string): boolean {
  const h = hostname.toLowerCase();
  const p = parentHost.toLowerCase();
  if (h === p) {
    return true;
  }
  return h.endsWith(`.${p}`);
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
