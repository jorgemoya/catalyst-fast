import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { customerQuery } from '~/lib/bigcommerce/customer';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

import { getSession } from './session';

/**
 * Wishlists.
 *
 * The PDP heart needs to know "is this product in any of my lists?", which is one
 * question over all of them — so the read is list-shaped rather than
 * per-product. That matters for the PDP: a per-product query would be a second
 * customer-scoped round trip on every product page, whereas this one is shared by
 * the heart and the account page and resolves from the same private scope.
 */

const WishlistsQuery = graphql(`
  query CustomerWishlists {
    customer {
      wishlists(first: 50) {
        edges {
          node {
            entityId
            name
            isPublic
            token
            items(first: 50) {
              edges {
                node {
                  entityId
                  productEntityId
                  variantEntityId
                }
              }
            }
          }
        }
      }
    }
  }
`);

export interface WishlistItem {
  id: number;
  productId: number;
  variantId: number | null;
}

export interface Wishlist {
  id: number;
  name: string;
  isPublic: boolean;
  /** Shareable link identifier; only meaningful when `isPublic`. */
  token: string;
  items: WishlistItem[];
}

export async function getWishlists(): Promise<Wishlist[]> {
  'use cache: private';
  cacheLife({ stale: 30 });

  const session = await getSession();

  if (!session) {
    return [];
  }

  cacheTag(tags.wishlists(session.customerId));

  const data = await customerQuery({
    document: WishlistsQuery,
    customerAccessToken: session.customerAccessToken,
  });

  const wishlists = data.customer?.wishlists;

  if (!wishlists) {
    return [];
  }

  return removeEdgesAndNodes(wishlists).map((wishlist) => ({
    id: wishlist.entityId,
    name: wishlist.name,
    isPublic: wishlist.isPublic,
    token: wishlist.token,
    items: removeEdgesAndNodes(wishlist.items).map((item) => ({
      id: item.entityId,
      productId: item.productEntityId,
      variantId: item.variantEntityId ?? null,
    })),
  }));
}

/**
 * Which of the shopper's lists contain a product.
 *
 * Derived from the single wishlists read rather than asking BigCommerce per
 * product, so the PDP heart costs no additional origin request beyond the one the
 * account page already makes.
 */
export async function getWishlistsContaining(productId: number): Promise<number[]> {
  const wishlists = await getWishlists();

  return wishlists
    .filter((wishlist) => wishlist.items.some((item) => item.productId === productId))
    .map((wishlist) => wishlist.id);
}

const WishlistDetailQuery = graphql(`
  query WishlistDetail($entityId: Int!) {
    customer {
      wishlists(filters: { entityIds: [$entityId] }, first: 1) {
        edges {
          node {
            entityId
            name
            isPublic
            token
            items(first: 100) {
              edges {
                node {
                  entityId
                  productEntityId
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
    }
  }
`);

export interface WishlistDetailItem {
  id: number;
  productId: number;
  name: string;
  href: string;
  image: { src: string; alt: string } | null;
}

export interface WishlistDetail {
  id: number;
  name: string;
  isPublic: boolean;
  token: string;
  items: WishlistDetailItem[];
}

/**
 * One wishlist with its products resolved.
 *
 * Separate from `getWishlists` because the PDP heart and the index only need ids
 * — pulling product name, path, and image for every item of every list would
 * make the cheap question expensive. Same rule as `getCartCount` vs `getCart`.
 */
export async function getWishlist(entityId: number): Promise<WishlistDetail | null> {
  'use cache: private';
  cacheLife({ stale: 30 });

  const session = await getSession();

  if (!session) {
    return null;
  }

  cacheTag(tags.wishlists(session.customerId));

  const data = await customerQuery({
    document: WishlistDetailQuery,
    customerAccessToken: session.customerAccessToken,
    variables: { entityId },
  });

  const wishlist = removeEdgesAndNodes(data.customer?.wishlists ?? { edges: [] }).at(0);

  if (!wishlist) {
    return null;
  }

  return {
    id: wishlist.entityId,
    name: wishlist.name,
    isPublic: wishlist.isPublic,
    token: wishlist.token,
    // A product can be deleted from the catalog while still sitting in a list;
    // BigCommerce returns the item with a null product rather than dropping it.
    items: removeEdgesAndNodes(wishlist.items)
      .filter((item) => item.product)
      .map((item) => ({
        id: item.entityId,
        productId: item.productEntityId,
        name: item.product?.name ?? '',
        href: item.product?.path ?? '#',
        image: item.product?.defaultImage
          ? { src: item.product.defaultImage.url, alt: item.product.defaultImage.altText }
          : null,
      })),
  };
}
