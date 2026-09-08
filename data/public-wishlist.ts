import { cacheLife, cacheTag } from 'next/cache';

import { query } from '~/lib/bigcommerce';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

/**
 * A shared wishlist, by token.
 *
 * **Public data, so it lives in `data/` rather than `data/customer/`** — and that
 * is the whole point of the route. The token is the capability, exactly like a
 * cart id: whoever holds it may view the list, no session required. So this is a
 * normal shared cache keyed by a scalar, and two people opening the same shared
 * link cost one origin request between them.
 *
 * BigCommerce returns nothing when the owner turns sharing off, so a revoked link
 * goes dead on its own — no invalidation needed here.
 */

const PublicWishlistQuery = graphql(`
  query PublicWishlist($token: String!) {
    site {
      publicWishlist(token: $token) {
        entityId
        name
        items(first: 100) {
          edges {
            node {
              entityId
              product {
                name
                path
                defaultImage {
                  url: urlTemplate(lossy: true)
                  altText
                }
              }
            }
          }
        }
      }
    }
  }
`);

export interface PublicWishlist {
  id: number;
  name: string;
  items: Array<{
    id: number;
    name: string;
    href: string;
    image: { src: string; alt: string } | null;
  }>;
}

export async function getPublicWishlist(token: string): Promise<PublicWishlist | null> {
  'use cache';
  cacheLife('content');
  cacheTag(tags.content);

  const data = await query({ document: PublicWishlistQuery, variables: { token } });
  const wishlist = data.site.publicWishlist;

  if (!wishlist) {
    return null;
  }

  return {
    id: wishlist.entityId,
    name: wishlist.name,
    items: removeEdgesAndNodes(wishlist.items)
      .filter((item) => item.product)
      .map((item) => ({
        id: item.entityId,
        name: item.product?.name ?? '',
        href: item.product?.path ?? '#',
        image: item.product?.defaultImage
          ? { src: item.product.defaultImage.url, alt: item.product.defaultImage.altText }
          : null,
      })),
  };
}
