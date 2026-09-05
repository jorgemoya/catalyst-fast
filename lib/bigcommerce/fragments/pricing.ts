import { graphql } from '../graphql';

/**
 * BigCommerce resolves `prices(...)` against the identity of the requester, so
 * this fragment is only ever used from a PUBLIC (untokened) query — it returns
 * default-customer-group pricing, which is what the prerendered shell shows.
 * Personalized pricing is a separate, never-server-cached read (Phase 6).
 *
 * Both tax variants are fetched together because the store's tax display setting
 * can be BOTH, and because fetching them separately would double the round trips
 * for a value that is always rendered as a unit.
 */
export const PricingFragment = graphql(`
  fragment PricingFragment on Product {
    pricesIncludingTax: prices(currencyCode: $currencyCode, includeTax: true) {
      price {
        value
        currencyCode
      }
      basePrice {
        value
        currencyCode
      }
      retailPrice {
        value
        currencyCode
      }
      salePrice {
        value
        currencyCode
      }
      priceRange {
        min {
          value
          currencyCode
        }
        max {
          value
          currencyCode
        }
      }
    }
    pricesExcludingTax: prices(currencyCode: $currencyCode, includeTax: false) {
      price {
        value
        currencyCode
      }
      basePrice {
        value
        currencyCode
      }
      retailPrice {
        value
        currencyCode
      }
      salePrice {
        value
        currencyCode
      }
      priceRange {
        min {
          value
          currencyCode
        }
        max {
          value
          currencyCode
        }
      }
    }
  }
`);
