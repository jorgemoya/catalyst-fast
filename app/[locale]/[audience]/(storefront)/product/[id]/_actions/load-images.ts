'use server';

import { type ProductImage, getMoreProductImages } from '~/data/product';

/**
 * Fetches the next page of gallery images.
 *
 * A thin wrapper over the cached `getMoreProductImages` — the action exists only
 * because a Client Component cannot call a `'use cache'` function directly. All
 * of the caching lives in `data/`, so two shoppers paging the same gallery share
 * one origin request.
 *
 * The first twelve images are always server-rendered into the HTML; this only
 * ever adds to them, so a shopper without JavaScript loses the button rather
 * than the gallery.
 */
export async function loadMoreImages(
  productId: number,
  cursor: string,
): Promise<{ images: ProductImage[]; nextCursor: string | null }> {
  return getMoreProductImages(productId, cursor);
}
