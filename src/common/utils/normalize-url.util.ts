const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
};

/**
 * Canonical form used for cache-key matching (CrawlObservation/AnalyzeJob
 * lookups) - not for SSRF validation, which UrlValidatorService handles
 * separately.
 */
export function normalizeUrl(url: string): string {
  const parsed = new URL(url);

  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';

  if (parsed.port === DEFAULT_PORTS[parsed.protocol]) {
    parsed.port = '';
  }

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString();
}
