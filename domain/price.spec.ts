import { describe, expect, it } from 'vitest';

import { toPrice } from './price';

/**
 * Pricing carries the highest consequence of anything in the domain layer: a
 * wrong tax mode shows a shopper a number they won't be charged. BigCommerce
 * recomputes line prices at add-to-cart and again at checkout, so this is a UX
 * defect rather than a revenue one — but it is still the thing most worth
 * getting right.
 */

const amount = (value: number) => ({ value, currencyCode: 'USD' });

const pricing = (inc: Partial<Record<string, number>>, ex: Partial<Record<string, number>>) => ({
  pricesIncludingTax: {
    price: amount(inc.price ?? 0),
    basePrice: amount(inc.basePrice ?? inc.price ?? 0),
    retailPrice: amount(inc.retailPrice ?? 0),
    salePrice: amount(inc.salePrice ?? inc.basePrice ?? inc.price ?? 0),
    priceRange: { min: amount(inc.min ?? inc.price ?? 0), max: amount(inc.max ?? inc.price ?? 0) },
  },
  pricesExcludingTax: {
    price: amount(ex.price ?? 0),
    basePrice: amount(ex.basePrice ?? ex.price ?? 0),
    retailPrice: amount(ex.retailPrice ?? 0),
    salePrice: amount(ex.salePrice ?? ex.basePrice ?? ex.price ?? 0),
    priceRange: { min: amount(ex.min ?? ex.price ?? 0), max: amount(ex.max ?? ex.price ?? 0) },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

describe('toPrice', () => {
  it('returns a plain price when base and sale agree', () => {
    const price = toPrice(pricing({ price: 120 }, { price: 100 }), 'EX');

    expect(price).toEqual({
      type: 'plain',
      money: { inc: 120, ex: 100, currencyCode: 'USD' },
      mode: 'EX',
    });
  });

  it('returns a sale price when sale differs from base', () => {
    const price = toPrice(
      pricing({ price: 80, basePrice: 100, salePrice: 80 }, { price: 80, basePrice: 100, salePrice: 80 }),
      'EX',
    );

    expect(price).toMatchObject({
      type: 'sale',
      previous: { ex: 100 },
      current: { ex: 80 },
    });
  });

  it('returns a range when min and max differ', () => {
    const price = toPrice(pricing({ price: 10, min: 10, max: 50 }, { price: 10, min: 10, max: 50 }), 'EX');

    expect(price).toMatchObject({ type: 'range', min: { ex: 10 }, max: { ex: 50 } });
  });

  it('prefers range over sale when both could apply', () => {
    // A variant product on sale still needs a range — showing one struck-through
    // price for a product spanning $10–$50 would be wrong.
    const price = toPrice(
      pricing(
        { price: 10, basePrice: 20, salePrice: 10, min: 10, max: 50 },
        { price: 10, basePrice: 20, salePrice: 10, min: 10, max: 50 },
      ),
      'EX',
    );

    expect(price?.type).toBe('range');
  });

  describe('tax display', () => {
    it('carries the requested mode through', () => {
      expect(toPrice(pricing({ price: 120 }, { price: 100 }), 'INC')?.mode).toBe('INC');
      expect(toPrice(pricing({ price: 120 }, { price: 100 }), 'BOTH')?.mode).toBe('BOTH');
    });

    it('degrades BOTH to EX when inc and ex are identical', () => {
      // Tax-disabled stores, tax-exempt customer groups, and some B2B contexts
      // return equal values. Rendering BOTH would print the same number twice.
      expect(toPrice(pricing({ price: 100 }, { price: 100 }), 'BOTH')?.mode).toBe('EX');
    });

    it('keeps BOTH when only the range bounds differ', () => {
      const price = toPrice(
        pricing({ price: 100, min: 100, max: 220 }, { price: 100, min: 100, max: 200 }),
        'BOTH',
      );

      expect(price?.mode).toBe('BOTH');
    });

    it('defaults to EX when the store setting is absent', () => {
      expect(toPrice(pricing({ price: 120 }, { price: 100 }), null)?.mode).toBe('EX');
      expect(toPrice(pricing({ price: 120 }, { price: 100 }), undefined)?.mode).toBe('EX');
    });
  });

  it('returns undefined when either tax variant is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(toPrice({ pricesIncludingTax: null, pricesExcludingTax: null } as any, 'EX')).toBeUndefined();
  });
});
