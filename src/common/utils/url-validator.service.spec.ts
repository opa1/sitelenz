import { UrlValidatorService } from './url-validator.service';

// Mock DNS so SSRF checks are deterministic and offline.
jest.mock('node:dns', () => ({
  promises: { lookup: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { promises: dns } = require('node:dns') as {
  promises: { lookup: jest.Mock };
};

describe('UrlValidatorService', () => {
  let service: UrlValidatorService;

  beforeEach(() => {
    service = new UrlValidatorService();
    dns.lookup.mockReset();
  });

  const mockResolve = (
    records: { address: string; family: number }[],
  ): void => {
    dns.lookup.mockResolvedValue(records);
  };

  it('rejects a malformed URL before any DNS lookup', async () => {
    const result = await service.validate('not a url');
    expect(result).toEqual({ valid: false, reason: 'Malformed URL' });
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('rejects a disallowed protocol before any DNS lookup', async () => {
    const result = await service.validate('ftp://example.com');
    expect(result.valid).toBe(false);
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('accepts a public host and returns a normalized URL', async () => {
    mockResolve([{ address: '93.184.216.34', family: 4 }]);
    const result = await service.validate('https://example.com');
    expect(result).toEqual({
      valid: true,
      normalizedUrl: 'https://example.com/',
    });
  });

  it('rejects when the hostname does not resolve', async () => {
    dns.lookup.mockRejectedValue(new Error('ENOTFOUND'));
    const result = await service.validate('https://example.com');
    expect(result).toEqual({
      valid: false,
      reason: 'Unable to resolve hostname',
    });
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.0.0.1', 'private class A'],
    ['172.16.0.1', 'private class B'],
    ['192.168.1.1', 'private class C'],
    ['169.254.169.254', 'link-local / cloud metadata'],
    ['0.0.0.0', 'unspecified'],
  ])('rejects private/reserved IPv4 %s (%s)', async (address) => {
    mockResolve([{ address, family: 4 }]);
    const result = await service.validate('https://malicious.example');
    expect(result.valid).toBe(false);
  });

  it.each([
    ['::1', 'loopback'],
    ['fd00::1', 'unique local'],
    ['fe80::1', 'link-local'],
    ['::ffff:127.0.0.1', 'v4-mapped loopback'],
  ])('rejects private/reserved IPv6 %s (%s)', async (address) => {
    mockResolve([{ address, family: 6 }]);
    const result = await service.validate('https://malicious.example');
    expect(result.valid).toBe(false);
  });

  it('rejects if ANY resolved address is private (DNS-rebinding guard)', async () => {
    mockResolve([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const result = await service.validate('https://mixed.example');
    expect(result.valid).toBe(false);
  });
});
