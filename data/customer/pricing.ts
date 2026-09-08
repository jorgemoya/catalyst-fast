import 'server-only';

import { cacheLife } from 'next/cache';

import type { OptionValueId } from '~/data/pricing';
import { type Price, toPrice } from '~/domain/price';
import { customerQuery } from '~/lib/bigcommerce/customer';
import { PricingFragment } from '~/lib/bigcommerce/fragments/pricing';
import { graphql } from '~/lib/bigcommerce/graphql';
import { env } from '~/lib/env';

import { DEFAULT_CUSTOMER_GROUP_ID, getSession } from './session';

/**
 * Personalized pricing — the overlay described in plan §3.2, and the single most
 * consequential caching decision in the project.
 *
 * **Why it can't be cached publicly.** BigCommerce resolves `prices(...)` against
 * the *identity of the requester*; there is no `customerGroupId` argument to key
 * on. And Next stores cache keys and tag values in plain text, so a customer
 * access token must never appear in either. Personalized prices are therefore not
 * server-cacheable through the ordinary path, and pretending otherwise would
 * either leak one customer's pricing to another or put a credential in a cache
 * key.
 *
 * **Why that costs almost nothing anyway.** The gate below means the fetch only
 * happens for shoppers whose price can actually differ:
 *
 *   guests                          → 0 fetches; price is in the prerendered shell
 *   signed-in, default group        → 0 fetches; their price *is* the catalog price
 *   signed-in, group w/o price list → 0 fetches; same, and this is most stores
 *   signed-in, group w/ price list  → 1 small query in a Suspense hole
 *
 * The middle two lines are the important ones. Together they cover the
 * overwhelming majority of signed-in traffic, and they are why a logged-in PDP
 * can serve the same static shell as a guest's. Catalyst, by contrast, flipped
 * every query on the page to `no-store` the moment a customer token existed.
 *
 * Only the last line costs anything, and it is opt-in via
 * `PERSONALIZED_PRICE_GROUPS` — see `lib/env.ts` for why it must be declared
 * rather than detected.
 *
 * **A stale display price is a UX defect, never a revenue defect.** BigCommerce
 * recomputes line prices at add-to-cart and again at checkout. Never derive a
 * cart total from a cached price.
 */

const CustomerPricesQuery = graphql(
  `
    # PricingFragment references $currencyCode, so the operation must declare it —
    # the public ProductPrices query does the same. Omitting it fails with
    # "Variable '$currencyCode' is not defined by operation".
    query CustomerPrices(
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
 * Returns `null` when the shopper's price is the catalog price — which the caller
 * renders as "no overlay", leaving the cached shell price visible and untouched.
 */
export async function getPersonalizedPrice(
  entityId: number,
  taxDisplay: 'INC' | 'EX' | 'BOTH' | null,
  optionValueIds: readonly OptionValueId[] = [],
): Promise<Price | undefined | null> {
  'use cache: private';
  cacheLife({ stale: 30 });

  const session = await getSession();

  if (!session) {
    return null;
  }

  /*
   * The gate. Requires `customerGroupId` on the session, which is why the login
   * mutations select it — see `lib/auth/mutations.ts`.
   *
   * Two conditions, and the second matters more than it looks. Skipping the
   * default group is obvious: their price *is* the catalog price. But skipping
   * groups with no price list is what makes this free on a typical store — a
   * non-default group only implies different prices if the merchant actually
   * attached a price list to it, and grouping customers for other reasons
   * (wholesale flags, region, B2B account tiers) is common.
   *
   * With `PERSONALIZED_PRICE_GROUPS` empty — the default — every signed-in
   * shopper takes the early return and the price stays in the cached shell.
   */
  if (session.customerGroupId === DEFAULT_CUSTOMER_GROUP_ID) {
    return null;
  }

  if (!env.PERSONALIZED_PRICE_GROUPS.includes(session.customerGroupId)) {
    return null;
  }

  const data = await customerQuery({
    document: CustomerPricesQuery,
    customerAccessToken: session.customerAccessToken,
    variables: {
      entityId,
      currencyCode: null,
      optionValueIds: [...optionValueIds].sort(
        (a, b) => a.optionEntityId - b.optionEntityId || a.valueEntityId - b.valueEntityId,
      ),
    },
  });

  if (!data.site.product) {
    return null;
  }

  return toPrice(data.site.product, taxDisplay);
}
