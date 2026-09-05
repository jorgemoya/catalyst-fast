/**
 * Stock, availability, and backorder rules.
 *
 * Extracted from the ~180 lines that sit inline in Catalyst's PDP `page.tsx`,
 * spread across several `Streamable` closures. As pure functions they are
 * testable without a request, a store, or a render — which matters because the
 * branching here is genuinely intricate and gets a shopper's expectations about
 * delivery wrong when it's off.
 */

export type AvailabilityStatus = 'Available' | 'Preorder' | 'Unavailable';

/** How much stock detail the merchant wants shown. */
export type StockLevelDisplay = 'DONT_SHOW' | 'SHOW_WHEN_LOW' | 'SHOW_ALWAYS';

export interface InventorySettings {
  stockLevelDisplay: StockLevelDisplay;
  showOutOfStockMessage: boolean;
  defaultOutOfStockMessage: string | null;
  showBackorderAvailabilityPrompt: boolean;
  backorderAvailabilityPrompt: string | null;
  showQuantityOnBackorder: boolean;
  showBackorderMessage: boolean;
}

export interface AggregatedInventory {
  availableToSell: number | null;
  warningLevel: number | null;
  availableOnHand: number | null;
  availableForBackorder: number | null;
  unlimitedBackorder: boolean;
}

export interface ProductAvailability {
  status: AvailabilityStatus;
  isInStock: boolean;
  hasVariantInventory: boolean;
  aggregated: AggregatedInventory | null;
  /** Location-specific copy, e.g. "Ships from our Portland warehouse in 3 weeks". */
  backorderMessage: string | null;
}

/* ── Call-to-action state ─────────────────────────────────────────────────── */

/**
 * Semantics, not copy. The domain returns a `kind` and the UI maps it to a
 * label — otherwise this layer would be producing user-facing English, which
 * makes it untranslatable and couples business rules to presentation.
 */
export type CtaState =
  | { kind: 'available'; disabled: false }
  | { kind: 'preorder'; disabled: false }
  | { kind: 'out-of-stock'; disabled: true }
  | { kind: 'unavailable'; disabled: true };

/**
 * Note preorder is *enabled* — that is the whole point of a preorder — while
 * `Unavailable` and out-of-stock are not. BigCommerce models "unavailable"
 * (never purchasable) separately from "out of stock" (temporarily unavailable),
 * and conflating them would hide a restock from an interested shopper.
 */
export function toCtaState(availability: ProductAvailability): CtaState {
  if (availability.status === 'Unavailable') {
    return { kind: 'unavailable', disabled: true };
  }

  if (availability.status === 'Preorder') {
    return { kind: 'preorder', disabled: false };
  }

  if (!availability.isInStock) {
    return { kind: 'out-of-stock', disabled: true };
  }

  return { kind: 'available', disabled: false };
}

/* ── Stock level ──────────────────────────────────────────────────────────── */

export interface StockDisplay {
  /** How many are available to sell. The UI phrases it. */
  available: number;
  /** At or below the merchant's warning level. */
  isLow: boolean;
}

export function toStockDisplay(
  availability: ProductAvailability,
  settings: InventorySettings,
): StockDisplay | null {
  if (settings.stockLevelDisplay === 'DONT_SHOW') {
    return null;
  }

  // Variant-level inventory can't be summarized from the aggregate; the caller
  // resolves the selected variant and passes its inventory instead.
  const available = availability.aggregated?.availableToSell;

  if (available == null || available <= 0) {
    return null;
  }

  const warningLevel = availability.aggregated?.warningLevel ?? 0;
  const isLow = warningLevel > 0 && available <= warningLevel;

  if (settings.stockLevelDisplay === 'SHOW_WHEN_LOW' && !isLow) {
    return null;
  }

  return { available, isLow };
}

/**
 * The merchant's configured out-of-stock message, or null when it shouldn't
 * show. Returns `null` rather than a default string when the merchant left it
 * blank — the fallback wording is the UI's to choose, and its own copy is
 * already localized.
 */
export function toOutOfStockMessage(
  availability: ProductAvailability,
  settings: InventorySettings,
): string | null {
  if (availability.isInStock || !settings.showOutOfStockMessage) {
    return null;
  }

  return settings.defaultOutOfStockMessage || null;
}

/* ── Backorder ────────────────────────────────────────────────────────────── */

export interface BackorderDisplay {
  /** Shown regardless of quantity, when the merchant enables the prompt. */
  prompt: string | null;
  /** How many of the requested quantity would be backordered. */
  quantityOnBackorder: number | null;
  /** Location-specific shipping expectation. */
  message: string | null;
  /** Requested quantity exceeds on-hand plus backorderable — a hard error. */
  exceedsAvailable: boolean;
}

/**
 * Backorder state for a requested quantity.
 *
 * Recomputed as the shopper changes quantity, because the split between
 * "ships now" and "backordered" moves with it: 3 units when 2 are on hand means
 * 2 ship now and 1 is backordered.
 */
export function toBackorderDisplay(
  availability: ProductAvailability,
  settings: InventorySettings,
  requestedQuantity: number,
): BackorderDisplay | null {
  const aggregated = availability.aggregated;

  if (!aggregated || !availability.isInStock) {
    return null;
  }

  const onHand = aggregated.availableOnHand ?? 0;
  const forBackorder = aggregated.availableForBackorder ?? 0;
  const unlimited = aggregated.unlimitedBackorder;

  if (!unlimited && forBackorder <= 0) {
    return null;
  }

  const beyondOnHand = Math.max(0, requestedQuantity - onHand);

  // Unlimited backorder can never be exceeded, so the check only applies when a
  // finite backorder pool is configured.
  const exceedsAvailable = !unlimited && beyondOnHand > forBackorder;

  return {
    prompt: settings.showBackorderAvailabilityPrompt
      ? (settings.backorderAvailabilityPrompt ?? null)
      : null,
    quantityOnBackorder:
      settings.showQuantityOnBackorder && beyondOnHand > 0 ? beyondOnHand : null,
    message: settings.showBackorderMessage ? availability.backorderMessage : null,
    exceedsAvailable,
  };
}

/** schema.org availability, for the Product JSON-LD. */
export function toSchemaAvailability(availability: ProductAvailability): string {
  if (availability.status === 'Preorder') {
    return 'https://schema.org/PreOrder';
  }

  if (availability.status === 'Unavailable') {
    return 'https://schema.org/Discontinued';
  }

  return availability.isInStock
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock';
}
