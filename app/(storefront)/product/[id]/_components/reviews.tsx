import { getProductReviews } from '~/data/product';
import { getStoreSettings } from '~/data/settings';
import { ReviewList } from '~/ui/patterns/review-list';
import { Skeleton } from '~/ui/primitives/skeleton';
import { t } from '~/lib/i18n/messages';

/**
 * Product reviews, read-only.
 *
 * Gated on the merchant's `reviews.enabled` setting — a store with reviews turned
 * off should show no section at all, not an empty one.
 *
 * The first page is fetched here on the server so it lands in the static shell
 * and is crawlable; `ReviewList` only appends subsequent pages. Submission is
 * deferred, since it needs reCAPTCHA and a validated server action.
 */
export async function ProductReviews({ productId }: { productId: number }) {
  const [settings, page] = await Promise.all([
    getStoreSettings(),
    getProductReviews(productId),
  ]);

  if (!settings.reviewsEnabled) {
    return null;
  }

  return (
    <section className="mt-16 scroll-mt-24" id="reviews">
      <h2 className="mb-6 text-lg font-semibold">{t('Product.reviews')}</h2>

      <ReviewList
        initialCursor={page.endCursor}
        initialHasNextPage={page.hasNextPage}
        initialReviews={page.reviews}
        productId={productId}
      />
    </section>
  );
}

export function ProductReviewsSkeleton() {
  return (
    <section className="mt-16">
      <Skeleton className="mb-6 h-6 w-32" />
      <div className="flex flex-col gap-6">
        {Array.from({ length: 2 }, (_, index) => (
          <div className="flex flex-col gap-2" key={index}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-12 w-full max-w-prose" />
          </div>
        ))}
      </div>
    </section>
  );
}
