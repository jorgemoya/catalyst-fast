import { describe, expect, it } from 'vitest';

import { safeRedirectPath } from './redirect';

/**
 * Without this, `/login?redirectTo=https://evil.test` turns the merchant's own
 * login page into a phishing redirector — the shopper starts on a domain they
 * trust and lands somewhere else after authenticating.
 */
describe('safeRedirectPath', () => {
  const fallback = '/account/orders';

  it('allows a same-origin path', () => {
    expect(safeRedirectPath('/account/addresses', fallback)).toBe('/account/addresses');
    expect(safeRedirectPath('/cart/?x=1', fallback)).toBe('/cart/?x=1');
  });

  it('rejects an absolute URL', () => {
    expect(safeRedirectPath('https://evil.test', fallback)).toBe(fallback);
    expect(safeRedirectPath('http://evil.test/path', fallback)).toBe(fallback);
  });

  it('rejects a protocol-relative URL', () => {
    // `//evil.test` starts with `/` and is still a fully qualified origin — the
    // case a naive `startsWith('/')` check misses.
    expect(safeRedirectPath('//evil.test', fallback)).toBe(fallback);
    expect(safeRedirectPath('//evil.test/path', fallback)).toBe(fallback);
  });

  it('rejects a backslash-escaped origin', () => {
    // Several browsers normalize `\` to `/`, making this equivalent to `//`.
    expect(safeRedirectPath('/\\evil.test', fallback)).toBe(fallback);
  });

  it('rejects values carrying control characters', () => {
    // A newline can truncate or inject a Location header.
    expect(safeRedirectPath('/account\r\nX-Injected: 1', fallback)).toBe(fallback);
  });

  it('falls back for empty and missing values', () => {
    expect(safeRedirectPath('', fallback)).toBe(fallback);
    expect(safeRedirectPath(null, fallback)).toBe(fallback);
    expect(safeRedirectPath(undefined, fallback)).toBe(fallback);
  });
});
