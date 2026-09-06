'use server';

import { getInventorySettings, getProductAvailability } from '~/data/inventory';
import { getProductPrice, toOptionValueIds } from '~/data/pricing';
import type { InventorySettings, ProductAvailability } from '~/domain/availability';
import type { Price } from '~/domain/price';

/**
 * Resolves price and stock for a variant selection.
 *
 * Called by the purchase form on change. Every read behind it is the *same*
 * cached function the server used to render the default variant, so a shopper
 * cycling through options warms entries that every other shopper then hits —
 * and a re-selection of something already viewed resolves from cache in
 * milliseconds without touching BigCommerce.
 *
 * This exists so variant selection never becomes a server navigation. Reading
 * `searchParams` on the server would make the entire PDP dynamic for every
 * visitor, including the overwhelming majority who never touch an option
 * (plan §4.3).
 *
 * **The snapshot carries raw availability rather than derived display state.**
 * The derivations in `domain/availability.ts` are pure, and one of them —
 * `toBackorderDisplay` — depends on the requested quantity. Returning `stock`
 * and `backorder` already computed would mean a server round trip every time the
 * shopper touched the quantity stepper, to recompute something that needs no
 * data the client doesn't already hold. Handing back the inputs instead makes
 * quantity changes instant and costs a few hundred bytes.
 */

export interface VariantSnapshot {
  price: Price | undefined;
  availability: ProductAvailability | null;
  inventory: InventorySettings;
}

export async function getVariantSnapshot(
  productId: number,
  selection: Record<string, string>,
): Promise<VariantSnapshot> {
  const optionValueIds = toOptionValueIds(selection);

  const [price, availability, inventory] = await Promise.all([
    getProductPrice(productId, optionValueIds),
    getProductAvailability(productId, optionValueIds),
    getInventorySettings(),
  ]);

  return { price, availability, inventory };
}
