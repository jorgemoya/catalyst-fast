import 'server-only';

import { cookies } from 'next/headers';

/**
 * Guest cart identity.
 *
 * The whole of a guest's cart state is one BigCommerce cart id in one cookie.
 * Everything else about the cart lives at BigCommerce and is read back by id
 * through `data/cart.ts`, which is what lets the cart be cached and shared
 * rather than recomputed per request.
 *
 * **Why this isn't signed.** Catalyst wraps the same id in a next-auth JWT. That
 * looks like a security control and isn't one: the cart id *is* the capability —
 * anyone holding it can read and mutate that cart, and it is handed to
 * BigCommerce's hosted checkout in a URL. A signature would only certify that we
 * issued the value, which doesn't help, because an attacker mounting a
 * cart-fixation attack would simply obtain a legitimately-issued id for their own
 * cart first. The protections that do matter are `httpOnly` (script can't read
 * it) and `sameSite: 'lax'` (a cross-site form post can't act on it), both set
 * below. Skipping the JWT also keeps next-auth out of the guest path entirely,
 * which is the point of building guest-first.
 *
 * **Phase 6 seam.** Once a customer signs in, BigCommerce assigns the cart to
 * them and the id moves onto the auth session. `getCartId` becomes "session
 * first, cookie second", and the anonymous cart is merged at login. Every caller
 * goes through these three functions so that change lands here and nowhere else.
 */

const CART_COOKIE = 'cf.cart';

/**
 * Matches BigCommerce's own 30-day cart lifetime. A longer cookie would leave
 * shoppers pointed at carts the API has already dropped.
 */
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Readable from anywhere dynamic: server actions, route handlers, and
 * `'use cache: private'` scopes. Never from `data/` — that layer takes the id as
 * an argument precisely so its cache key is a scalar rather than a request.
 */
export async function getCartId(): Promise<string | undefined> {
  return (await cookies()).get(CART_COOKIE)?.value || undefined;
}

/** Writable only from a Server Action or Route Handler, per Next's cookie rules. */
export async function setCartId(cartId: string): Promise<void> {
  (await cookies()).set(CART_COOKIE, cartId, {
    httpOnly: true,
    sameSite: 'lax',
    // Local development is plain http; a `secure` cookie would never be stored.
    secure: process.env.NODE_ENV === 'production',
    maxAge: CART_COOKIE_MAX_AGE,
    path: '/',
  });
}

export async function clearCartId(): Promise<void> {
  (await cookies()).delete(CART_COOKIE);
}
