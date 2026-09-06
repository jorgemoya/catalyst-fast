import { BigCommerceAuthError, BigCommerceGQLError } from '~/lib/bigcommerce/client';
import { t } from '~/lib/i18n/messages';

import { type CartErrorCode, isCartError } from './errors';

/**
 * The one place a `CartErrorCode` becomes words.
 *
 * Kept out of `errors.ts` on purpose: that module states what failed and stays
 * free of copy, the same way `domain/availability.ts` returns a `kind` rather
 * than a label. This is the presentation half, sitting in `lib/` only because
 * every cart action needs it and duplicating the mapping across six of them is
 * how translations drift.
 *
 * `t` here is the *static* translator, which is a pure function of the message
 * catalogue — not `next-intl/server`, which is request-scoped.
 */
export const toCartErrorMessage = (code: CartErrorCode): string => t(`Cart.errors.${code}`);

/**
 * Turns a thrown cart failure into a message, or rethrows.
 *
 * **The rethrow is the point.** Without this, any error BigCommerce raises during
 * a cart write escapes the action and hits the error boundary — so a shopper who
 * asks for more units than a product's maximum, or whose variant no longer
 * resolves, gets a full-page "Something went wrong" instead of a sentence next to
 * the button. Those are ordinary user mistakes, and BigCommerce already words
 * them well ("Not enough stock", "This product has options, variant ID is
 * required"), so its message is surfaced verbatim rather than flattened into a
 * generic one.
 *
 * The narrowness matters as much as the catch. Only `BigCommerceGQLError` — a
 * 200 response carrying a GraphQL `errors` array, which is how BigCommerce
 * reports *rejections* — becomes a form error. An HTTP failure, a timeout, or an
 * auth error is a genuine fault and still throws, so a broken deploy stays
 * visible instead of being reported to every shopper as a bad coupon code.
 */
export function toSubmissionErrorMessage(error: unknown, fallback: CartErrorCode): string {
  return resolve(error, fallback);
}

/**
 * Where BigCommerce's wording is *not* worth taking.
 *
 * Its messages arrive in English regardless of locale, so every one we pass
 * through is a string that bypasses `messages/en.json` and won't translate in
 * Phase 8. That price is worth paying only when the message carries information
 * we cannot reconstruct — how many units are actually available, which option is
 * unresolvable.
 *
 * A rejected code carries nothing extra: BigCommerce says "Incorrect or mismatch:
 * Coupon code `X` is invalid", which is no more useful than our own sentence and
 * is less well written. So for these two, our translatable copy wins.
 */
const OWN_WORDING_WINS = new Set<CartErrorCode>(['coupon-failed', 'gift-certificate-failed']);

function resolve(error: unknown, fallback: CartErrorCode): string {
  if (isCartError(error)) {
    return toCartErrorMessage(error.code);
  }

  // An expired session is not a cart problem; `customerQuery` handles it by
  // redirecting, and swallowing it here would strand the shopper.
  if (error instanceof BigCommerceAuthError) {
    throw error;
  }

  if (error instanceof BigCommerceGQLError) {
    if (OWN_WORDING_WINS.has(fallback)) {
      return toCartErrorMessage(fallback);
    }

    const message = error.errors.find((gqlError) => gqlError.message)?.message;

    return message || toCartErrorMessage(fallback);
  }

  throw error;
}
