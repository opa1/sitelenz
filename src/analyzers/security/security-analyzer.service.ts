import { Injectable, Logger } from '@nestjs/common';
import * as https from 'node:https';
import type { TLSSocket, PeerCertificate } from 'node:tls';
import type {
  CookieRecord,
  RawObservations,
} from '../../common/browser/raw-observations.interface';
import type { Analyzer, AnalyzerOptions } from '../analyzer.interface';
import { getHeader } from '../../common/utils/headers.util';
import { safe } from '../../common/utils/analyzer-safety.util';
import type {
  CookieFlagSummary,
  CookieIssue,
  CookiesSummary,
  CspResult,
  CspScore,
  HstsResult,
  HstsScore,
  HttpsInfo,
  PermissionsPolicyResult,
  ReferrerPolicyResult,
  ReferrerPolicyScore,
  SecurityHeaders,
  SecurityResult,
  TlsCertificate,
  XContentTypeOptionsResult,
  XFrameOptionsResult,
  XFrameOptionsScore,
} from './security-result.interface';

const TLS_TIMEOUT_MS = 3000;

function buildHttps(observations: RawObservations): HttpsInfo {
  const enabled = safe(
    () => new URL(observations.url).protocol === 'https:',
    false,
  );
  const mixedContent =
    enabled &&
    observations.networkRequests.some((r) => r.url.startsWith('http://'));
  return { enabled, mixedContent };
}

function buildHsts(headers: Record<string, string>): HstsResult {
  const value = getHeader(headers, 'strict-transport-security');
  if (!value) {
    return {
      present: false,
      maxAge: null,
      includeSubDomains: false,
      preload: false,
      score: 'missing',
    };
  }
  const maxAgeMatch = value.match(/max-age=(\d+)/i);
  const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : null;
  const includeSubDomains = /includesubdomains/i.test(value);
  const preload = /preload/i.test(value);

  let score: HstsScore = 'weak';
  if (maxAge !== null) {
    if (maxAge >= 31_536_000 && includeSubDomains) score = 'strong';
    else if (maxAge >= 15_768_000) score = 'moderate';
    else score = 'weak';
  }

  return { present: true, maxAge, includeSubDomains, preload, score };
}

function buildCsp(headers: Record<string, string>): CspResult {
  const value = getHeader(headers, 'content-security-policy');
  if (!value) {
    return {
      present: false,
      value: null,
      hasUnsafeInline: false,
      hasUnsafeEval: false,
      score: 'missing',
    };
  }
  const hasUnsafeInline = /unsafe-inline/i.test(value);
  const hasUnsafeEval = /unsafe-eval/i.test(value);
  const score: CspScore =
    hasUnsafeInline || hasUnsafeEval ? 'present_loose' : 'present_strict';
  return { present: true, value, hasUnsafeInline, hasUnsafeEval, score };
}

function buildXcto(headers: Record<string, string>): XContentTypeOptionsResult {
  const value = getHeader(headers, 'x-content-type-options');
  const present = !!value;
  const correct = present && value.trim().toLowerCase() === 'nosniff';
  return { present, value, correct };
}

function buildXfo(headers: Record<string, string>): XFrameOptionsResult {
  const value = getHeader(headers, 'x-frame-options');
  if (!value) return { present: false, value: null, score: 'missing' };
  const normalized = value.trim().toLowerCase();
  const score: XFrameOptionsScore =
    normalized === 'deny' ? 'strong' : 'moderate';
  return { present: true, value, score };
}

function buildReferrerPolicy(
  headers: Record<string, string>,
): ReferrerPolicyResult {
  const value = getHeader(headers, 'referrer-policy');
  if (!value) return { present: false, value: null, score: 'missing' };
  const normalized = value.trim().toLowerCase();
  const strictValues = new Set([
    'no-referrer',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin',
  ]);
  const score: ReferrerPolicyScore = strictValues.has(normalized)
    ? 'strict'
    : 'moderate';
  return { present: true, value, score };
}

function buildPermissionsPolicy(
  headers: Record<string, string>,
): PermissionsPolicyResult {
  const value = getHeader(headers, 'permissions-policy');
  return { present: !!value, value };
}

function computeSecurityScore(headers: SecurityHeaders): number {
  let score = 0;

  switch (headers.strictTransportSecurity.score) {
    case 'strong':
      score += 25;
      break;
    case 'moderate':
      score += 18;
      break;
    case 'weak':
      score += 10;
      break;
  }

  switch (headers.contentSecurityPolicy.score) {
    case 'present_strict':
      score += 25;
      break;
    case 'present_loose':
      score += 15;
      break;
  }

  switch (headers.xFrameOptions.score) {
    case 'strong':
      score += 15;
      break;
    case 'moderate':
      score += 10;
      break;
  }

  if (headers.xContentTypeOptions.correct) score += 15;
  else if (headers.xContentTypeOptions.present) score += 7;

  switch (headers.referrerPolicy.score) {
    case 'strict':
      score += 10;
      break;
    case 'moderate':
      score += 5;
      break;
  }

  if (headers.permissionsPolicy.present) score += 10;

  return Math.round(score);
}

function buildCookiesSummary(
  cookies: CookieRecord[],
  httpsEnabled: boolean,
): CookiesSummary {
  const issues = new Set<CookieIssue>();
  let withSecure = 0;
  let withHttpOnly = 0;
  let withSameSite = 0;

  const summaries: CookieFlagSummary[] = cookies.map((c) => {
    if (c.secure) withSecure += 1;
    if (c.httpOnly) withHttpOnly += 1;
    if (c.sameSite) withSameSite += 1;
    if (httpsEnabled && !c.secure) issues.add('missing_secure_on_https');
    if (!c.httpOnly) issues.add('missing_httponly');
    if (c.sameSite?.toLowerCase() === 'none' && !c.secure) {
      issues.add('samesite_none_without_secure');
    }
    return {
      name: c.name,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite ?? null,
      domain: c.domain,
    };
  });

  return {
    total: cookies.length,
    withSecure,
    withHttpOnly,
    withSameSite,
    issues: [...issues],
    cookies: summaries,
  };
}

function formatCertName(
  name: Record<string, string | string[] | undefined>,
): string {
  return Object.entries(name)
    .filter((entry): entry is [string, string | string[]] => !!entry[1])
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : v}`)
    .join(', ');
}

function fetchTlsCertificate(urlStr: string): Promise<TlsCertificate | null> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      resolve(null);
      return;
    }
    if (url.protocol !== 'https:') {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value: TlsCertificate | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = https.request(
      {
        host: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: url.pathname || '/',
        method: 'HEAD',
        timeout: TLS_TIMEOUT_MS,
        // We inspect the certificate ourselves (socket.authorized) rather
        // than letting Node reject the connection, so an invalid cert still
        // yields `valid: false` instead of an unusable failed request.
        rejectUnauthorized: false,
      },
      (res) => {
        try {
          const socket = res.socket as TLSSocket;
          const cert: PeerCertificate = socket.getPeerCertificate();
          if (!cert || Object.keys(cert).length === 0) {
            finish(null);
          } else {
            const validToMs = cert.valid_to
              ? new Date(cert.valid_to).getTime()
              : null;
            finish({
              valid: socket.authorized ?? false,
              issuer: cert.issuer ? formatCertName(cert.issuer) : null,
              subject: cert.subject ? formatCertName(cert.subject) : null,
              validFrom: cert.valid_from ?? null,
              validTo: cert.valid_to ?? null,
              daysUntilExpiry:
                validToMs !== null
                  ? Math.round((validToMs - Date.now()) / 86_400_000)
                  : null,
              protocol: socket.getProtocol?.() ?? null,
            });
          }
        } catch {
          finish(null);
        } finally {
          req.destroy();
        }
      },
    );
    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
    req.on('error', () => finish(null));
    req.end();
  });
}

@Injectable()
export class SecurityAnalyzerService implements Analyzer {
  private readonly logger = new Logger(SecurityAnalyzerService.name);

  async analyze(
    observations: RawObservations,
    options: AnalyzerOptions,
  ): Promise<SecurityResult> {
    const httpsInfo = safe(() => buildHttps(observations), {
      enabled: false,
      mixedContent: false,
    });

    const headers: SecurityHeaders = {
      strictTransportSecurity: safe(
        () => buildHsts(observations.responseHeaders),
        {
          present: false,
          maxAge: null,
          includeSubDomains: false,
          preload: false,
          score: 'missing',
        },
      ),
      contentSecurityPolicy: safe(
        () => buildCsp(observations.responseHeaders),
        {
          present: false,
          value: null,
          hasUnsafeInline: false,
          hasUnsafeEval: false,
          score: 'missing',
        },
      ),
      xContentTypeOptions: safe(() => buildXcto(observations.responseHeaders), {
        present: false,
        value: null,
        correct: false,
      }),
      xFrameOptions: safe(() => buildXfo(observations.responseHeaders), {
        present: false,
        value: null,
        score: 'missing',
      }),
      referrerPolicy: safe(
        () => buildReferrerPolicy(observations.responseHeaders),
        { present: false, value: null, score: 'missing' },
      ),
      permissionsPolicy: safe(
        () => buildPermissionsPolicy(observations.responseHeaders),
        { present: false, value: null },
      ),
    };

    const securityScore = safe(() => computeSecurityScore(headers), 0);

    const result: SecurityResult = {
      https: httpsInfo,
      headers,
      securityScore,
    };

    if (options.deep) {
      result.cookies = safe(
        () => buildCookiesSummary(observations.cookies, httpsInfo.enabled),
        {
          total: 0,
          withSecure: 0,
          withHttpOnly: 0,
          withSameSite: 0,
          issues: [],
          cookies: [],
        },
      );

      result.tlsCertificate = await fetchTlsCertificate(observations.url).catch(
        (error: unknown) => {
          this.logger.warn(
            `TLS certificate inspection failed: ${(error as Error).message}`,
          );
          return null;
        },
      );
    }

    return result;
  }
}
