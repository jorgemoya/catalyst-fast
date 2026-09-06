import 'server-only';

import { refresh, updateTag } from 'next/cache';

import { tags } from '~/lib/cache/tags';

/**
 * The invalidation contract every cart mutation ends with.
 *
 * **Both calls are required, and this is the single easiest thing to get wrong
 * in the whole caching design.** They target different caches:
 *
 *   `updateTag(tags.cart(id))` expires the *server* entries — `getCart` and
 *   `getCartCount`, both of which carry that tag — and makes the next read block
 *   for fresh data rather than serving stale. Legal only inside a Server Action.
 *
 *   `refresh()` re-renders the current page's dynamic holes, which is the only
 *   thing that can update a `'use cache: private'` scope. The header's cart badge
 *   is exactly that: a private cache living in the *browser's* memory, where
 *   `updateTag` has no reach at all.
 *
 * Drop the `refresh()` and everything still appears to work — the cart page
 * updates, tests that assert on the cart page pass — while the badge silently
 * lags one interaction behind. It reads as a flaky UI rather than a cache bug,
 * which is why `e2e/cart.spec.ts` asserts the badge updates on the *first* click.
 *
 * Both are cheap: `updateTag` writes a tag timestamp, `refresh` piggybacks on the
 * action's existing response.
 */
export function revalidateCart(cartId: string): void {
  updateTag(tags.cart(cartId));
  refresh();
}
