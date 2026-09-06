/**
 * Cart failures, as codes rather than sentences.
 *
 * Same rule as `domain/availability.ts`: this layer reports *what happened*, the
 * UI supplies the words. Throwing pre-written English from a mutation would make
 * the message untranslatable and would put copy decisions in the data layer.
 *
 * Each code maps to a `Cart.errors.*` key in `messages/en.json`.
 */
export type CartErrorCode =
  | 'cart-not-found'
  | 'line-item-not-found'
  | 'add-failed'
  | 'update-failed'
  | 'remove-failed'
  | 'coupon-failed'
  | 'gift-certificate-failed'
  | 'checkout-not-found';

export class CartError extends Error {
  readonly code: CartErrorCode;

  constructor(code: CartErrorCode) {
    super(`Cart operation failed: ${code}`);
    this.name = 'CartError';
    this.code = code;
  }
}

export const isCartError = (error: unknown): error is CartError => error instanceof CartError;
