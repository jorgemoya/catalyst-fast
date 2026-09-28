import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  UCP_PROXY_MARKER,
  buildDownstreamHeaders,
  buildUpstreamHeaders,
  buildUpstreamUrl,
  isUcpPath,
} from './upstream';

/**
 * The UCP proxy forwards credentials to a separate origin, so the header
 * allow-lists are the security boundary. These tests pin what may cross it in
 * each direction — the failures they guard against (a session cookie reaching
 * BigCommerce, a platform cookie reaching an agent) would be silent.
 */

beforeEach(() => {
  vi.stubEnv('BIGCOMMERCE_STORE_HASH', 'abc123');
  vi.stubEnv('BIGCOMMERCE_CHANNEL_ID', '1');
  vi.stubEnv('BIGCOMMERCE_GRAPHQL_API_DOMAIN', 'mybigcommerce.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isUcpPath', () => {
  it('matches the discovery document and the API, with or without a trailing slash', () => {
    for (const path of ['/.well-known/ucp', '/.well-known/ucp/', '/api/ucp', '/api/ucp/checkout-sessions/']) {
      expect(isUcpPath(path)).toBe(true);
    }
  });

  it('does not capture look-alike paths', () => {
    for (const path of ['/api/ucpx', '/.well-known/ucp/extra', '/ucp', '/api/events/', '/garden/']) {
      expect(isUcpPath(path)).toBe(false);
    }
  });
});

describe('buildUpstreamUrl', () => {
  it("targets the store's canonical origin, not the storefront host", () => {
    const url = buildUpstreamUrl(new URL('https://shop.example/api/ucp/checkout-sessions'));

    expect(url?.origin).toBe('https://store-abc123-1.mybigcommerce.com');
  });

  /*
   * #3224: the platform answers a trailing slash with a 307 to the bare path,
   * which the agent resolves against *our* domain and sends back — a loop.
   */
  it('strips the trailing slash this storefront always adds', () => {
    const url = buildUpstreamUrl(new URL('https://shop.example/api/ucp/checkout-sessions/'));

    expect(url?.pathname).toBe('/api/ucp/checkout-sessions');
  });

  it('keeps the query string', () => {
    const url = buildUpstreamUrl(new URL('https://shop.example/api/ucp/x/?a=1&b=2'));

    expect(url?.search).toBe('?a=1&b=2');
  });

  it('returns null when the store is not configured, so the proxy can 502', () => {
    vi.stubEnv('BIGCOMMERCE_STORE_HASH', '');

    expect(buildUpstreamUrl(new URL('https://shop.example/api/ucp'))).toBeNull();
  });
});

describe('buildUpstreamHeaders', () => {
  const request = new Request('https://shop.example/api/ucp/checkout-sessions', {
    headers: {
      authorization: 'Bearer agent-token',
      'content-type': 'application/json',
      'ucp-agent': 'profile="https://agent.example/profile"',
      cookie: 'authjs.session-token=secret; cf.cart=abc',
      'x-forwarded-for': '203.0.113.9',
      host: 'shop.example',
    },
  });

  const forwarded = buildUpstreamHeaders(request);

  it('forwards the credentials and headers the UCP spec defines', () => {
    expect(forwarded.get('authorization')).toBe('Bearer agent-token');
    expect(forwarded.get('content-type')).toBe('application/json');
    expect(forwarded.get('ucp-agent')).toBe('profile="https://agent.example/profile"');
  });

  /*
   * The one that matters most: shopper cookies — the session token included —
   * must never reach a separate origin just because an agent's request carried
   * them.
   */
  it('never forwards cookies or proxy headers', () => {
    expect(forwarded.get('cookie')).toBeNull();
    expect(forwarded.get('x-forwarded-for')).toBeNull();
    expect(forwarded.get('host')).toBeNull();
  });

  it('asks for an uncompressed body so digests and signatures still verify', () => {
    expect(forwarded.get('accept-encoding')).toBe('identity');
  });

  it('marks the request so a misconfigured loop is detectable', () => {
    expect(forwarded.get(UCP_PROXY_MARKER)).toBe('1');
  });
});

describe('buildDownstreamHeaders', () => {
  it('passes protocol headers back and drops everything else', () => {
    const headers = buildDownstreamHeaders(
      new Headers({
        'content-type': 'application/json',
        'ratelimit-remaining': '9',
        'ucp-version': '2026-04-08',
        'set-cookie': 'platform_session=1',
        server: 'nginx',
      }),
    );

    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('ratelimit-remaining')).toBe('9');
    expect(headers.get('ucp-version')).toBe('2026-04-08');
    // A platform cookie set on *our* domain would be a cross-origin session leak.
    expect(headers.get('set-cookie')).toBeNull();
    expect(headers.get('server')).toBeNull();
  });
});
