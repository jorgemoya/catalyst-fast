import { describe, expect, it } from 'vitest';

import {
  BigCommerceAPIError,
  BigCommerceGQLError,
  GQLErrorCode,
  InvalidCustomerAccessTokenError,
} from '~/lib/bigcommerce/client';

import { toSubmissionErrorMessage } from './error-message';
import { CartError } from './errors';

/**
 * The rethrow contract.
 *
 * This function decides whether a failed cart write becomes a sentence beside the
 * button or a full-page error boundary, and it has to get *both* directions
 * right. Too narrow and ordinary shopper mistakes blow up the page; too broad and
 * a broken deploy is reported to every shopper as a bad coupon code.
 */

const gqlError = (message: string) =>
  new BigCommerceGQLError([{ message, path: ['cart'], locations: [] }]);

describe('toSubmissionErrorMessage', () => {
  it('maps our own cart errors through the message catalogue', () => {
    expect(toSubmissionErrorMessage(new CartError('cart-not-found'), 'add-failed')).toMatch(
      /couldn't find your cart/i,
    );
  });

  it("surfaces BigCommerce's own wording where it carries information we lack", () => {
    // "Not enough stock: only 2 available" tells the shopper a number we never
    // fetched. Flattening it into "We couldn't update that item" would throw away
    // the only actionable part.
    expect(
      toSubmissionErrorMessage(gqlError('Not enough stock: only 2 available'), 'update-failed'),
    ).toBe('Not enough stock: only 2 available');
  });

  it('keeps our own translatable wording for a rejected code', () => {
    /*
     * BigCommerce says "Incorrect or mismatch: Coupon code `X` is invalid" — no
     * more informative than our sentence, and it arrives in English regardless of
     * locale. Passing it through would put an untranslatable string on the page,
     * which is the i18n debt Phase 8 exists to avoid.
     */
    const message = toSubmissionErrorMessage(
      gqlError('Incorrect or mismatch: Coupon code `NOPE` is invalid'),
      'coupon-failed',
    );

    expect(message).toMatch(/coupon code isn't valid/i);
    expect(message).not.toMatch(/mismatch/i);
  });

  it('keeps our own wording for a rejected gift certificate too', () => {
    expect(
      toSubmissionErrorMessage(gqlError('Gift certificate not found'), 'gift-certificate-failed'),
    ).toMatch(/gift certificate code isn't valid/i);
  });

  it('falls back to the catalogue when BigCommerce sends no message', () => {
    expect(toSubmissionErrorMessage(new BigCommerceGQLError([]), 'coupon-failed')).toMatch(
      /coupon code isn't valid/i,
    );
  });

  it('rethrows an auth failure rather than showing it on the form', () => {
    // `customerQuery` handles an expired session by redirecting. Swallowing it
    // here would strand the shopper on a form that can never succeed.
    expect(() =>
      toSubmissionErrorMessage(new InvalidCustomerAccessTokenError(), 'add-failed'),
    ).toThrow();
  });

  it('rethrows a transport failure', () => {
    // A 500 from BigCommerce is a fault, not a shopper mistake. It must stay
    // visible as an error rather than being reported as a bad code.
    expect(() => toSubmissionErrorMessage(new BigCommerceAPIError(500), 'add-failed')).toThrow();
  });

  it('rethrows anything it does not recognize', () => {
    expect(() => toSubmissionErrorMessage(new TypeError('undefined is not a function'), 'add-failed')).toThrow(
      TypeError,
    );
  });

  it('treats an auth error as auth even though it extends the GQL error', () => {
    // BigCommerceAuthError extends BigCommerceGQLError, so order of checks is
    // load-bearing: the narrower case has to be tested first or auth failures
    // would silently become form errors.
    const error = new InvalidCustomerAccessTokenError([
      { message: 'Invalid token', path: [], locations: [], extensions: { code: GQLErrorCode.INVALID_CAT } },
    ]);

    expect(() => toSubmissionErrorMessage(error, 'add-failed')).toThrow();
  });
});
