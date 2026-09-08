import { z } from 'zod';

/**
 * The storefront's analytics event vocabulary, and the validation applied to
 * anything arriving at `/api/events`.
 *
 * Two reasons this is a closed schema rather than a pass-through:
 *
 *  1. **The beacon endpoint is public.** Anything on the internet can POST to it.
 *     Forwarding arbitrary JSON to BigCommerce or Google Analytics makes this
 *     storefront an open relay for polluting the merchant's own reporting.
 *  2. **Events must not carry personal data.** A product id and a currency code
 *     are fine; an email address is not. Listing the fields explicitly means a
 *     future event has to think about it rather than spreading a whole object in.
 *
 * Unknown keys are stripped by Zod's default object behaviour, so an attacker
 * cannot smuggle extra fields through a known event name either.
 */

const money = z.object({
  value: z.number().finite(),
  currencyCode: z.string().length(3),
});

const lineItem = z.object({
  productId: z.number().int().positive(),
  productName: z.string().max(300),
  sku: z.string().max(100).optional(),
  quantity: z.number().int().positive().max(10_000),
  price: money.optional(),
});

/*
 * Discriminated on `type` so each event validates only its own payload — a
 * single loose "properties" bag would defeat the point of validating at all.
 */
export const AnalyticsEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('product_viewed'),
    productId: z.number().int().positive(),
    productName: z.string().max(300),
    price: money.optional(),
  }),
  z.object({
    type: z.literal('category_viewed'),
    categoryId: z.number().int().positive(),
    categoryName: z.string().max(300),
  }),
  z.object({
    type: z.literal('product_added_to_cart'),
    cartId: z.string().max(100).optional(),
    lineItem,
  }),
  z.object({
    type: z.literal('product_removed_from_cart'),
    cartId: z.string().max(100).optional(),
    lineItem,
  }),
  z.object({
    type: z.literal('cart_viewed'),
    cartId: z.string().max(100).optional(),
    total: money.optional(),
    lineItems: z.array(lineItem).max(200).default([]),
  }),
]);

export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

/**
 * The envelope the browser POSTs. `consent` travels with the event because the
 * server cannot read the consent cookie in a way that would be trustworthy here
 * anyway — and more practically, the beacon is fire-and-forget and must not
 * depend on cookie propagation timing.
 *
 * The server still re-checks the merchant's `cookieConsentEnabled` setting, so a
 * client claiming consent it was never granted cannot unlock anything: a
 * client-supplied `true` is only ever permission to send *less*, never more.
 */
export const BeaconSchema = z.object({
  events: z.array(AnalyticsEventSchema).min(1).max(20),
  consent: z
    .object({
      functionality: z.boolean(),
      marketing: z.boolean(),
      measurement: z.boolean(),
    })
    .optional(),
});

export type Beacon = z.infer<typeof BeaconSchema>;

/**
 * Which consent category each event needs.
 *
 * Cart and product events are *measurement* — they describe how the store is
 * used. None of them are strictly necessary, so with consent enabled and no
 * choice recorded, nothing is sent.
 */
export function requiredCategory(event: AnalyticsEvent): 'measurement' | 'marketing' {
  switch (event.type) {
    case 'product_viewed':
    case 'category_viewed':
    case 'cart_viewed':
    case 'product_added_to_cart':
    case 'product_removed_from_cart':
      return 'measurement';
  }
}
