import { cacheLife, cacheTag } from 'next/cache';

import { type Price, toPrice } from '~/domain/price';
import { query } from '~/lib/bigcommerce';
import { PricingFragment } from '~/lib/bigcommerce/fragments/pricing';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

import { getStoreSettings } from './settings';

/**
 * Product pricing, keyed by product and variant selection.
 *
 * **This is the default-customer-group price**, and it is shared by every
 * visitor — including logged-in ones. That is deliberate and is the single
 * biggest departure from Catalyst, where the presence of a customer token
 * flipped the whole query to `no-store` and logged-in shoppers got zero caching.
 *
 * BigCommerce resolves `prices(...)` against the identity of the requester and
 * offers no `customerGroupId` argument, and Next stores cache keys in plain
 * text — so a customer token must never reach this function or its key.
 * Personalized pricing is a separate, never-server-cached overlay (Phase 6).
 *
 * `use cache: remote` rather than plain `use cache`: this renders after a
 * Suspense boundary on variant changes, where an in-memory cache has an
 * effectively zero hit rate in serverless.
 */

const ProductPricesQuery = graphql(
  `
    query ProductPrices(
      $entityId: Int!
      $currencyCode: currencyCode
      $optionValueIds: [OptionValueId!]
    ) {
      site {
        product(entityId: $entityId, optionValueIds: $optionValueIds) {
          ...PricingFragment
        }
      }
    }
  `,
  [PricingFragment],
);

/**
 * BigCommerce wants option values as `{optionEntityId, valueEntityId}` pairs, but
 * the shopper's selection is just a set of value ids. Callers pass the pairs.
 */
export interface OptionValueId {
  optionEntityId: number;
  valueEntityId: number;
}

export async function getProductPrice(
  entityId: number,
  optionValueIds: readonly OptionValueId[] = [],
): Promise<Price | undefined> {
  'use cache: remote';
  cacheLife('price');
  cacheTag(tags.productPrice(entityId), tags.product(entityId), tags.prices);

  const [data, settings] = await Promise.all([
    query({
      document: ProductPricesQuery,
      variables: {
        entityId,
        currencyCode: null,
        // Sorted so two orderings of the same selection share one entry.
        optionValueIds: [...optionValueIds].sort(
          (a, b) => a.optionEntityId - b.optionEntityId || a.valueEntityId - b.valueEntityId,
        ),
      },
    }),
    getStoreSettings(),
  ]);

  if (!data.site.product) {
    return undefined;
  }

  return toPrice(data.site.product, settings.taxDisplay.pdp);
}

/**
 * Converts a `{ optionId: valueId }` selection into BigCommerce's pair form.
 *
 * The selection has to be keyed by option rather than a flat set of value ids:
 * a value belongs to exactly one option, and recovering that mapping from a flat
 * list would mean searching every option's values for each id.
 */
export const toOptionValueIds = (selection: Record<string, string>): OptionValueId[] =>
  Object.entries(selection)
    .map(([optionId, valueId]) => ({
      optionEntityId: Number(optionId),
      valueEntityId: Number(valueId),
    }))
    .filter(
      (pair) => Number.isFinite(pair.optionEntityId) && Number.isFinite(pair.valueEntityId),
    )
    .sort((a, b) => a.optionEntityId - b.optionEntityId || a.valueEntityId - b.valueEntityId);
