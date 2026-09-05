import { describe, expect, it } from 'vitest';

import {
  type InventorySettings,
  type ProductAvailability,
  toBackorderDisplay,
  toCtaState,
  toOutOfStockMessage,
  toSchemaAvailability,
  toStockDisplay,
} from './availability';

/**
 * Stock and backorder rules. Extracted from ~180 lines that sat inline across
 * several `Streamable` closures in Catalyst's PDP page — the branching is
 * intricate enough that getting it wrong misrepresents delivery expectations,
 * which is worse than getting it wrong about, say, a heading.
 */

const settings = (overrides: Partial<InventorySettings> = {}): InventorySettings => ({
  stockLevelDisplay: 'SHOW_ALWAYS',
  showOutOfStockMessage: true,
  defaultOutOfStockMessage: 'Sold out',
  showBackorderAvailabilityPrompt: true,
  backorderAvailabilityPrompt: 'Available to backorder',
  showQuantityOnBackorder: true,
  showBackorderMessage: true,
  ...overrides,
});

const availability = (overrides: Partial<ProductAvailability> = {}): ProductAvailability => ({
  status: 'Available',
  isInStock: true,
  hasVariantInventory: false,
  aggregated: {
    availableToSell: 10,
    warningLevel: 3,
    availableOnHand: 10,
    availableForBackorder: 0,
    unlimitedBackorder: false,
  },
  backorderMessage: null,
  ...overrides,
});

describe('toCtaState', () => {
  it('enables purchase when in stock', () => {
    expect(toCtaState(availability())).toEqual({ kind: 'available', disabled: false });
  });

  it('keeps preorder ENABLED — that is the point of a preorder', () => {
    expect(toCtaState(availability({ status: 'Preorder' }))).toEqual({
      kind: 'preorder',
      disabled: false,
    });
  });

  it('disables an unavailable product', () => {
    expect(toCtaState(availability({ status: 'Unavailable' }))).toEqual({
      kind: 'unavailable',
      disabled: true,
    });
  });

  it('distinguishes out-of-stock from unavailable', () => {
    // BigCommerce models "never purchasable" separately from "temporarily out";
    // conflating them would hide a restock from an interested shopper.
    const state = toCtaState(availability({ isInStock: false }));

    expect(state).toMatchObject({ kind: 'out-of-stock', disabled: true });
    expect(state.kind).not.toBe('unavailable');
  });

  it('treats preorder as purchasable even when not in stock', () => {
    expect(toCtaState(availability({ status: 'Preorder', isInStock: false }))).toEqual({
      kind: 'preorder',
      disabled: false,
    });
  });
});

describe('toStockDisplay', () => {
  it('is silent when the merchant disabled stock display', () => {
    expect(toStockDisplay(availability(), settings({ stockLevelDisplay: 'DONT_SHOW' }))).toBeNull();
  });

  it('shows the count when set to always', () => {
    // The domain reports the number and whether it is low; phrasing is the UI's.
    expect(toStockDisplay(availability(), settings())).toEqual({ available: 10, isLow: false });
  });

  it('flags low stock against the warning level', () => {
    const low = availability({
      aggregated: {
        availableToSell: 2,
        warningLevel: 3,
        availableOnHand: 2,
        availableForBackorder: 0,
        unlimitedBackorder: false,
      },
    });

    expect(toStockDisplay(low, settings())).toEqual({ available: 2, isLow: true });
  });

  it('shows nothing above the warning level when set to show-when-low', () => {
    expect(
      toStockDisplay(availability(), settings({ stockLevelDisplay: 'SHOW_WHEN_LOW' })),
    ).toBeNull();
  });

  it('shows low stock when set to show-when-low', () => {
    const low = availability({
      aggregated: {
        availableToSell: 1,
        warningLevel: 3,
        availableOnHand: 1,
        availableForBackorder: 0,
        unlimitedBackorder: false,
      },
    });

    expect(toStockDisplay(low, settings({ stockLevelDisplay: 'SHOW_WHEN_LOW' }))).toMatchObject({
      isLow: true,
    });
  });

  it('is silent with no quantity to report', () => {
    expect(toStockDisplay(availability({ aggregated: null }), settings())).toBeNull();
  });
});

describe('toOutOfStockMessage', () => {
  it('is silent while in stock', () => {
    expect(toOutOfStockMessage(availability(), settings())).toBeNull();
  });

  it('uses the merchant message when out of stock', () => {
    expect(toOutOfStockMessage(availability({ isInStock: false }), settings())).toBe('Sold out');
  });

  it('returns null when the merchant left the message blank', () => {
    // The fallback wording belongs to the UI, which has it localized — the domain
    // must not invent English copy.
    expect(
      toOutOfStockMessage(
        availability({ isInStock: false }),
        settings({ defaultOutOfStockMessage: null }),
      ),
    ).toBeNull();
  });

  it('respects the merchant switching the message off', () => {
    expect(
      toOutOfStockMessage(
        availability({ isInStock: false }),
        settings({ showOutOfStockMessage: false }),
      ),
    ).toBeNull();
  });
});

describe('toBackorderDisplay', () => {
  const backorderable = (onHand: number, forBackorder: number, unlimited = false) =>
    availability({
      aggregated: {
        availableToSell: onHand + forBackorder,
        warningLevel: 0,
        availableOnHand: onHand,
        availableForBackorder: forBackorder,
        unlimitedBackorder: unlimited,
      },
    });

  it('is silent when nothing is backorderable', () => {
    expect(toBackorderDisplay(backorderable(5, 0), settings(), 1)).toBeNull();
  });

  it('splits the requested quantity across on-hand and backorder', () => {
    // 3 requested with 2 on hand means 2 ship now, 1 is backordered — the split
    // moves with quantity, which is why this recomputes rather than caching.
    expect(toBackorderDisplay(backorderable(2, 10), settings(), 3)).toMatchObject({
      quantityOnBackorder: 1,
      exceedsAvailable: false,
    });
  });

  it('reports nothing backordered while within on-hand stock', () => {
    expect(toBackorderDisplay(backorderable(5, 10), settings(), 3)?.quantityOnBackorder).toBeNull();
  });

  it('flags a request beyond on-hand plus backorderable', () => {
    expect(toBackorderDisplay(backorderable(2, 3), settings(), 10)).toMatchObject({
      exceedsAvailable: true,
    });
  });

  it('can never exceed an unlimited backorder', () => {
    expect(toBackorderDisplay(backorderable(1, 0, true), settings(), 9999)).toMatchObject({
      exceedsAvailable: false,
    });
  });

  it('honors each display toggle independently', () => {
    const result = toBackorderDisplay(
      backorderable(0, 10),
      settings({ showBackorderAvailabilityPrompt: false, showQuantityOnBackorder: false }),
      2,
    );

    expect(result).toMatchObject({ prompt: null, quantityOnBackorder: null });
  });

  it('is silent when out of stock entirely', () => {
    expect(
      toBackorderDisplay(availability({ isInStock: false }), settings(), 1),
    ).toBeNull();
  });
});

describe('toSchemaAvailability', () => {
  it.each([
    ['in stock', availability(), 'https://schema.org/InStock'],
    ['out of stock', availability({ isInStock: false }), 'https://schema.org/OutOfStock'],
    ['preorder', availability({ status: 'Preorder' }), 'https://schema.org/PreOrder'],
    ['unavailable', availability({ status: 'Unavailable' }), 'https://schema.org/Discontinued'],
  ])('maps %s', (_label, input, expected) => {
    expect(toSchemaAvailability(input)).toBe(expected);
  });
});
