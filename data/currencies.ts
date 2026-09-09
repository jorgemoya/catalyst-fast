import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { query } from '~/lib/bigcommerce';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

/**
 * Currencies the shopper may switch to.
 *
 * **The list comes from BigCommerce, not from local config.** It used to be
 * intersected with a hardcoded array, which meant a merchant enabling a currency
 * got nothing until someone edited the repo — and the hardcoded values were
 * inferred from a one-off probe rather than read from the store.
 *
 * **Transactional only, and that is the one hard filter.** BigCommerce
 * distinguishes a currency you can display from one you can be charged in.
 * Offering a display-only currency produces a shopper who picks it, fills a
 * cart, and discovers at checkout that the store settles in something else.
 *
 * `isActive` is deliberately *not* filtered on, and this is the one judgement
 * call in the file. It controls whether BigCommerce surfaces the currency in its
 * *own* storefront's picker — a setting about a storefront that isn't this one.
 * Verified against this store: EUR and GBP are both inactive, and BigCommerce
 * still returns correctly converted, transactable prices for both. Filtering on
 * it would leave a single-currency switcher on a store with three working
 * currencies.
 *
 * The tradeoff is honest: a merchant who deactivates a currency to retire it
 * will still see it offered here until they clear the transactional flag too. If
 * that becomes the wrong default for a store, this filter is the one line to
 * change.
 */

const CurrenciesQuery = graphql(`
  query StoreCurrencies {
    site {
      currencies(first: 25) {
        edges {
          node {
            code
            isTransactional
          }
        }
      }
    }
  }
`);

/**
 * Deliberately just the code.
 *
 * `name` and `display.symbol` are available and are **not** selected. The
 * switcher renders codes, and prices are formatted by `Intl.NumberFormat` from
 * the code — which produces the right symbol for the *shopper's* locale, where
 * the store's `symbol` field is a single global string. This store has GBP's set
 * to empty, so a call site trusting it would render a bare number.
 *
 * If the switcher should ever read "USD — US Dollar", add `name` back then. A
 * field carried for a hypothetical caller is how `isDefault` ended up feeding
 * the wrong default into locale routing.
 */
export interface StoreCurrency {
  code: string;
}

export async function getSwitchableCurrencies(): Promise<StoreCurrency[]> {
  'use cache';
  cacheLife('settings');
  cacheTag(tags.settings);

  const data = await query({ document: CurrenciesQuery });

  return removeEdgesAndNodes(data.site.currencies)
    .filter((currency) => currency.isTransactional)
    .map((currency) => ({ code: currency.code }));
}
