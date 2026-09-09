import { getT } from '~/lib/i18n/server';
import { cacheLife } from 'next/cache';

import { getSession } from '~/data/customer/session';
import { type Wishlist, getWishlists } from '~/data/customer/wishlist';
import { HeartIcon } from '~/ui/primitives/heart-icon';
import { Link } from '~/ui/primitives/link';

import { WishlistButton } from './wishlist-button';

/**
 * The PDP heart.
 *
 * Signed out, it is a **link to sign in** rather than a button that fails — the
 * shopper's intent survives via `redirectTo`, so they land back on the product
 * they were looking at. A modal would lose the product on the way.
 *
 * Signed in, it reads the same private wishlists scope the account page uses, so
 * it costs no extra origin request, and hands the client only what it needs to
 * render: the lists, and which of them already hold this product.
 *
 * **Every read below sits inside a `'use cache: private'` scope**, matching the
 * cart badge and account menu. That is not just for dedupe: `auth()` calls
 * `crypto.getRandomValues()`, and Next refuses to prerender an unstable value.
 * Reading the session directly in the component body — even inside a `<Suspense>`
 * boundary — produced `Route "/product/[id]": Next.js encountered the unstable
 * value crypto.getRandomValues() while prerendering` on every PDP render. A
 * private scope is excluded from prerendering by construction, which is exactly
 * the property needed here.
 */
interface ToggleState {
  signedIn: boolean;
  wishlists: Wishlist[];
}

/**
 * Takes no arguments so the per-product derivation stays out of the cache key.
 *
 * **This does not reduce origin calls, and it is worth recording why**, because
 * the shape looks like it should. The theory was that a product-keyed private
 * scope makes every PDP a distinct key, so dropping the argument would let one
 * entry serve every product. Measured before and after across two client-side
 * PDP navigations: two `CustomerWishlists` calls both times. No change.
 *
 * The reason is that a `'use cache: private'` entry lives in browser memory and
 * is scoped to the rendered segment. Navigating to a different route re-renders
 * that route's holes on the server no matter what the key is, so the function
 * re-executes and re-fetches. Private scopes dedupe *within* a render, not
 * across route renders, and there is no server-side store for them by design.
 *
 * So a signed-in PDP costs exactly one wishlist read per view, and that is
 * structural. Removing it means moving membership to the client — fetch once per
 * tab, keep it in `sessionStorage`, fill the hearts after paint — which trades
 * this call for a brief unfilled-heart flash on products the shopper has saved.
 * That is a product decision, not a caching one, so it is deliberately not made
 * here.
 */
async function getWishlistState(): Promise<ToggleState> {
  'use cache: private';
  cacheLife({ stale: 30 });

  const session = await getSession();

  if (!session) {
    return { signedIn: false, wishlists: [] };
  }

  return { signedIn: true, wishlists: await getWishlists() };
}

export async function WishlistToggle({ productId, path }: { productId: number; path: string }) {
  const t = await getT();

  const state = await getWishlistState();

  // Per-product derivation is plain synchronous work over the cached list, so it
  // costs nothing and, critically, does not become part of the cache key.
  const wishlists = state.wishlists.map((wishlist) => ({
    id: wishlist.id,
    name: wishlist.name,
    itemId: wishlist.items.find((item) => item.productId === productId)?.id ?? null,
  }));
  const containing = wishlists.filter((wishlist) => wishlist.itemId !== null).map((w) => w.id);

  if (!state.signedIn) {
    return (
      <Link
        aria-label={t('Wishlist.saveSignedOut')}
        className="inline-flex size-10 items-center justify-center rounded-(--radius-control) border border-border hover:bg-accent"
        href={`/login?redirectTo=${encodeURIComponent(path)}`}
      >
        <HeartIcon filled={false} />
      </Link>
    );
  }

  return <WishlistButton containing={containing} productId={productId} wishlists={wishlists} />;
}
