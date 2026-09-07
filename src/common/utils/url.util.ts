export function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Naive eTLD+1 approximation (last two labels) - no public suffix list, so
 * multi-part TLDs like `.co.uk` collapse to the wrong "base" domain. Good
 * enough for grouping first-party vs third-party requests, not for anything
 * that needs to be exact.
 */
export function getBaseDomain(url: string): string | null {
  const host = getHostname(url);
  if (!host) return null;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}
