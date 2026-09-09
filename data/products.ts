import { cacheLife, cacheTag } from 'next/cache';

import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { query } from '~/lib/bigcommerce';
import { toCurrencyCode } from '~/lib/bigcommerce/currency-code';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

import { activeLocale } from './locale';
import { type ProductCard, toProductCard } from '~/domain/product-card';
import { ProductCardFragment } from '~/lib/bigcommerce/fragments/product-card';

import { getStoreSettings } from './settings';

/**
 * Merchandising lists for the home page.
 *
 * `currencyCode` is passed as null, so BigCommerce resolves the store default.
 * v1 is single-currency; when multi-currency lands (Phase 8) currency becomes an
 * explicit argument to these functions — never a cookie read inside the cached
 * body, which would force the whole scope dynamic.
 */

const FeaturedProductsQuery = graphql(
  `
    query FeaturedProducts($currencyCode: currencyCode, $first: Int!) {
      site {
        featuredProducts(first: $first) {
          edges {
            node {
              ...ProductCardFragment
            }
          }
        }
      }
    }
  `,
  [ProductCardFragment],
);

const NewestProductsQuery = graphql(
  `
    query NewestProducts($currencyCode: currencyCode, $first: Int!) {
      site {
        newestProducts(first: $first) {
          edges {
            node {
              ...ProductCardFragment
            }
          }
        }
      }
    }
  `,
  [ProductCardFragment],
);

/** `currency` is explicit so the entry is keyed by it and shared per currency. */
export async function getFeaturedProducts(currency: string, first = 8): Promise<ProductCard[]> {
  'use cache';
  cacheLife('product');
  cacheTag(tags.products);

  // Nesting a cached read inside another cached read is fine and is the point:
  // settings resolves from its own single shared entry rather than being
  // refetched per list.
  const [data, settings] = await Promise.all([
    query({ document: FeaturedProductsQuery, variables: { currencyCode: toCurrencyCode(currency), first },
    locale: await activeLocale(),
  }),
    getStoreSettings(),
  ]);

  return removeEdgesAndNodes(data.site.featuredProducts).map((product) =>
    toProductCard(product, { taxDisplay: settings.taxDisplay.plp, inventory: settings.inventory }),
  );
}

export async function getNewestProducts(currency: string, first = 8): Promise<ProductCard[]> {
  'use cache';
  cacheLife('product');
  cacheTag(tags.products);

  const [data, settings] = await Promise.all([
    query({ document: NewestProductsQuery, variables: { currencyCode: toCurrencyCode(currency), first },
    locale: await activeLocale(),
  }),
    getStoreSettings(),
  ]);

  return removeEdgesAndNodes(data.site.newestProducts).map((product) =>
    toProductCard(product, { taxDisplay: settings.taxDisplay.plp, inventory: settings.inventory }),
  );
}
