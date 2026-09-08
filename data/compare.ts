import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { type Price, toPrice } from '~/domain/price';
import { query } from '~/lib/bigcommerce';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { PricingFragment } from '~/lib/bigcommerce/fragments/pricing';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

/**
 * Product comparison.
 *
 * **One query for N products, not N queries.** This is the single place in the
 * storefront where a caller legitimately holds a list of product ids, and it is
 * exactly the pattern plan §7.2 warns about: calling a cached per-product
 * function in a loop would turn one page view into up to four origin requests
 * that no cache can coalesce, because each is a different cache key.
 *
 * The ids are **sorted** before they reach the cache key. `?ids=3,1` and
 * `?ids=1,3` are the same comparison, and without sorting they are two cache
 * entries holding identical data — the same canonicalisation discipline the
 * listing keys use.
 */

const CompareProductsQuery = graphql(
  `
    query CompareProducts($entityIds: [Int!], $currencyCode: currencyCode) {
      site {
        products(entityIds: $entityIds, first: 10) {
          edges {
            node {
              entityId
              name
              path
              sku
              plainTextDescription(characterLimit: 300)
              addToCartUrl
              brand {
                name
                path
              }
              defaultImage {
                url: urlTemplate(lossy: true)
                altText
              }
              weight {
                value
                unit
              }
              customFields {
                edges {
                  node {
                    entityId
                    name
                    value
                  }
                }
              }
              reviewSummary {
                numberOfReviews
                averageRating
              }
              availabilityV2 {
                __typename
                status
              }
              inventory {
                isInStock
              }
              productOptions(first: 1) {
                edges {
                  node {
                    entityId
                  }
                }
              }
              ...PricingFragment
            }
          }
        }
      }
    }
  `,
  [PricingFragment],
);

export interface CompareProduct {
  id: number;
  name: string;
  path: string;
  sku: string | null;
  description: string;
  image: { src: string; alt: string } | null;
  brand: { name: string; path: string } | null;
  price: Price | undefined;
  weight: { value: number; unit: string } | null;
  customFields: Array<{ id: number; name: string; value: string }>;
  rating: { average: number; count: number } | null;
  inStock: boolean;
  /** Preorder and unavailable products cannot be added straight to the cart. */
  availability: string;
  /**
   * Whether the product has options that must be chosen first. Drives
   * "View options" instead of "Add to cart" — adding a variant product without
   * a variant selected fails, and doing it from a comparison table gives the
   * shopper no way to understand why.
   */
  hasOptions: boolean;
}

/** Comparing more than a handful is unreadable, and BigCommerce paginates anyway. */
export const MAX_COMPARE = 10;

export async function getCompareProducts(
  entityIds: readonly number[],
  taxDisplay: 'INC' | 'EX' | 'BOTH' | null,
): Promise<CompareProduct[]> {
  'use cache: remote';
  cacheLife('listing');

  const ids = [...new Set(entityIds)].sort((a, b) => a - b).slice(0, MAX_COMPARE);

  if (ids.length === 0) {
    return [];
  }

  cacheTag(tags.products, ...ids.map((id) => tags.product(id)));

  const data = await query({
    document: CompareProductsQuery,
    variables: { entityIds: [...ids], currencyCode: null },
  });

  const products = removeEdgesAndNodes(data.site.products);

  /*
   * Returned in the caller's requested order, not BigCommerce's. The query is
   * keyed on a sorted id list for cache reasons, but a shopper who ticked
   * C then A expects to read the table in that order.
   */
  const byId = new Map(products.map((product) => [product.entityId, product]));

  return entityIds
    .map((id) => byId.get(id))
    .filter((product): product is NonNullable<typeof product> => Boolean(product))
    .map((product) => ({
      id: product.entityId,
      name: product.name,
      path: product.path,
      sku: product.sku || null,
      description: product.plainTextDescription,
      image: product.defaultImage
        ? { src: product.defaultImage.url, alt: product.defaultImage.altText }
        : null,
      brand: product.brand ? { name: product.brand.name, path: product.brand.path } : null,
      price: toPrice(product, taxDisplay),
      weight: product.weight ? { value: product.weight.value, unit: product.weight.unit } : null,
      customFields: removeEdgesAndNodes(product.customFields).map((field) => ({
        id: field.entityId,
        name: field.name,
        value: field.value,
      })),
      rating: product.reviewSummary
        ? {
            average: Number(product.reviewSummary.averageRating),
            count: product.reviewSummary.numberOfReviews,
          }
        : null,
      inStock: product.inventory.isInStock,
      availability: product.availabilityV2.status,
      hasOptions: removeEdgesAndNodes(product.productOptions).length > 0,
    }));
}
