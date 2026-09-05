import { cacheLife, cacheTag } from 'next/cache';

import type { InventorySettings, ProductAvailability } from '~/domain/availability';
import { query } from '~/lib/bigcommerce';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

import type { OptionValueId } from './pricing';

/**
 * Stock and availability, keyed by product and variant selection.
 *
 * Not customer-scoped: inventory is a property of the catalog, identical for
 * every visitor. Catalyst threaded a customer token through these queries along
 * with everything else, which is why logged-in shoppers got no caching on data
 * that never varies by shopper.
 *
 * `use cache: remote` with the shortest profile in the system
 * (`inventory`: stale 60 / revalidate 30 / expire 300). `expire` sits exactly at
 * `MIN_PRERENDERABLE_EXPIRE`; `stale` is deliberately under `MIN_SHELL_STALE`,
 * which is what makes this a streamed hole rather than shell content — stock is
 * the one thing on a PDP where staleness has a real cost.
 */

const ProductInventoryQuery = graphql(`
  query ProductInventory($entityId: Int!, $optionValueIds: [OptionValueId!]) {
    site {
      product(entityId: $entityId, optionValueIds: $optionValueIds) {
        sku
        availabilityV2 {
          status
        }
        inventory {
          isInStock
          hasVariantInventory
          aggregated {
            availableToSell
            warningLevel
          }
        }
        variants(first: 1) {
          edges {
            node {
              entityId
              sku
              inventory {
                aggregated {
                  availableToSell
                  warningLevel
                  availableOnHand
                  availableForBackorder
                  unlimitedBackorder
                }
                byLocation(first: 1) {
                  edges {
                    node {
                      backorderMessage
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`);

const InventorySettingsQuery = graphql(`
  query InventorySettings {
    site {
      settings {
        inventory {
          stockLevelDisplay
          showOutOfStockMessage
          defaultOutOfStockMessage
          showBackorderAvailabilityPrompt
          backorderAvailabilityPrompt
          showQuantityOnBackorder
          showBackorderMessage
        }
      }
    }
  }
`);

const DEFAULT_INVENTORY_SETTINGS: InventorySettings = {
  stockLevelDisplay: 'DONT_SHOW',
  showOutOfStockMessage: false,
  defaultOutOfStockMessage: null,
  showBackorderAvailabilityPrompt: false,
  backorderAvailabilityPrompt: null,
  showQuantityOnBackorder: false,
  showBackorderMessage: false,
};

/**
 * Store-wide inventory display settings. Separate from `getStoreSettings` and
 * from the per-product read because it is one entry for the entire site — a
 * PDP costs zero extra requests for it once any page has warmed it.
 */
export async function getInventorySettings(): Promise<InventorySettings> {
  'use cache';
  cacheLife('settings');
  cacheTag(tags.settings, tags.inventory);

  const data = await query({ document: InventorySettingsQuery });
  const settings = data.site.settings?.inventory;

  if (!settings) {
    return DEFAULT_INVENTORY_SETTINGS;
  }

  return {
     
    stockLevelDisplay: (settings.stockLevelDisplay ??
      'DONT_SHOW') as InventorySettings['stockLevelDisplay'],
    showOutOfStockMessage: settings.showOutOfStockMessage ?? false,
    defaultOutOfStockMessage: settings.defaultOutOfStockMessage ?? null,
    showBackorderAvailabilityPrompt: settings.showBackorderAvailabilityPrompt ?? false,
    backorderAvailabilityPrompt: settings.backorderAvailabilityPrompt ?? null,
    showQuantityOnBackorder: settings.showQuantityOnBackorder ?? false,
    showBackorderMessage: settings.showBackorderMessage ?? false,
  };
}

export async function getProductAvailability(
  entityId: number,
  optionValueIds: readonly OptionValueId[] = [],
): Promise<ProductAvailability | null> {
  'use cache: remote';
  cacheLife('inventory');
  cacheTag(tags.productInventory(entityId), tags.product(entityId), tags.inventory);

  const data = await query({
    document: ProductInventoryQuery,
    variables: {
      entityId,
      optionValueIds: [...optionValueIds].sort(
        (a, b) => a.optionEntityId - b.optionEntityId || a.valueEntityId - b.valueEntityId,
      ),
    },
  });

  const product = data.site.product;

  if (!product) {
    return null;
  }

  // When variant-level inventory is enabled the aggregate is meaningless, so the
  // resolved variant's own numbers are used — and only the variant carries the
  // on-hand/backorder split the backorder rules need.
  const variant = removeEdgesAndNodes(product.variants).at(0);
  const variantAggregate = variant?.inventory?.aggregated;

  return {
     
    status: product.availabilityV2.status as ProductAvailability['status'],
    isInStock: product.inventory.isInStock,
    hasVariantInventory: product.inventory.hasVariantInventory,
    aggregated: variantAggregate
      ? {
          availableToSell: variantAggregate.availableToSell,
          warningLevel: variantAggregate.warningLevel,
          availableOnHand: variantAggregate.availableOnHand,
          availableForBackorder: variantAggregate.availableForBackorder,
          unlimitedBackorder: variantAggregate.unlimitedBackorder,
        }
      : product.inventory.aggregated
        ? {
            availableToSell: product.inventory.aggregated.availableToSell,
            warningLevel: product.inventory.aggregated.warningLevel,
            availableOnHand: null,
            availableForBackorder: null,
            unlimitedBackorder: false,
          }
        : null,
    backorderMessage:
      removeEdgesAndNodes(variant?.inventory?.byLocation ?? { edges: [] }).at(0)
        ?.backorderMessage ?? null,
  };
}
