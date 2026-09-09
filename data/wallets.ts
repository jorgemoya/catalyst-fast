import 'server-only';

import { query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';

/**
 * Express-checkout wallet buttons (Apple Pay, Google Pay, PayPal).
 *
 * **Everything here is deliberately uncached**, which is the opposite of the
 * rule for the rest of `data/` and is why it carries the opt-out below. Two
 * independent reasons, either sufficient:
 *
 *  1. It is keyed by cart id and shared by nobody. A cached entry per cart is a
 *     cache with a hit rate of zero and an unbounded key space.
 *  2. `initializationData` and `clientToken` are **single-use session
 *     material**. Serving a cached one hands a second shopper the first
 *     shopper's payment session. That is not a stale-data bug, it is a
 *     correctness and security bug, and `use cache` stores keys and values in
 *     plain text.
 *
 * **Two things to know before relying on this.** BigCommerce marks both
 * `paymentWallets` and `paymentWalletWithInitializationData` as
 * `@deprecated(reason: "Alpha version. Do not use in production.")` in the
 * schema — the same alpha marker `Reviews.averageRating` carries, which the
 * storefront already depends on. And this store currently has **no wallets
 * enabled**: `paymentWallets` returns an empty list, so the buttons render
 * nothing until a merchant configures Apple Pay, Google Pay or PayPal in the
 * BigCommerce control panel. The code path below is therefore built to the
 * documented shape but has never been observed rendering a real button.
 */

const PaymentWalletsQuery = graphql(`
  query PaymentWallets($cartId: String!, $currencyCode: String) {
    site {
      paymentWallets(filter: { cartEntityId: $cartId, currencyCode: $currencyCode }, first: 10) {
        edges {
          node {
            entityId
          }
        }
      }
    }
  }
`);

const WalletInitializationQuery = graphql(`
  query PaymentWalletInitialization($walletId: String!, $cartId: String!) {
    site {
      paymentWalletWithInitializationData(
        filter: { paymentWalletEntityId: $walletId, cartEntityId: $cartId }
      ) {
        clientToken
        initializationData
      }
    }
  }
`);

/**
 * What `checkout-sdk-js` needs to mount one button.
 *
 * The odd `[methodId]` self-keyed shape is the SDK's own contract, not ours: it
 * reads its per-method options from a property named after the method.
 */
export interface WalletButtonOption {
  methodId: string;
  containerId: string;
  [key: string]: unknown;
}

// cache-audit: dynamic — cart-scoped, and the payload is single-use payment
// session material that must never be shared between shoppers. See the note at
// the top of this file.
export async function getWalletButtons(
  cartId: string,
  currencyCode: string,
  amount: number,
  decimalPlaces: number,
): Promise<WalletButtonOption[]> {
  const data = await query({
    document: PaymentWalletsQuery,
    variables: { cartId, currencyCode },
  });

  const wallets = (data.site.paymentWallets.edges ?? []).map((edge) => edge.node.entityId);

  if (wallets.length === 0) {
    return [];
  }

  const options = await Promise.all(
    wallets.map(async (entityId) => {
      const init = await query({
        document: WalletInitializationQuery,
        variables: { walletId: entityId, cartId },
      });

      /*
       * `braintree.paypal` → `braintreepaypal`. The SDK identifies methods by
       * the dotless form and derives its container id from it; sending the
       * dotted id mounts nothing, silently.
       */
      const methodId = entityId.split('.').join('');
      const initData = init.site.paymentWalletWithInitializationData;

      return {
        methodId,
        containerId: `${methodId}-button`,
        [methodId]: {
          cartId,
          currency: { code: currencyCode, decimalPlaces },
          amount,
          clientToken: initData?.clientToken ?? undefined,
          initializationData: initData?.initializationData ?? undefined,
        },
      } satisfies WalletButtonOption;
    }),
  );

  return options;
}
