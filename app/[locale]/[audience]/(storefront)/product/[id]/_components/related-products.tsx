import { getT } from '~/lib/i18n/server';
import { Suspense } from 'react';

import { getRelatedProducts } from '~/data/product';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * Related products, **without prices**.
 *
 * The grid is cached with the rest of the product page — an hour in the
 * browser — so any price on it could be an hour old on a revisit, and streaming
 * a fresh one per card cost a request-time render on every product view for a
 * number nobody buys at. Like the home page's rows, these cards are
 * merchandising: the price is one click away, live, on the product's own page.
 */
async function RelatedProducts({ productId }: { productId: number }) {
  const t = await getT();
  const products = await getRelatedProducts(productId);

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
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The region the PDP renders. */
export function RelatedProductsRegion({ productId }: { productId: number }) {
  return (
    <Suspense fallback={<RelatedProductsSkeleton />}>
      <RelatedProducts productId={productId} />
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
          </div>
        ))}
      </div>
    </section>
  );
}
