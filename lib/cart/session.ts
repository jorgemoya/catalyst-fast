import 'server-only';

import { cookies } from 'next/headers';

import { channelFor, DEFAULT_LOCALE } from '~/lib/config/channels';
import { activeLocale } from '~/lib/currency';

/**
 * Guest cart identity.
 *
 * The whole of a guest's cart state is one BigCommerce cart id in a cookie.
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
 * **Signed-in shoppers use the same cookie.** BigCommerce merges the guest cart
 * at login (given `guestCartEntityId`) and returns the result, which is written
 * back here — see `lib/auth/index.ts` for why it never moved onto the session.
 */

/**
 * **One cart per channel.** Each locale may map to its own BigCommerce channel
 * (`lib/config/channels.ts`), and a cart belongs to the channel it was created
 * on. A single cookie let a cart built on one channel be shown — and checked out
 * — on another. Upstream Catalyst fixed the same bug in 1.12.2 (#3244) with a
 * channel→cart map inside its session JWT; here the cart lives in a plain cookie,
 * so the fix is just a cookie per channel.
 */
const CART_COOKIE_PREFIX = 'cf.cart.';

/**
 * The single, channel-less cookie from before carts were per channel. Adopted
 * by the **default** channel only: until now every cart was created there,
 * because cart writes did not carry a channel (see `mutate`). Removed on that
 * channel's next write, since reads cannot set cookies during render.
 */
const LEGACY_CART_COOKIE = 'cf.cart';

/**
 * Matches BigCommerce's own 30-day cart lifetime. A longer cookie would leave
 * shoppers pointed at carts the API has already dropped.
 */
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * The request's channel, from the locale the proxy resolved — the one source
 * that works in renders, private scopes, Server Actions and Route Handlers
 * alike (root params work only in the first two).
 */
async function requestChannel(): Promise<{ channelId: string; isDefault: boolean }> {
  const { channelId } = channelFor(await activeLocale());

  return { channelId, isDefault: channelId === channelFor(DEFAULT_LOCALE).channelId };
}

/**
 * Readable from anywhere dynamic: server actions, route handlers, and
 * `'use cache: private'` scopes. Never from `data/` — that layer takes the id as
 * an argument precisely so its cache key is a scalar rather than a request.
 */
export async function getCartId(): Promise<string | undefined> {
  const [store, { channelId, isDefault }] = await Promise.all([cookies(), requestChannel()]);

  return (
    store.get(`${CART_COOKIE_PREFIX}${channelId}`)?.value ||
    (isDefault ? store.get(LEGACY_CART_COOKIE)?.value : undefined) ||
    undefined
  );
}

/** Writable only from a Server Action or Route Handler, per Next's cookie rules. */
export async function setCartId(cartId: string): Promise<void> {
  const [store, { channelId, isDefault }] = await Promise.all([cookies(), requestChannel()]);

  store.set(`${CART_COOKIE_PREFIX}${channelId}`, cartId, {
    httpOnly: true,
    sameSite: 'lax',
    // Local development is plain http; a `secure` cookie would never be stored.
    secure: process.env.NODE_ENV === 'production',
    maxAge: CART_COOKIE_MAX_AGE,
    path: '/',
  });

  if (isDefault) {
    store.delete(LEGACY_CART_COOKIE);
  }
}

/** Clears this channel's cart only; other channels' carts are untouched. */
export async function clearCartId(): Promise<void> {
  const [store, { channelId, isDefault }] = await Promise.all([cookies(), requestChannel()]);

  store.delete(`${CART_COOKIE_PREFIX}${channelId}`);

  if (isDefault) {
    store.delete(LEGACY_CART_COOKIE);
  }
}
