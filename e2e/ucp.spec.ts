import { expect, test } from '@playwright/test';

/**
 * UCP (agentic commerce) endpoints are served by BigCommerce and proxied here —
 * upstream Catalyst 1.12.0 (#3215, #3224).
 *
 * Before the proxy, `/.well-known/ucp` was treated as a storefront path: it got
 * a locale prefix, a route lookup, and a 404 page. These assert the requests
 * reach the platform and come back as protocol responses.
 */
test.describe('UCP proxy', () => {
  test('serves the discovery document from BigCommerce', async ({ request }) => {
    const response = await request.get('/.well-known/ucp', { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const body = (await response.json()) as { ucp?: { version?: string } };

    expect(body.ucp?.version).toBeTruthy();
  });

  /*
   * An unauthenticated call must get the *platform's* auth error — proving the
   * request crossed the proxy, trailing slash stripped, rather than being
   * answered by a storefront page.
   */
  test('forwards API calls and returns the platform response', async ({ request }) => {
    const response = await request.post('/api/ucp/checkout-sessions/', { data: {} });

    expect(response.status()).toBe(401);
    expect(response.headers()['content-type']).toContain('application/json');
    // No platform cookie is allowed back onto the storefront's domain.
    expect(response.headers()['set-cookie']).toBeUndefined();
  });
});
