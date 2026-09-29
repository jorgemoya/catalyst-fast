import { getFormatCurrency, getT } from '~/lib/i18n/server';
import { Suspense } from 'react';

import { getRelatedProducts } from '~/data/product';
import { getDefaultCurrency, getSelectedCurrency } from '~/lib/currency';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * Related products.
 *
 * Prices come inline from the same query rather than each card fetching its own —
 * the guardrail against turning one request into N, which is the failure mode a
 * component-fetches-its-own-data rule invites on a grid.
 *
 * **Two variants, for currency.** `RelatedProductsRegion` renders the cached
 * default-currency grid as a Suspense *fallback* and streams the shopper's
 * currency over it — the same nested-boundary pattern the listing uses, and for
 * the same reason: the default stays in the static shell while a switched
 * currency still renders correctly.
 *
 * This was originally a single default-currency component, which left a shopper
 * on EUR looking at a EUR headline price above a carousel of USD prices.
 */
async function RelatedProductsGrid({
  productId,
  currency,
}: {
  productId: number;
  currency: string;
}) {
  const [t, formatCurrency] = await Promise.all([getT(), getFormatCurrency()]);
  const products = await getRelatedProducts(productId, currency);

  if (products.length === 0) {
    return null;
  }

  return (
    <section className="mt-16">
      <h2 className="mb-6 text-lg font-semibold">{t('Product.relatedProducts')}</h2>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <li key={product.id}>
            <article className="group relative flex flex-col gap-3">
              <div className="relative aspect-square overflow-hidden rounded-(--radius-card) bg-surface">
                {product.image && (
                  <Image
                    alt={product.image.alt}
                    className="size-full object-cover transition-transform duration-(--duration-slow) ease-(--ease-out-quart) group-hover:scale-105"
                    fill
                    sizes="(min-width: 1024px) 25vw, 50vw"
                    src={product.image.src}
                  />
                )}
              </div>
              <div>
                {product.brand && (
                  <p className="text-2xs tracking-wide text-muted uppercase">{product.brand}</p>
                )}
                <h3 className="text-sm leading-snug font-medium">
                  <Link className="after:absolute after:inset-0" href={product.href}>
                    {product.title}
                  </Link>
                </h3>
                {product.price !== null && (
                  <p className="mt-1 text-sm font-medium">
                    {formatCurrency(product.price, product.currencyCode)}
                  </p>
                )}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The cached, default-currency variant. No cookie read, so it prerenders.
 */
export async function RelatedProducts({ productId }: { productId: number }) {
  return <RelatedProductsGrid currency={await getDefaultCurrency()} productId={productId} />;
}

/**
 * The shopper's currency. Reads the currency cookie through a private scope, so
 * it is a hole — which is why it only ever appears *over* the cached fallback.
 */
async function RelatedProductsSelected({ productId }: { productId: number }) {
  return <RelatedProductsGrid currency={await getSelectedCurrency()} productId={productId} />;
}

/**
 * The composed region the PDP renders.
 *
 * The inner boundary is required: a Suspense fallback must not itself suspend,
 * which is the constraint spiked in Phase 0 and documented on the listing.
 */
export function RelatedProductsRegion({ productId }: { productId: number }) {
  return (
    <Suspense
      fallback={
        <Suspense fallback={<RelatedProductsSkeleton />}>
          <RelatedProducts productId={productId} />
        </Suspense>
      }
    >
      <RelatedProductsSelected productId={productId} />
    </Suspense>
  );
}

export function RelatedProductsSkeleton() {
  return (
    <section className="mt-16">
      <Skeleton className="mb-6 h-6 w-48" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="flex flex-col gap-3" key={index}>
            <Skeleton className="aspect-square rounded-(--radius-card)" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        ))}
      </div>
    </section>
  );
}
