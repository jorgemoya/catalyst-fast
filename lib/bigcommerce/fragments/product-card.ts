import { graphql } from '../graphql';

import { PricingFragment } from './pricing';

/**
 * Everything a product card renders, including price, in ONE selection.
 *
 * This is deliberate and is the guardrail against the failure mode the plan calls
 * out: a grid of N cards must never become N price fetches. Listing queries
 * return pricing inline, so a 50-product page is one BigCommerce request, not 51.
 */
export const ProductCardFragment = graphql(
  `
    fragment ProductCardFragment on Product {
      entityId
      name
      path
      defaultImage {
        altText
        url: urlTemplate(lossy: true)
      }
      brand {
        name
        path
      }
      inventory {
        hasVariantInventory
        isInStock
        aggregated {
          availableForBackorder
          unlimitedBackorder
          availableOnHand
        }
      }
      reviewSummary {
        numberOfReviews
        averageRating
      }
      variants(first: 1) {
        edges {
          node {
            entityId
            sku
            inventory {
              byLocation {
                edges {
                  node {
                    locationEntityId
                    backorderMessage
                  }
                }
              }
            }
          }
        }
      }
      ...PricingFragment
    }
  `,
  [PricingFragment],
);
