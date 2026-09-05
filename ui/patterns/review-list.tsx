'use client';

import { useState, useTransition } from 'react';

import { loadMoreReviews } from '~/app/(storefront)/product/[id]/_actions/load-reviews';
import type { Review } from '~/data/product';
import { formatDate, t } from '~/lib/i18n/messages';
import { Rating } from '~/ui/primitives/rating';

/**
 * Review list with incremental loading.
 *
 * A client island only because "load more" is interaction state. The first page
 * is server-rendered and passed in, so the reviews section is complete in the
 * static shell and crawlable — the island only appends.
 *
 * Paging via a Server Function rather than a search param keeps the PDP static;
 * a `?reviews_after=` param would make the whole page dynamic for every visitor.
 */
export function ReviewList({
  productId,
  initialReviews,
  initialHasNextPage,
  initialCursor,
}: {
  productId: number;
  initialReviews: Review[];
  initialHasNextPage: boolean;
  initialCursor: string | null;
}) {
  const [reviews, setReviews] = useState(initialReviews);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasNextPage, setHasNextPage] = useState(initialHasNextPage);
  const [isPending, startTransition] = useTransition();

  if (reviews.length === 0) {
    return <p className="text-sm text-muted">{t('Product.noReviews')}</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-8">
        {reviews.map((review) => (
          <li className="border-b border-border pb-6 last:border-0" key={review.id}>
            <Rating rating={review.rating} />
            <h3 className="mt-2 text-sm font-semibold">{review.title}</h3>
            <p className="mt-1 text-xs text-muted">
              {review.author} · {formatDate(review.createdAt)}
            </p>
            <p className="mt-3 max-w-prose text-sm text-muted">{review.text}</p>
          </li>
        ))}
      </ul>

      {hasNextPage && cursor && (
        <button
          className="mt-8 h-10 rounded-(--radius-control) border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-60"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              const next = await loadMoreReviews(productId, cursor);

              setReviews((current) => [...current, ...next.reviews]);
              setCursor(next.endCursor);
              setHasNextPage(next.hasNextPage);
            });
          }}
          type="button"
        >
          {isPending ? t('Product.loadingReviews') : t('Product.loadMoreReviews')}
        </button>
      )}
    </>
  );
}
