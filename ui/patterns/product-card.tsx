import type { ProductCard as ProductCardModel } from '~/domain/product-card';
import { cn } from '~/lib/cn';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';
import { Rating } from '~/ui/primitives/rating';
import { Skeleton } from '~/ui/primitives/skeleton';

import { PriceLabel } from './price';
import { t } from '~/lib/i18n/messages';

interface Props {
  product: ProductCardModel;
  /** Set on the first row of the first grid on a page — this is the LCP image. */
  priority?: boolean;
  showRating?: boolean;
  /** Responsive width hint. Without it the browser over-requests from the CDN. */
  sizes?: string;
}

/**
 * A single product tile.
 *
 * A plain Server Component with nine props, versus Catalyst's card sitting inside
 * a 27-prop section. It takes a resolved domain model rather than fetching, since
 * cards always render as part of a list whose single query already returned
 * pricing inline — a card that fetched its own price would turn one request into N.
 */
export function ProductCard({ product, priority, showRating = true, sizes }: Props) {
  return (
    // `relative` is load-bearing, not cosmetic: the title link below stretches
    // itself with `after:absolute after:inset-0`, which resolves against the
    // nearest *positioned* ancestor. Without it the pseudo-element escapes the
    // card and covers unrelated page content — it was swallowing clicks on the
    // facet sidebar.
    <article className="group relative flex flex-col gap-3">
      <Link
        className="relative block aspect-square overflow-hidden rounded-(--radius-card) bg-surface"
        href={product.href}
      >
        {product.image ? (
          <Image
            alt={product.image.alt}
            className="size-full object-cover transition-transform duration-(--duration-slow) ease-(--ease-out-quart) group-hover:scale-105"
            fill
            priority={priority}
            sizes={sizes ?? '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw'}
            src={product.image.src}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-subtle">
            {t('Common.noImage')}
          </div>
        )}
      </Link>

      <div className="flex flex-col gap-1">
        {product.brand && <p className="text-2xs tracking-wide text-muted uppercase">{product.brand}</p>}

        <h3 className="text-sm leading-snug font-medium">
          {/* Stretched over the image link so the whole card is one hit target,
              while the accessible name still comes from the title. */}
          <Link className="after:absolute after:inset-0" href={product.href}>
            {product.title}
          </Link>
        </h3>

        {showRating && product.numberOfReviews > 0 && (
          <Rating numberOfReviews={product.numberOfReviews} rating={product.rating} />
        )}

        <PriceLabel className="mt-0.5" price={product.price} />

        {product.inventoryMessage && (
          <p className="text-xs text-out-of-stock">{product.inventoryMessage}</p>
        )}
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="aspect-square rounded-(--radius-card)" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-1/4" />
    </div>
  );
}

export function ProductGrid({
  products,
  priority,
  showRating,
  className,
}: {
  products: ProductCardModel[];
  priority?: boolean;
  showRating?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn('grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4', className)}>
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard
            // Only the first row is eligible for LCP; priority on everything
            // would deprioritize the one image that actually matters.
            priority={priority && index < 4}
            product={product}
            showRating={showRating}
          />
        </li>
      ))}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </div>
  );
}
