import type { ResultOf } from 'gql.tada';

import type { PricingFragment } from '~/lib/bigcommerce/fragments/pricing';

/**
 * Price domain model.
 *
 * Ported from `core/data-transformers/prices-transformer.ts` with ONE structural
 * change that matters: the model carries raw numbers and currency codes, never
 * formatted strings.
 *
 * Catalyst formatted inside the transformer via `getFormatter()` from
 * `next-intl/server`. That is request-scoped and throws inside a `'use cache'`
 * body, so it cannot survive here. It would also be wrong on its own terms —
 * caching formatted output couples every cache entry to a locale, multiplying
 * entries for data that doesn't vary. Formatting is pure and cheap, so it happens
 * at render (`ui/patterns/price.tsx` via `formatCurrency`).
 */

export type TaxDisplay = 'INC' | 'EX' | 'BOTH';

export interface Money {
  /** Including tax. */
  inc: number;
  /** Excluding tax. */
  ex: number;
  currencyCode: string;
}

export type Price =
  | { type: 'plain'; money: Money; mode: TaxDisplay }
  | { type: 'sale'; previous: Money; current: Money; mode: TaxDisplay }
  | { type: 'range'; min: Money; max: Money; mode: TaxDisplay };

type Pricing = ResultOf<typeof PricingFragment>;
type Amount = { value: number; currencyCode: string };

const toMoney = (inc: Amount, ex: Amount): Money => ({
  inc: inc.value,
  ex: ex.value,
  currencyCode: inc.currencyCode,
});

export function toPrice(
  pricing: Pricing,
  taxDisplay: TaxDisplay | null | undefined = 'EX',
): Price | undefined {
  const inc = pricing.pricesIncludingTax;
  const ex = pricing.pricesExcludingTax;

  if (!inc || !ex) {
    return undefined;
  }

  let mode: TaxDisplay = taxDisplay ?? 'EX';

  // Tax-disabled stores, tax-exempt customer groups, and some B2B contexts return
  // identical inc/ex values. Degrade BOTH to a single line rather than printing
  // the same number twice.
  if (mode === 'BOTH') {
    const hasTaxDifference =
      inc.price.value !== ex.price.value ||
      inc.basePrice?.value !== ex.basePrice?.value ||
      inc.salePrice?.value !== ex.salePrice?.value ||
      inc.priceRange.min.value !== ex.priceRange.min.value ||
      inc.priceRange.max.value !== ex.priceRange.max.value;

    if (!hasTaxDifference) {
      mode = 'EX';
    }
  }

  if (inc.priceRange.min.value !== inc.priceRange.max.value) {
    return {
      type: 'range',
      min: toMoney(inc.priceRange.min, ex.priceRange.min),
      max: toMoney(inc.priceRange.max, ex.priceRange.max),
      mode,
    };
  }

  const isSale = inc.salePrice?.value !== inc.basePrice?.value;

  if (isSale && inc.salePrice && inc.basePrice && ex.salePrice && ex.basePrice) {
    return {
      type: 'sale',
      previous: toMoney(inc.basePrice, ex.basePrice),
      current: toMoney(inc.price, ex.price),
      mode,
    };
  }

  return { type: 'plain', money: toMoney(inc.price, ex.price), mode };
}
