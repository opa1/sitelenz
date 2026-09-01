import { Injectable } from '@nestjs/common';
import { promises as dns } from 'node:dns';

/**
 * Max redirects the Playwright-based crawler (a later phase) must enforce when
 * following a validated URL, to bound SSRF exposure via redirect chains.
 */
export const MAX_URL_REDIRECTS = 5;

export type UrlValidationResult =
  { valid: true; normalizedUrl: string } | { valid: false; reason: string };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

@Injectable()
export class UrlValidatorService {
  async validate(input: string): Promise<UrlValidationResult> {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return { valid: false, reason: 'Malformed URL' };
    }

    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      return {
        valid: false,
        reason: `Protocol "${url.protocol}" is not allowed; only http and https are supported`,
      };
    }

    if (!url.hostname) {
      return { valid: false, reason: 'URL is missing a hostname' };
    }

    let records: { address: string; family: number }[];
    try {
      records = await dns.lookup(url.hostname, { all: true });
    } catch {
      return { valid: false, reason: 'Unable to resolve hostname' };
    }

    if (records.length === 0) {
      return {
        valid: false,
        reason: 'Hostname did not resolve to any address',
      };
    }

    // Resolve once here and reject if any resolved address is private. This is
    // the DNS-rebinding-safe check for the submission-time validation this
    // service performs; the crawler must not re-resolve the hostname later.
    for (const record of records) {
      const isPrivate =
        record.family === 6
          ? this.isPrivateIPv6(record.address)
          : this.isPrivateIPv4(record.address);
      if (isPrivate) {
        return {
          valid: false,
          reason: `Hostname resolves to a private or reserved address (${record.address})`,
        };
      }
    }

    return { valid: true, normalizedUrl: url.toString() };
  }

  private isPrivateIPv4(address: string): boolean {
    const octets = address.split('.').map(Number);
    if (
      octets.length !== 4 ||
      octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
      return true;
    }
    const [a, b] = octets;
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local / cloud metadata)
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }

  private isPrivateIPv6(address: string): boolean {
    const normalized = address.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;

    const v4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4Mapped) return this.isPrivateIPv4(v4Mapped[1]);

    const firstHextet = parseInt(normalized.split(':')[0] || '0', 16);
    if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true; // fc00::/7 unique local
    if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true; // fe80::/10 link-local
    return false;
  }
}
