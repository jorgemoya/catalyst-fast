import { describe, expect, it } from 'vitest';

import { getSessionTokenCookieOptions } from './session-token-cookie-options';

/**
 * The session token must end with the browser (an Essential cookie) while
 * keeping every attribute an integration configured — upstream #3231, where
 * dropping `partitioned` left a second session token that survived logout.
 */
describe('getSessionTokenCookieOptions', () => {
  it('never carries a lifetime, so the cookie ends with the browser session', () => {
    const options = getSessionTokenCookieOptions('authjs.session-token', {
      cookies: { sessionToken: { options: { maxAge: 3600, expires: new Date() } } },
    });

    expect(options).not.toHaveProperty('maxAge');
    expect(options).not.toHaveProperty('expires');
  });

  it('keeps configured attributes such as partitioned', () => {
    const options = getSessionTokenCookieOptions('authjs.session-token', {
      cookies: { sessionToken: { options: { partitioned: true, sameSite: 'none' } } },
    });

    expect(options).toMatchObject({ partitioned: true, sameSite: 'none', httpOnly: true });
  });

  it('marks __Secure- cookies secure by default', () => {
    expect(getSessionTokenCookieOptions('__Secure-authjs.session-token', {}).secure).toBe(true);
    expect(getSessionTokenCookieOptions('authjs.session-token', {}).secure).toBe(false);
  });
});
