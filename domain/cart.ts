import type { ResultOf } from 'gql.tada';

import type {
  DigitalItemFragment,
  GiftCertificateItemFragment,
  PhysicalItemFragment,
} from '~/lib/bigcommerce/fragments/cart';

import type { CartSelectedOptionsInput } from './cart-line';

/**
 * Cart domain model.
 *
 * Two rules carried over from `domain/price.ts`, both of which exist because
 * everything here is produced inside a cached read:
 *
 *  - **Numbers and codes, never formatted strings.** Formatting is
 *    locale-dependent; baking it in would key every cache entry to a locale for
 *    data that doesn't vary by one.
 *  - **Semantics, never copy.** A line reports that 2 of 5 units are
 *    backordered; the UI decides how to say it.
 *
 * Physical, digital, and gift-certificate items arrive as three separate
 * GraphQL types and leave as one discriminated union, so the cart page maps a
 * single list instead of concatenating three.
 */

export interface CartMoney {
  value: number;
  currencyCode: string;
}

/**
 * A shopper's option choices as BigCommerce recorded them on the line.
 *
 * Discriminated rather than pre-stringified so the date case stays an ISO
 * instant: `formatDate` is locale-bound and would otherwise run inside the cache.
 */
export type CartLineOption =
  | { id: string; label: string; kind: 'text'; value: string }
  | { id: string; label: string; kind: 'number'; value: number }
  | { id: string; label: string; kind: 'date'; iso: string };

/**
 * Present only when there is something worth saying — a line whose units are all
 * on hand reports `null` rather than a row of zeroes the UI has to filter.
 */
export interface CartLineStock {
  readyToShip: number;
  backordered: number;
  outOfStock: number;
  /** Merchant-configured, location-specific shipping expectation. */
  backorderMessage: string | null;
}

export interface CartLine {
  id: string;
  kind: 'physical' | 'digital';
  productId: number;
  variantId: number | null;
  name: string;
  brand: string | null;
  sku: string | null;
  href: string;
  image: { src: string; alt: string } | null;
  quantity: number;
  /**
   * False for items a promotion added automatically. Those cannot be edited or
   * removed, and offering the controls anyway produces a silent no-op.
   */
  isMutable: boolean;
  options: CartLineOption[];
  /**
   * The same choices in the form BigCommerce needs handed back on an update.
   * Carried alongside the display form because `updateCartLineItem` replaces the
   * line rather than patching it — a quantity change that omits this wipes the
   * shopper's options.
   */
  optionsInput: CartSelectedOptionsInput;
  unitPrice: CartMoney;
  /** Set only when the line is discounted, for the struck-through original. */
  unitListPrice: CartMoney | null;
  lineTotal: CartMoney;
  stock: CartLineStock | null;
}

export interface CartGiftCertificateLine {
  id: string;
  kind: 'giftCertificate';
  name: string;
  theme: string;
  message: string | null;
  amount: CartMoney;
  sender: { name: string; email: string };
  recipient: { name: string; email: string };
}

export type CartItem = CartLine | CartGiftCertificateLine;

export interface CartSummary {
  subtotal: CartMoney | null;
  /** Cart-level and line-level discounts combined. Coupons are listed separately. */
  discount: CartMoney | null;
  coupons: Array<{ code: string; discount: CartMoney }>;
  giftCertificates: Array<{ code: string; used: CartMoney; balance: CartMoney }>;
  tax: CartMoney | null;
  grandTotal: CartMoney | null;
  /**
   * When true the displayed prices already contain tax, and the UI says so —
   * otherwise a shopper in a tax-inclusive market reads the subtotal as the
   * pre-tax figure it isn't.
   */
  isTaxIncluded: boolean;
}

export interface Cart {
  id: string;
  currencyCode: string;
  totalQuantity: number;
  items: CartItem[];
  summary: CartSummary;
}

type PhysicalItem = ResultOf<typeof PhysicalItemFragment>;
type DigitalItem = ResultOf<typeof DigitalItemFragment>;
type GiftCertificateItem = ResultOf<typeof GiftCertificateItemFragment>;
type SelectedOption = PhysicalItem['selectedOptions'][number];

const toMoney = (money: { value: number; currencyCode: string }): CartMoney => ({
  value: money.value,
  currencyCode: money.currencyCode,
});

/**
 * Maps BigCommerce's six selected-option types onto three renderable kinds.
 *
 * Multiple-choice and checkbox both resolve to a human-readable `value` string
 * server-side, so they collapse into `text` — the distinction between a swatch
 * and a dropdown mattered on the PDP and means nothing on a cart line.
 */
export function toCartLineOption(option: SelectedOption): CartLineOption | null {
  const base = { id: String(option.entityId), label: option.name };

  switch (option.__typename) {
    case 'CartSelectedMultipleChoiceOption':
    case 'CartSelectedCheckboxOption':
      return { ...base, kind: 'text', value: String(option.value) };

    case 'CartSelectedTextFieldOption':
    case 'CartSelectedMultiLineTextFieldOption':
      return { ...base, kind: 'text', value: option.text };

    case 'CartSelectedNumberFieldOption':
      return { ...base, kind: 'number', value: option.number };

    case 'CartSelectedDateFieldOption':
      return { ...base, kind: 'date', iso: String(option.date.utc) };

    default:
      // An option type BigCommerce adds later must not take the cart down.
      return null;
  }
}

/**
 * Rebuilds BigCommerce's input shape from what it gave us back.
 *
 * The mirror image of `toSelectedOptionsInput` in `domain/cart-line.ts`: that one
 * builds this from a PDP form, this one from an existing line. Both exist because
 * the API's read and write shapes for the same data differ.
 */
export function toLineOptionsInput(options: SelectedOption[]): CartSelectedOptionsInput {
  const input: Required<CartSelectedOptionsInput> = {
    multipleChoices: [],
    checkboxes: [],
    numberFields: [],
    textFields: [],
    multiLineTextFields: [],
    dateFields: [],
  };

  for (const option of options) {
    const optionEntityId = Number(option.entityId);

    switch (option.__typename) {
      case 'CartSelectedMultipleChoiceOption':
        input.multipleChoices.push({
          optionEntityId,
          optionValueEntityId: Number(option.valueEntityId),
        });
        break;

      case 'CartSelectedCheckboxOption':
        input.checkboxes.push({
          optionEntityId,
          optionValueEntityId: Number(option.valueEntityId),
        });
        break;

      case 'CartSelectedNumberFieldOption':
        input.numberFields.push({ optionEntityId, number: option.number });
        break;

      case 'CartSelectedTextFieldOption':
        input.textFields.push({ optionEntityId, text: option.text });
        break;

      case 'CartSelectedMultiLineTextFieldOption':
        input.multiLineTextFields.push({ optionEntityId, text: option.text });
        break;

      case 'CartSelectedDateFieldOption':
        input.dateFields.push({ optionEntityId, date: String(option.date.utc) });
        break;

      default:
        break;
    }
  }

  return Object.fromEntries(
    Object.entries(input).filter(([, list]) => list.length > 0),
  ) as CartSelectedOptionsInput;
}

function toStock(
  stockPosition: PhysicalItem['stockPosition'],
): CartLineStock | null {
  if (!stockPosition) {
    return null;
  }

  const { quantityOnHand, quantityBackordered, quantityOutOfStock, backorderMessage } =
    stockPosition;

  // A fully in-stock line has nothing to report. Returning zeroes would push the
  // "is any of this interesting?" test into every consumer.
  if (quantityBackordered === 0 && quantityOutOfStock === 0) {
    return null;
  }

  return {
    readyToShip: quantityOnHand,
    backordered: quantityBackordered,
    outOfStock: quantityOutOfStock,
    backorderMessage: backorderMessage ?? null,
  };
}

function toLine(item: PhysicalItem | DigitalItem): CartLine {
  const listPrice = toMoney(item.listPrice);
  const unitPrice = toMoney(item.salePrice);

  return {
    id: item.entityId,
    kind: item.__typename === 'CartPhysicalItem' ? 'physical' : 'digital',
    productId: item.productEntityId,
    variantId: item.variantEntityId ?? null,
    name: item.name,
    brand: item.brand ?? null,
    sku: item.sku || null,
    href: item.path,
    image: item.image ? { src: item.image.url, alt: item.name } : null,
    quantity: item.quantity,
    isMutable: item.isMutable,
    options: item.selectedOptions
      .map(toCartLineOption)
      .filter((option): option is CartLineOption => option !== null),
    optionsInput: toLineOptionsInput(item.selectedOptions),
    unitPrice,
    // Struck through only when it would actually differ. Showing an identical
    // "original" price next to the current one reads as a broken discount.
    unitListPrice: listPrice.value > unitPrice.value ? listPrice : null,
    lineTotal: toMoney(item.extendedSalePrice),
    stock: 'stockPosition' in item ? toStock(item.stockPosition) : null,
  };
}

function toGiftCertificateLine(item: GiftCertificateItem): CartGiftCertificateLine {
  return {
    id: item.entityId,
    kind: 'giftCertificate',
    name: item.name,
    theme: String(item.theme),
    message: item.message || null,
    amount: toMoney(item.amount),
    sender: item.sender,
    recipient: item.recipient,
  };
}

interface CartSource {
  entityId: string;
  currencyCode: string;
  isTaxIncluded: boolean;
  discountedAmount: { value: number; currencyCode: string };
  lineItems: {
    totalQuantity: number;
    physicalItems: PhysicalItem[];
    digitalItems: DigitalItem[];
    giftCertificates: GiftCertificateItem[];
  };
}

interface CheckoutSource {
  subtotal: { value: number; currencyCode: string } | null;
  taxTotal: { value: number; currencyCode: string } | null;
  grandTotal: { value: number; currencyCode: string } | null;
  coupons: Array<{ code: string; discountedAmount: { value: number; currencyCode: string } }>;
  giftCertificates: Array<{
    code: string;
    used: { value: number; currencyCode: string };
    balance: { value: number; currencyCode: string };
  }>;
}

/**
 * `cart` and `checkout` are two views of the same thing: the cart holds the line
 * items, the checkout holds the money that depends on coupons and tax. They are
 * fetched together and merged here so no consumer has to know that.
 *
 * `checkout` is nullable because BigCommerce only materializes one once the cart
 * exists and is costable; an empty or just-created cart can legitimately have
 * none, in which case the summary degrades to the cart's own totals rather than
 * throwing.
 */
export function toCart(cart: CartSource, checkout: CheckoutSource | null): Cart {
  const items: CartItem[] = [
    ...cart.lineItems.physicalItems.map(toLine),
    ...cart.lineItems.digitalItems.map(toLine),
    ...cart.lineItems.giftCertificates.map(toGiftCertificateLine),
  ];

  const discount = cart.discountedAmount.value > 0 ? toMoney(cart.discountedAmount) : null;

  return {
    id: cart.entityId,
    currencyCode: cart.currencyCode,
    totalQuantity: cart.lineItems.totalQuantity,
    items,
    summary: {
      subtotal: checkout?.subtotal ? toMoney(checkout.subtotal) : null,
      discount,
      coupons: (checkout?.coupons ?? []).map((coupon) => ({
        code: coupon.code,
        discount: toMoney(coupon.discountedAmount),
      })),
      giftCertificates: (checkout?.giftCertificates ?? []).map((certificate) => ({
        code: certificate.code,
        used: toMoney(certificate.used),
        balance: toMoney(certificate.balance),
      })),
      tax: checkout?.taxTotal ? toMoney(checkout.taxTotal) : null,
      grandTotal: checkout?.grandTotal ? toMoney(checkout.grandTotal) : null,
      isTaxIncluded: cart.isTaxIncluded,
    },
  };
}
