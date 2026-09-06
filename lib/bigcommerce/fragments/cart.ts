import { graphql } from '../graphql';

/**
 * Cart line-item fragments.
 *
 * Physical and digital items are structurally near-identical but are separate
 * GraphQL types, so the selection is written once per type and unified into a
 * single `CartLine` by `domain/cart.ts`. The storefront renders them
 * differently only in what it *omits* — a digital item has no stock position and
 * no shipping — which is a rendering concern, not a data-shape one.
 *
 * Prices here are the cart's own numbers, not the catalog's. Catalyst re-derived
 * each line's price from `catalogProductWithOptionSelections`, which costs a full
 * pricing sub-query per line and answers the wrong question: a cart should show
 * what the shopper is actually being charged, which BigCommerce has already
 * locked to the line. `listPrice` is kept only to strike through when the line
 * carries a discount.
 *
 * `selectedOptions` is selected twice over, in effect: `value` is the
 * human-readable choice for display, and `valueEntityId` is the same choice in
 * the form BigCommerce needs handed back. Both are required because a quantity
 * update replaces the line wholesale — send it without the options and the
 * shopper's engraving silently disappears.
 */

const SelectedOptionsFragment = graphql(`
  fragment SelectedOptionsFragment on CartSelectedOption {
    __typename
    entityId
    name
    ... on CartSelectedMultipleChoiceOption {
      value
      valueEntityId
    }
    ... on CartSelectedCheckboxOption {
      value
      valueEntityId
    }
    ... on CartSelectedNumberFieldOption {
      number
    }
    ... on CartSelectedMultiLineTextFieldOption {
      text
    }
    ... on CartSelectedTextFieldOption {
      text
    }
    ... on CartSelectedDateFieldOption {
      date {
        utc
      }
    }
  }
`);

export const PhysicalItemFragment = graphql(
  `
    fragment PhysicalItemFragment on CartPhysicalItem {
      __typename
      entityId
      productEntityId
      variantEntityId
      name
      brand
      sku
      path
      quantity
      isMutable
      image {
        url: urlTemplate(lossy: true)
      }
      listPrice {
        value
        currencyCode
      }
      salePrice {
        value
        currencyCode
      }
      extendedSalePrice {
        value
        currencyCode
      }
      selectedOptions {
        ...SelectedOptionsFragment
      }
      stockPosition {
        quantityOnHand
        quantityBackordered
        quantityOutOfStock
        backorderMessage
      }
    }
  `,
  [SelectedOptionsFragment],
);

export const DigitalItemFragment = graphql(
  `
    fragment DigitalItemFragment on CartDigitalItem {
      __typename
      entityId
      productEntityId
      variantEntityId
      name
      brand
      sku
      path
      quantity
      isMutable
      image {
        url: urlTemplate(lossy: true)
      }
      listPrice {
        value
        currencyCode
      }
      salePrice {
        value
        currencyCode
      }
      extendedSalePrice {
        value
        currencyCode
      }
      selectedOptions {
        ...SelectedOptionsFragment
      }
    }
  `,
  [SelectedOptionsFragment],
);

/**
 * Gift certificates are not catalog products: no sku, no image, no options, no
 * stock, and no quantity. They carry sender/recipient detail instead, which is
 * the one place the cart holds personal data belonging to someone who isn't the
 * shopper — see the note on caching in `data/cart.ts`.
 */
export const GiftCertificateItemFragment = graphql(`
  fragment GiftCertificateItemFragment on CartGiftCertificate {
    __typename
    entityId
    name
    theme
    message
    isTaxable
    amount {
      value
      currencyCode
    }
    sender {
      name
      email
    }
    recipient {
      name
      email
    }
  }
`);
