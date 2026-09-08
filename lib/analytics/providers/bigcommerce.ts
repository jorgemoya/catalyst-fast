import type { AnalyticsEvent } from '~/domain/analytics';
import { env } from '~/lib/env';

import type { AnalyticsProvider } from '../types';

/**
 * BigCommerce first-party analytics (the Data Events API).
 *
 * Feeds the merchant's own BigCommerce reporting — Analytics in the control
 * panel, abandoned-cart flows, and the segments other BigCommerce features
 * depend on. Worth keeping even for a merchant who also runs GA, because these
 * are the numbers their storefront platform shows them.
 *
 * Enabled by the presence of `BIGCOMMERCE_DATA_EVENTS_TOKEN`; without it this
 * provider is inert, which is the right default for a template.
 */
const DATA_EVENTS_ENDPOINT = 'https://api.bigcommerce.com/data-events/events';

const toDataEvent = (event: AnalyticsEvent): Record<string, unknown> | null => {
  switch (event.type) {
    case 'product_viewed':
      return {
        event_type: 'product_viewed',
        product: { id: event.productId, name: event.productName },
      };

    case 'product_added_to_cart':
      return {
        event_type: 'cart_item_added',
        cart_id: event.cartId,
        line_item: {
          product_id: event.lineItem.productId,
          quantity: event.lineItem.quantity,
        },
      };

    case 'product_removed_from_cart':
      return {
        event_type: 'cart_item_removed',
        cart_id: event.cartId,
        line_item: {
          product_id: event.lineItem.productId,
          quantity: event.lineItem.quantity,
        },
      };

    case 'cart_viewed':
      return { event_type: 'cart_viewed', cart_id: event.cartId };

    /*
     * BigCommerce's Data Events API has no category-view event. Returning null
     * drops it here rather than inventing a mapping — a wrong event in a
     * merchant's own platform reporting is worse than a missing one, because it
     * is indistinguishable from real data.
     */
    case 'category_viewed':
      return null;
  }
};

export const bigcommerceProvider: AnalyticsProvider = {
  name: 'bigcommerce',

  enabled: () => Boolean(process.env.BIGCOMMERCE_DATA_EVENTS_TOKEN),

  async send(events) {
    const payload = events.map(toDataEvent).filter(Boolean);

    if (payload.length === 0) {
      return;
    }

    const response = await fetch(DATA_EVENTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': process.env.BIGCOMMERCE_DATA_EVENTS_TOKEN ?? '',
        'X-Store-Hash': env.BIGCOMMERCE_STORE_HASH,
      },
      body: JSON.stringify({ events: payload }),
    });

    if (!response.ok) {
      throw new Error(`BigCommerce data events responded ${response.status}`);
    }
  },
};
