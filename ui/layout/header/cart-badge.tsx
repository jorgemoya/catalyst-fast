import { cacheLife, cacheTag } from 'next/cache';

import { getCartCount } from '~/data/cart';
import { getCartId } from '~/lib/cart/session';
import { tags } from '~/lib/cache/tags';
import { t } from '~/lib/i18n/messages';

import { CartIcon, IconLink } from './icon-link';

/**
 * The canonical "streams in because it genuinely can't be cached publicly" case,
 * and the reason every region of the header has its own `<Suspense>`.
 *
 * Two nested caches, doing different jobs:
 *
 *   `'use cache: private'` wraps the **cookie read** — which cart is this
 *   browser's. Private scopes are the only ones allowed to touch `cookies()`, and
 *   they are never persisted server-side, so nothing here can leak one shopper's
 *   cart into another's page. The cost is that this scope is excluded from static
 *   shell generation, which is exactly right: the count is the one thing on the
 *   page that is per-visitor.
 *
 *   `getCartCount` inside it is `'use cache: remote'` — public, shared, keyed by
 *   the cart id. Nesting a public cache inside a private one is the sanctioned
 *   pattern, and it means the *expensive* half (the BigCommerce round trip) is
 *   cached durably even though the *identifying* half can't be.
 *
 * Catalyst fetched this with `cache: 'no-store'` on every request of every page.
 *
 * `cacheLife('cart')` puts `stale` at 30s, exactly `MIN_PREFETCHABLE_STALE`, so
 * the badge still participates in prefetches rather than dropping out of them.
 *
 * Invalidation is `updateTag(tags.cart(id))` **plus `refresh()`** from every cart
 * action — see `lib/cart/revalidate.ts`. `updateTag` alone cannot reach this
 * scope, because this scope lives in the browser.
 */
async function getBadgeCount(): Promise<number> {
  'use cache: private';
  cacheLife('cart');

  const cartId = await getCartId();

  if (!cartId) {
    return 0;
  }

  cacheTag(tags.cart(cartId));

  return (await getCartCount(cartId)) ?? 0;
}

export async function CartBadge() {
  const count = await getBadgeCount();

  return (
    <IconLink href="/cart" label={count > 0 ? t('Header.cartWithCount', { count }) : t('Header.cart')}>
      <CartIcon />
      {count > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground tabular-nums"
          data-testid="cart-count"
        >
          {count}
        </span>
      )}
    </IconLink>
  );
}

/**
 * What the prerendered shell contains: the icon, no count. A guest with an empty
 * cart sees exactly this and never sees it change, which is the common case.
 */
export function CartBadgeSkeleton() {
  return (
    <IconLink href="/cart" label={t('Header.cart')}>
      <CartIcon />
    </IconLink>
  );
}
