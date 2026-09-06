import type { Metadata } from 'next';
import { Suspense } from 'react';

import { getCart } from '~/data/cart';
import { getCartId } from '~/lib/cart/session';
import { t } from '~/lib/i18n/messages';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

import { GiftCertificateRow, LineItemRow } from './_components/line-item';
import { OrderSummary } from './_components/summary';

/**
 * Cart page.
 *
 * The one storefront route that is a hole all the way down, and correctly so:
 * everything on it depends on which cart this browser owns. The heading and
 * layout still prerender — the page component itself awaits nothing — so the
 * shell paints immediately and the contents stream in behind it.
 *
 * Note the split: reading the cookie (`getCartId`) is the dynamic part and
 * happens here; reading the cart (`getCart`) is keyed by a scalar and is a shared
 * `'use cache: remote'` entry. Catalyst fetched the whole thing `no-store` on
 * every request.
 */

export const metadata: Metadata = {
  title: t('Cart.title'),
  // A cart is per-shopper and single-use; there is nothing here to index.
  robots: { index: false, follow: true },
};

export default function CartPage() {
  return (
    <div className="page-container py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('Cart.title')}</h1>

      <Suspense fallback={<CartSkeleton />}>
        <CartContents />
      </Suspense>
    </div>
  );
}

async function CartContents() {
  const cartId = await getCartId();
  const cart = cartId ? await getCart(cartId) : null;

  // A cookie pointing at a cart BigCommerce has already dropped or converted to
  // an order reads the same as no cart at all.
  if (!cart || cart.items.length === 0) {
    return <EmptyCart />;
  }

  return (
    <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_22rem]">
      <div>
        <p className="text-sm text-muted" data-testid="cart-item-count">
          {t('Cart.itemCount', { count: cart.totalQuantity })}
        </p>

        <ul className="mt-2 divide-y divide-border border-y border-border" data-testid="cart-items">
          {cart.items.map((item) =>
            item.kind === 'giftCertificate' ? (
              <GiftCertificateRow key={item.id} line={item} />
            ) : (
              <LineItemRow key={item.id} line={item} />
            ),
          )}
        </ul>
      </div>

      <OrderSummary summary={cart.summary} />
    </div>
  );
}

function EmptyCart() {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-center" data-testid="cart-empty">
      <h2 className="text-lg font-semibold">{t('Cart.emptyTitle')}</h2>
      <p className="max-w-sm text-sm text-muted">{t('Cart.emptySubtitle')}</p>
      <Link
        className="mt-2 inline-flex h-11 items-center rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        href="/"
      >
        {t('Cart.continueShopping')}
      </Link>
    </div>
  );
}

function CartSkeleton() {
  return (
    <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-6">
        {[0, 1].map((row) => (
          <div className="flex gap-4" key={row}>
            <Skeleton className="size-24 shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
