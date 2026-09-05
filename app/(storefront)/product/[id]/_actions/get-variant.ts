'use server';

import {
  toBackorderDisplay,
  toCtaState,
  toOutOfStockMessage,
  toStockDisplay,
} from '~/domain/availability';
import type { Price } from '~/domain/price';
import { getInventorySettings, getProductAvailability } from '~/data/inventory';
import { getProductPrice, toOptionValueIds } from '~/data/pricing';

/**
 * Resolves price and stock for a variant selection.
 *
 * Called by the variant selector on change. Every read behind it is the *same*
 * cached function the server used to render the default variant, so a shopper
 * cycling through options warms entries that every other shopper then hits —
 * and a re-selection of something already viewed resolves from cache in
 * milliseconds without touching BigCommerce.
 *
 * This exists so variant selection never becomes a server navigation. Reading
 * `searchParams` on the server would make the entire PDP dynamic for every
 * visitor, including the overwhelming majority who never touch an option
 * (plan §4.3).
 */

export interface VariantSnapshot {
  price: Price | undefined;
  cta: ReturnType<typeof toCtaState> | null;
  stock: ReturnType<typeof toStockDisplay>;
  backorder: ReturnType<typeof toBackorderDisplay>;
  outOfStockMessage: string | null;
}

export async function getVariantSnapshot(
  productId: number,
  selection: Record<string, string>,
  quantity = 1,
): Promise<VariantSnapshot> {
  const optionValueIds = toOptionValueIds(selection);

  const [price, availability, settings] = await Promise.all([
    getProductPrice(productId, optionValueIds),
    getProductAvailability(productId, optionValueIds),
    getInventorySettings(),
  ]);

  if (!availability) {
    return { price, cta: null, stock: null, backorder: null, outOfStockMessage: null };
  }

  return {
    price,
    cta: toCtaState(availability),
    stock: toStockDisplay(availability, settings),
    backorder: toBackorderDisplay(availability, settings, quantity),
    outOfStockMessage: toOutOfStockMessage(availability, settings),
  };
}
