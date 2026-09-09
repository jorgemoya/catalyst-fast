import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { getCart } from '~/data/cart';
import { getCountries } from '~/data/geography';
import { getCartId } from '~/lib/cart/session';
import { getWalletButtons } from '~/data/wallets';
import { CheckoutPreconnect } from '~/ui/patterns/checkout-preconnect';
import { WalletButtons } from '~/ui/patterns/wallet-buttons';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

import { GiftCertificateRow, LineItemRow } from './_components/line-item';
import { ShippingEstimator } from './_components/shipping-estimator';
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

/**
 * `generateMetadata` rather than a static export: the title is translated,
 * and a module-scope `t()` is evaluated once at import — pinning every
 * locale to whichever one loaded first.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return {
  title: t('Cart.title'),
  // A cart is per-shopper and single-use; there is nothing here to index.
  robots: { index: false, follow: true },
  };
}

export default async function CartPage() {
  const t = await getT();

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
  const t = await getT();

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

      <div>
        <CheckoutPreconnect />
        <OrderSummary summary={cart.summary} />

        {/* Its own boundary, and `fallback={null}` on purpose: wallet buttons
            reach two BigCommerce queries plus an external SDK, and a merchant
            with no wallets configured gets nothing at all. A skeleton would
            promise a button that may never arrive. The ordinary checkout link
            above is unaffected either way. */}
        <Suspense fallback={null}>
          <WalletButtonsRegion cartId={cart.id} summary={cart.summary} />
        </Suspense>

        {/* In its own boundary: the country list is a separate cached read, and
            a slow one must not hold up the summary the shopper came for. */}
        <Suspense fallback={null}>
          <ShippingEstimatorRegion />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Server half of the estimator: reads the cached country list once and hands it
 * to the client island. `getCountries` uses the `settings` profile, so this is
 * effectively free after the first request on the whole store.
 */
async function ShippingEstimatorRegion() {
  const countries = await getCountries();

  return <ShippingEstimator countries={countries} />;
}

async function EmptyCart() {
  const t = await getT();

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

/**
 * Server half of the express-checkout buttons.
 *
 * Resolves the wallet options on the server so the single-use session material
 * never has to be re-derived in the browser, then hands the client component a
 * plain array. Failures are swallowed to `null`: a wallet provider being down,
 * or the alpha API changing shape, must not take the cart page with it.
 */
async function WalletButtonsRegion({
  cartId,
  summary,
}: {
  cartId: string;
  summary: { grandTotal: { value: number; currencyCode: string } | null };
}) {
  /*
   * **Must not run during prerender.** The wallet query is uncached by design —
   * its payload is single-use payment session material — so when this region was
   * prerendered the fetch was still in flight as the prerender completed, and
   * Next rejected it:
   *
   *   During prerendering, fetch() rejects when the prerender is complete.
   *   digest: 'HANGING_PROMISE_REJECTION'
   *
   * Harmless to the shopper (the catch below returns null and the ordinary
   * checkout button is untouched) but it logged on every cart prerender, which is
   * how real errors get lost. `connection()` says "this needs a request",
   * excluding the region from the prerender rather than starting work that cannot
   * finish. Same reason `/admin` uses it, and preferable to
   * `export const dynamic`, which is incompatible with `cacheComponents`.
   */
  await connection();

  const total = summary.grandTotal;

  if (!total) {
    return null;
  }

  /*
   * From `Intl`, not hardcoded: JPY has 0 decimal places and KWD has 3, and a
   * wallet told the wrong scale charges the wrong amount by a factor of 100.
   * Cheaper and more accurate than a second BigCommerce query for it.
   */
  const decimalPlaces =
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency: total.currencyCode,
    }).resolvedOptions().maximumFractionDigits ?? 2;

  /*
   * The `try` covers the fetch only — never the render. JSX returned from inside
   * a `catch` is a lie: React renders it later, so nothing thrown during render
   * would be caught here anyway. An error boundary is the tool for that.
   */
  let options: Awaited<ReturnType<typeof getWalletButtons>> = [];

  try {
    options = await getWalletButtons(cartId, total.currencyCode, total.value, decimalPlaces);
  } catch (error) {
    // A wallet provider being down, or the alpha API changing shape, must not
    // take the cart page with it — the ordinary checkout link still works.
    console.error('[cart] wallet buttons', error);

    return null;
  }

  return <WalletButtons options={options} />;
}
