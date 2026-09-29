'use server';

import { getProductReviews, type Review } from '~/data/product';

/**
 * Next page of reviews.
 *
 * A Server Function rather than a `?reviews_after=` search param, for the same
 * reason variant selection is client-owned: reading search params on the server
 * would make the entire PDP dynamic for every visitor, including the majority
 * who never scroll to the reviews. `getProductReviews` is cached, so paging back
 * and forth costs nothing after the first read.
 */
export async function loadMoreReviews(
  productId: number,
  after: string,
): Promise<{ reviews: Review[]; hasNextPage: boolean; endCursor: string | null }> {
  return getProductReviews(productId, 5, after);
}
