import type { NextAuthConfig } from 'next-auth';

/**
 * Options for re-setting an Auth.js session-token cookie as a **browser-session**
 * cookie.
 *
 * Ported from Catalyst 1.11.0 (`patchSessionTokenCookies`) together with the
 * 1.12.1 fix to it (#3231).
 *
 * Why it exists: Auth.js writes the session token with `Expires` (30 days by
 * default). A persistent login cookie is not "strictly necessary" under cookie
 * consent rules; a cookie that ends with the browser session is. Stripping
 * `expires`/`maxAge` is what keeps the session token in the Essential category,
 * so signing in never depends on the shopper having granted consent.
 *
 * Why it spreads the configured options: upstream's first version rebuilt the
 * cookie from hardcoded attributes, so anything an integration configured —
 * notably `partitioned` — was dropped, and the rewritten cookie became a second,
 * unpartitioned session token that survived logout. Only the lifetime is
 * removed; every other configured attribute is kept.
 */
export function getSessionTokenCookieOptions(
  name: string,
  config: Pick<NextAuthConfig, 'cookies'>,
) {
  const configured = { ...config.cookies?.sessionToken?.options };

  // The lifetime is the one thing removed; see above.
  delete configured.expires;
  delete configured.maxAge;

  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: name.startsWith('__Secure-'),
    ...configured,
  };
}
