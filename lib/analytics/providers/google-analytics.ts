import type { AnalyticsEvent } from '~/domain/analytics';

import type { AnalyticsProvider } from '../types';

/**
 * Google Analytics 4 via the Measurement Protocol.
 *
 * Server-side rather than gtag.js in the browser: the tag is typically the
 * heaviest third-party script on a storefront, and it runs on the critical path
 * for zero shopper benefit. The trade is that GA loses the signals it derives
 * from the browser itself — screen size, referrer chains, its own client id — so
 * a `client_id` has to be supplied.
 *
 * `client_id` is a random per-beacon value here. That deliberately makes every
 * event look like a distinct user, which is correct for *event counts* and wrong
 * for *user counts*. Stable per-visitor attribution requires a cookie, and a
 * cookie requires consent, so wiring the consent cookie's identifier through is
 * the upgrade path when a merchant wants it. Getting this wrong silently
 * inflates GA's user metric, so it is called out here rather than left to be
 * discovered in a dashboard.
 */
const MEASUREMENT_PROTOCOL = 'https://www.google-analytics.com/mp/collect';

const toGaEvent = (event: AnalyticsEvent): { name: string; params: Record<string, unknown> } => {
  switch (event.type) {
    case 'product_viewed':
      return {
        name: 'view_item',
        params: {
          currency: event.price?.currencyCode,
          value: event.price?.value,
          items: [{ item_id: String(event.productId), item_name: event.productName }],
        },
      };

    case 'category_viewed':
      return {
        name: 'view_item_list',
        params: { item_list_id: String(event.categoryId), item_list_name: event.categoryName },
      };

    case 'product_added_to_cart':
    case 'product_removed_from_cart':
      return {
        name: event.type === 'product_added_to_cart' ? 'add_to_cart' : 'remove_from_cart',
        params: {
          currency: event.lineItem.price?.currencyCode,
          value: event.lineItem.price?.value,
          items: [
            {
              item_id: String(event.lineItem.productId),
              item_name: event.lineItem.productName,
              quantity: event.lineItem.quantity,
            },
          ],
        },
      };

    case 'cart_viewed':
      return {
        name: 'view_cart',
        params: {
          currency: event.total?.currencyCode,
          value: event.total?.value,
          items: event.lineItems.map((line) => ({
            item_id: String(line.productId),
            item_name: line.productName,
            quantity: line.quantity,
          })),
        },
      };
  }
};

export const googleAnalyticsProvider: AnalyticsProvider = {
  name: 'google-analytics',

  enabled: () =>
    Boolean(process.env.GA_MEASUREMENT_ID && process.env.GA_API_SECRET),

  async send(events) {
    const url = `${MEASUREMENT_PROTOCOL}?measurement_id=${process.env.GA_MEASUREMENT_ID}&api_secret=${process.env.GA_API_SECRET}`;

    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({
        client_id: crypto.randomUUID(),
        events: events.map(toGaEvent),
      }),
    });

    // The Measurement Protocol answers 204 on success and, unhelpfully, also
    // 2xx for payloads it silently discards. A non-2xx is still worth surfacing.
    if (!response.ok) {
      throw new Error(`GA responded ${response.status}`);
    }
  },
};
