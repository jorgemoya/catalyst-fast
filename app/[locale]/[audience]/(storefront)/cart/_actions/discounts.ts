'use server';

import { getTForAction } from '~/lib/i18n/server';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';
import { z } from 'zod';

import { toCartErrorMessage, toSubmissionErrorMessage } from '~/lib/cart/error-message';
import type { CartErrorCode } from '~/lib/cart/errors';
import {
  applyCoupon,
  applyGiftCertificate,
  removeCoupon,
  removeGiftCertificate,
} from '~/lib/cart/mutations';
import { revalidateCart } from '~/lib/cart/revalidate';
import { getCartId } from '~/lib/cart/session';

/**
 * Coupons and gift certificates.
 *
 * Both are applied to the *checkout* rather than the cart, and BigCommerce gives
 * a cart's checkout the same entity id — so these take no id from the client at
 * all, just the code, and resolve the cart from the cookie like every other cart
 * action.
 *
 * A rejected code is an ordinary outcome, not an exception: an expired or
 * mistyped coupon comes back as a field-level error the shopper can correct,
 * rather than an error boundary.
 */

/** Factory: the validation message is translated. */
const codeSchema = (t: Awaited<ReturnType<typeof getTForAction>>) =>
  z.object({
  code: z
    .string()
    .trim()
    .min(1, t('Cart.validation.required'))
    // Long enough for any real code; the bound exists so a pathological input
    // never reaches BigCommerce.
    .max(64),
});

const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

/**
 * Shared shape for the four operations: resolve the cart, run the mutation, map
 * a `CartError` onto the form. Written once because the only thing that differs
 * between applying a coupon and removing a gift certificate is which function to
 * call.
 */
async function withCode(
  formData: FormData,
  fallback: CartErrorCode,
  operation: (cartId: string, code: string) => Promise<void>,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  const cartId = await getCartId();

  if (!cartId) {
    return formError(toCartErrorMessage(t, 'cart-not-found'));
  }

  const submission = parseWithZod(formData, { schema: codeSchema(t) });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  try {
    await operation(cartId, submission.value.code);
    revalidateCart(cartId);
  } catch (error) {
    // BigCommerce rejects an invalid code with a GraphQL error rather than a
    // null result, so this is the path a mistyped coupon actually takes.
    return submission.reply({ formErrors: [toSubmissionErrorMessage(t, error, fallback)] });
  }

  return submission.reply({ resetForm: true });
}

// Declared as `async function`, not arrow constants: Next's Server Action
// compiler requires every export of a 'use server' module to be an async
// function, and an arrow that merely returns a promise doesn't qualify.
export async function applyCouponAction(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  return withCode(formData, 'coupon-failed', applyCoupon);
}

export async function removeCouponAction(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  return withCode(formData, 'coupon-failed', removeCoupon);
}

export async function applyGiftCertificateAction(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  return withCode(formData, 'gift-certificate-failed', applyGiftCertificate);
}

export async function removeGiftCertificateAction(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  return withCode(formData, 'gift-certificate-failed', removeGiftCertificate);
}
