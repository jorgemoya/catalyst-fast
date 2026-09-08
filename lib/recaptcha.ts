import 'server-only';

/**
 * reCAPTCHA v3 verification.
 *
 * Optional throughout: a storefront with no reCAPTCHA keys configured must work
 * normally, so `isRecaptchaConfigured` gates the widget client-side and
 * `verifyRecaptcha` returns `true` when unconfigured. The alternative — failing
 * closed — would mean an unconfigured install silently rejects every review and
 * contact-form submission with a validation error that points nowhere.
 *
 * The site key is public by design and must be `NEXT_PUBLIC_`; the secret key is
 * server-only and must never be. Mixing those up is the classic reCAPTCHA
 * mistake, so they are named and read separately here rather than through one
 * helper.
 */

const VERIFY_ENDPOINT = 'https://www.google.com/recaptcha/api/siteverify';

/**
 * v3 returns a score from 0.0 (almost certainly a bot) to 1.0. Google's own
 * suggested starting point is 0.5, and it is the right default: the failure
 * mode of a high threshold is silently rejecting real customers' reviews, which
 * nobody notices because the customer just gives up.
 */
const DEFAULT_THRESHOLD = 0.5;

export const isRecaptchaConfigured = Boolean(
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY && process.env.RECAPTCHA_SECRET_KEY,
);

interface VerifyResponse {
  success: boolean;
  score?: number;
  action?: string;
  'error-codes'?: string[];
}

/**
 * Verifies a token from the client widget.
 *
 * `expectedAction` is checked when present. Without it a token minted on a
 * cheap, unprotected form could be replayed against an expensive one — Google
 * binds the action name into the token precisely so this is detectable, and
 * skipping the check throws that protection away.
 */
export async function verifyRecaptcha(
  token: string | undefined | null,
  expectedAction?: string,
  threshold = DEFAULT_THRESHOLD,
): Promise<boolean> {
  if (!isRecaptchaConfigured) {
    return true;
  }

  if (!token) {
    return false;
  }

  try {
    const response = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: process.env.RECAPTCHA_SECRET_KEY ?? '',
        response: token,
      }),
      // Never cache a verification: tokens are single-use and short-lived.
      cache: 'no-store',
    });

    if (!response.ok) {
      return false;
    }

    const result = (await response.json()) as VerifyResponse;

    if (!result.success) {
      return false;
    }

    if (expectedAction && result.action && result.action !== expectedAction) {
      return false;
    }

    return (result.score ?? 0) >= threshold;
  } catch {
    /*
     * Google unreachable. Fails **open**.
     *
     * A deliberate choice: reCAPTCHA is spam mitigation, not authentication, and
     * treating a third-party outage as "every customer is a bot" turns Google
     * having a bad day into this storefront being unable to accept reviews or
     * contact messages. The downside is a spam window during an outage, which is
     * recoverable; the alternative is not.
     */
    return true;
  }
}
