import 'server-only';

import { getRecaptchaSettings } from '~/data/recaptcha';

/**
 * reCAPTCHA token handling for Server Actions.
 *
 * **Nothing here talks to Google.** BigCommerce holds the secret and verifies
 * the token itself when it is passed as `reCaptchaV2` on the mutation, so the
 * storefront's only jobs are to know whether reCAPTCHA is on and to refuse a
 * submission that should have carried a token and did not.
 *
 * That refusal matters: without it, a bot that simply omits the field would sail
 * past, because BigCommerce treats a missing `reCaptchaV2` as "this store has no
 * reCAPTCHA" rather than as a failure.
 */

/*
 * The field name Google's v2 widget creates for its token. Not exported: the
 * widget writes it and this module reads it, so nothing in between needs to
 * know — and an exported constant nothing imports is the pattern that has
 * hidden four unwired features in this codebase already.
 */
const RECAPTCHA_TOKEN_FIELD = 'g-recaptcha-response';

type TokenCheck =
  | { ok: true; reCaptchaV2: { token: string } | undefined }
  | { ok: false; reason: 'missing' };

/**
 * Reads the token from a submission and decides what to forward.
 *
 * Returns `reCaptchaV2: undefined` when the store has reCAPTCHA switched off —
 * the argument is optional, and sending an empty token to a store that is not
 * expecting one is rejected outright.
 */
export async function readRecaptchaToken(formData: FormData): Promise<TokenCheck> {
  const settings = await getRecaptchaSettings();

  if (!settings) {
    return { ok: true, reCaptchaV2: undefined };
  }

  const raw = formData.get(RECAPTCHA_TOKEN_FIELD);
  const token = typeof raw === 'string' ? raw.trim() : '';

  if (!token) {
    return { ok: false, reason: 'missing' };
  }

  return { ok: true, reCaptchaV2: { token } };
}
