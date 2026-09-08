import { normalizeUrl } from './normalize-url.util';

describe('normalizeUrl', () => {
  it('lowercases the hostname', () => {
    expect(normalizeUrl('https://Example.COM/Path')).toBe(
      'https://example.com/Path',
    );
  });

  it('strips the URL fragment', () => {
    expect(normalizeUrl('https://example.com/a#section')).toBe(
      'https://example.com/a',
    );
  });

  it('drops the default port for the protocol', () => {
    expect(normalizeUrl('https://example.com:443/')).toBe(
      'https://example.com/',
    );
    expect(normalizeUrl('http://example.com:80/')).toBe('http://example.com/');
  });

  it('keeps a non-default port', () => {
    expect(normalizeUrl('https://example.com:8443/')).toBe(
      'https://example.com:8443/',
    );
  });

  it('removes a trailing slash from a non-root path', () => {
    expect(normalizeUrl('https://example.com/blog/')).toBe(
      'https://example.com/blog',
    );
  });

  it('preserves the root path slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('produces identical output for cache-key-equivalent URLs', () => {
    expect(normalizeUrl('https://Example.com:443/blog/#top')).toBe(
      normalizeUrl('https://example.com/blog'),
    );
  });
});
