import type { ResultOf } from 'gql.tada';

import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import type { ProductCardFragment } from '~/lib/bigcommerce/fragments/product-card';

import { type Price, type TaxDisplay, toPrice } from './price';

/**
 * Product card domain model. Ported from
 * `core/data-transformers/product-card-transformer.ts`.
 *
 * Like `domain/price.ts`, this is a pure function with no I/O and no formatting,
 * so it is safe to call from inside a `'use cache'` body and testable without a
 * request context.
 */

export interface ProductCard {
  id: string;
  title: string;
  href: string;
  image?: { src: string; alt: string };
  brand?: string;
  price?: Price;
  rating: number;
  numberOfReviews: number;
  /** Out-of-stock or backorder copy, already resolved against store settings. */
  inventoryMessage?: string;
}

export interface InventoryDisplaySettings {
  defaultOutOfStockMessage?: string | null;
  showOutOfStockMessage?: boolean | null;
  showBackorderMessage?: boolean | null;
}

type Product = ResultOf<typeof ProductCardFragment>;

/**
 * Resolves the stock line shown on a card. The ordering here is BigCommerce's
 * display logic, not ours — each early return corresponds to a merchant setting
 * or an inventory shape where no message should appear.
 */
function getInventoryMessage(
  product: Product,
  settings: InventoryDisplaySettings,
): string | undefined {
  if (!product.inventory.isInStock) {
    return settings.showOutOfStockMessage
      ? (settings.defaultOutOfStockMessage ?? undefined)
      : undefined;
  }

  // Variant-level inventory can't be summarized from the aggregate, so the card
  // stays silent and the PDP resolves it per variant.
  if (!settings.showBackorderMessage || product.inventory.hasVariantInventory) {
    return undefined;
  }

  const { availableForBackorder, unlimitedBackorder, availableOnHand } =
    product.inventory.aggregated ?? {};

  // Stock on hand means it ships now; backorder copy would be misleading.
  if (availableOnHand) {
    return undefined;
  }

  if (!availableForBackorder && !unlimitedBackorder) {
    return undefined;
  }

  const baseVariant = removeEdgesAndNodes(product.variants).at(0);

  if (!baseVariant?.inventory?.byLocation) {
    return undefined;
  }

  return removeEdgesAndNodes(baseVariant.inventory.byLocation).at(0)?.backorderMessage ?? undefined;
}

export function toProductCard(
  product: Product,
  options: { taxDisplay?: TaxDisplay | null; inventory?: InventoryDisplaySettings } = {},
): ProductCard {
  return {
    id: product.entityId.toString(),
    title: product.name,
    href: product.path,
    image: product.defaultImage
      ? { src: product.defaultImage.url, alt: product.defaultImage.altText }
      : undefined,
    brand: product.brand?.name ?? undefined,
    price: toPrice(product, options.taxDisplay),
    rating: product.reviewSummary.averageRating,
    numberOfReviews: product.reviewSummary.numberOfReviews,
    inventoryMessage: options.inventory
      ? getInventoryMessage(product, options.inventory)
      : undefined,
  };
}
