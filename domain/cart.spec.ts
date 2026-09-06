import { describe, expect, it } from 'vitest';

import { toCart, toCartLineOption, toLineOptionsInput } from './cart';

/**
 * Cart transformation.
 *
 * The interesting cases are the ones a demo store never produces: a partially
 * backordered line, a discounted line, a cart whose checkout doesn't exist yet,
 * and the round trip that keeps a shopper's options attached to a line through a
 * quantity change.
 */

const money = (value: number) => ({ value, currencyCode: 'USD' });

/* eslint-disable @typescript-eslint/no-explicit-any */
const physicalItem = (overrides: Record<string, unknown> = {}): any => ({
  __typename: 'CartPhysicalItem',
  entityId: 'line-1',
  productEntityId: 77,
  variantEntityId: 88,
  name: 'Tote bag',
  brand: 'Acme',
  sku: 'TOTE-1',
  path: '/tote-bag/',
  quantity: 1,
  isMutable: true,
  image: { url: 'https://cdn/tote.jpg' },
  listPrice: money(20),
  salePrice: money(20),
  extendedSalePrice: money(20),
  selectedOptions: [],
  stockPosition: null,
  ...overrides,
});

const cartSource = (overrides: Record<string, unknown> = {}): any => ({
  entityId: 'cart-1',
  currencyCode: 'USD',
  isTaxIncluded: false,
  discountedAmount: money(0),
  lineItems: {
    totalQuantity: 1,
    physicalItems: [physicalItem()],
    digitalItems: [],
    giftCertificates: [],
    ...(overrides.lineItems as object),
  },
  ...overrides,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('toCart', () => {
  it('flattens the three item types into one ordered list', () => {
    const cart = toCart(
      cartSource({
        lineItems: {
          totalQuantity: 3,
          physicalItems: [physicalItem()],
          digitalItems: [physicalItem({ __typename: 'CartDigitalItem', entityId: 'line-2' })],
          giftCertificates: [
            {
              __typename: 'CartGiftCertificate',
              entityId: 'gc-1',
              name: '$50 Gift Certificate',
              theme: 'General',
              message: 'Enjoy',
              isTaxable: false,
              amount: money(50),
              sender: { name: 'Ana', email: 'ana@example.com' },
              recipient: { name: 'Bo', email: 'bo@example.com' },
            },
          ],
        },
      }),
      null,
    );

    expect(cart.items.map((item) => item.kind)).toEqual([
      'physical',
      'digital',
      'giftCertificate',
    ]);
  });

  it('degrades to the cart total when no checkout exists yet', () => {
    // BigCommerce only materializes a checkout once the cart is costable, so a
    // just-created cart legitimately has none. That must not throw.
    const cart = toCart(cartSource(), null);

    expect(cart.summary).toMatchObject({
      subtotal: null,
      grandTotal: null,
      coupons: [],
      giftCertificates: [],
    });
  });

  it('carries coupons and redeemed gift certificates through the summary', () => {
    const cart = toCart(cartSource(), {
      subtotal: money(20),
      taxTotal: money(2),
      grandTotal: money(17),
      coupons: [{ code: 'SAVE5', discountedAmount: money(5) }],
      giftCertificates: [{ code: 'GC-1', used: money(10), balance: money(40) }],
    });

    expect(cart.summary.coupons).toEqual([{ code: 'SAVE5', discount: money(5) }]);
    expect(cart.summary.giftCertificates).toEqual([
      { code: 'GC-1', used: money(10), balance: money(40) },
    ]);
    expect(cart.summary.grandTotal).toEqual(money(17));
  });

  it('reports a discount only when there is one', () => {
    expect(toCart(cartSource(), null).summary.discount).toBeNull();
    expect(toCart(cartSource({ discountedAmount: money(4) }), null).summary.discount).toEqual(
      money(4),
    );
  });
});

describe('line pricing', () => {
  it('strikes through the list price only when it differs', () => {
    const plain = toCart(cartSource(), null).items[0];

    expect(plain && 'unitListPrice' in plain && plain.unitListPrice).toBeNull();

    const discounted = toCart(
      cartSource({
        lineItems: {
          totalQuantity: 1,
          physicalItems: [physicalItem({ listPrice: money(30), salePrice: money(20) })],
          digitalItems: [],
          giftCertificates: [],
        },
      }),
      null,
    ).items[0];

    expect(discounted && 'unitListPrice' in discounted && discounted.unitListPrice).toEqual(
      money(30),
    );
  });
});

describe('line stock', () => {
  const withStock = (stockPosition: unknown) =>
    toCart(
      cartSource({
        lineItems: {
          totalQuantity: 1,
          physicalItems: [physicalItem({ stockPosition })],
          digitalItems: [],
          giftCertificates: [],
        },
      }),
      null,
    ).items[0];

  it('is null for a fully in-stock line', () => {
    // Returning zeroes would push "is any of this interesting?" into every caller.
    const line = withStock({
      quantityOnHand: 5,
      quantityBackordered: 0,
      quantityOutOfStock: 0,
      backorderMessage: null,
    });

    expect(line && 'stock' in line && line.stock).toBeNull();
  });

  it('reports the split when part of the line is backordered', () => {
    const line = withStock({
      quantityOnHand: 2,
      quantityBackordered: 3,
      quantityOutOfStock: 0,
      backorderMessage: 'Ships in 3 weeks',
    });

    expect(line && 'stock' in line && line.stock).toEqual({
      readyToShip: 2,
      backordered: 3,
      outOfStock: 0,
      backorderMessage: 'Ships in 3 weeks',
    });
  });

  it('is null for a digital item, which has no stock position at all', () => {
    const cart = toCart(
      cartSource({
        lineItems: {
          totalQuantity: 1,
          physicalItems: [],
          digitalItems: [
            { ...physicalItem(), __typename: 'CartDigitalItem', stockPosition: undefined },
          ],
          giftCertificates: [],
        },
      }),
      null,
    );

    expect(cart.items[0] && 'stock' in cart.items[0] && cart.items[0].stock).toBeNull();
  });
});

describe('toCartLineOption', () => {
  const option = (extra: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toCartLineOption({ entityId: 1, name: 'Size', ...extra } as any);

  it('collapses multiple-choice and checkbox into readable text', () => {
    // The swatch-vs-dropdown distinction mattered on the PDP and means nothing
    // on a cart line.
    expect(option({ __typename: 'CartSelectedMultipleChoiceOption', value: 'Large' })).toEqual({
      id: '1',
      label: 'Size',
      kind: 'text',
      value: 'Large',
    });
    expect(option({ __typename: 'CartSelectedCheckboxOption', value: 'Yes' })).toMatchObject({
      kind: 'text',
      value: 'Yes',
    });
  });

  it('keeps a date as an ISO instant rather than formatting it', () => {
    // Formatting is locale-bound and this runs inside a cached read.
    expect(
      option({ __typename: 'CartSelectedDateFieldOption', date: { utc: '2026-03-04T00:00:00Z' } }),
    ).toEqual({ id: '1', label: 'Size', kind: 'date', iso: '2026-03-04T00:00:00Z' });
  });

  it('keeps a number as a number', () => {
    expect(option({ __typename: 'CartSelectedNumberFieldOption', number: 7 })).toMatchObject({
      kind: 'number',
      value: 7,
    });
  });

  it('drops an option type it does not recognize', () => {
    // A type BigCommerce adds later must not take the cart down.
    expect(option({ __typename: 'CartSelectedFutureOption' })).toBeNull();
  });
});

describe('toLineOptionsInput', () => {
  it('rebuilds the write shape from the read shape', () => {
    // A quantity update replaces the line, so this round trip is what stops a
    // shopper's engraving disappearing when they click "+".
    expect(
      toLineOptionsInput([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { __typename: 'CartSelectedMultipleChoiceOption', entityId: 1, name: 'Size', value: 'L', valueEntityId: 20 } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { __typename: 'CartSelectedTextFieldOption', entityId: 4, name: 'Engraving', text: 'For Ana' } as any,
      ]),
    ).toEqual({
      multipleChoices: [{ optionEntityId: 1, optionValueEntityId: 20 }],
      textFields: [{ optionEntityId: 4, text: 'For Ana' }],
    });
  });

  it('returns an empty object for a line with no options', () => {
    expect(toLineOptionsInput([])).toEqual({});
  });
});
