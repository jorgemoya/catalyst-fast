import { type NextRequest, NextResponse } from 'next/server';

import { mutate } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { resolveAttribution } from '~/lib/analytics/attribution';
import { getCartId } from '~/lib/cart/session';
import { getTForAction } from '~/lib/i18n/server';
import { setServerToast } from '~/lib/server-toast';

/**
 * Handoff to BigCommerce's hosted checkout.
 *
 * A route handler rather than a page, because nothing is rendered: the request
 * exchanges a cart id for a single-use checkout URL and redirects. BigCommerce
 * requires that URL be generated **just-in-time — within 30 seconds of use** —
 * which is also why the cart page links here with `prefetch={false}` and why
 * every response below is `no-store`. A cached redirect is a dead link.
 *
 * Sits outside the `(storefront)` group deliberately: it has no chrome, and
 * putting it inside would render a header and footer that are immediately thrown
 * away.
 *
 * **Analytics attribution travels with the handoff.** BigCommerce ties the
 * hosted-checkout session back to the storefront visit that produced it, so
 * omitting the `analytics` input leaves every order unattributed. The consent
 * flags are forwarded whether or not the shopper consented — that is what makes
 * the decision binding on BigCommerce's side — while the visitor identity is
 * sent only with measurement consent. See `lib/analytics/attribution.ts`.
 */

const CheckoutRedirectMutation = graphql(`
  mutation CreateCartRedirectUrls($cartId: String!, $analytics: AnalyticsCommonEventInput) {
    cart {
      createCartRedirectUrls(input: { cartEntityId: $cartId, analytics: $analytics }) {
        errors {
          ... on NotFoundError {
            __typename
          }
        }
        redirectUrls {
          redirectedCheckoutUrl
        }
      }
    }
  }
`);

/** Never let a proxy or the browser reuse a single-use URL. */
const NO_STORE = { 'Cache-Control': 'no-store, must-revalidate' };

/**
 * Sends the shopper back to the cart, optionally saying why.
 *
 * A redirect discards anything this handler might have returned, so the reason
 * has to travel in a cookie and be consumed on the next render — which is
 * precisely what `lib/server-toast.ts` was built for and, until now, what nobody
 * called. `ToasterGate` in the layout reads and clears it.
 *
 * The message is **optional on purpose**. An empty cart redirects here too, and
 * the cart's own empty state already explains itself; a toast there would be
 * noise stacked on top of an explanation.
 */
async function backToCart(request: NextRequest, message?: string): Promise<NextResponse> {
  if (message) {
    await setServerToast({ variant: 'error', message });
  }

  return NextResponse.redirect(new URL('/cart', request.url), {
    status: 302,
    headers: NO_STORE,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // `getTForAction`, not `getT`: `next/root-params` is unavailable in a Route
  // Handler, so the locale comes from the header the proxy set.
  const t = await getTForAction();
  const cartId = await getCartId();

  if (!cartId) {
    // No message: the cart's empty state is the explanation.
    return backToCart(request);
  }

  try {
    const attribution = await resolveAttribution();

    const data = await mutate({
      document: CheckoutRedirectMutation,
      variables: {
        cartId,
        analytics: {
          /*
           * `initiator` is nullable in the schema; `request` and `consent` are
           * not. So a shopper who declined measurement still forwards their
           * decision and the request context, just no identifier.
           */
          ...(attribution.initiator && { initiator: attribution.initiator }),
          request: {
            url: request.url,
            userAgent: request.headers.get('user-agent') ?? '',
            // Nullable, and genuinely absent on a direct navigation — sending
            // an empty string would claim a referrer of "".
            refererUrl: request.headers.get('referer') || null,
            acceptLanguage: request.headers.get('accept-language') || null,
          },
          consent: attribution.consent,
        },
      },
    });

    const result = data.cart.createCartRedirectUrls;

    // An expired or already-converted cart comes back as a NotFoundError rather
    // than a thrown error, so both paths land the shopper back on the cart page
    // where the empty state explains itself.
    if (result.errors.length > 0 || !result.redirectUrls) {
      return backToCart(request, t('Cart.checkoutFailed'));
    }

    return NextResponse.redirect(result.redirectUrls.redirectedCheckoutUrl, {
      status: 302,
      headers: NO_STORE,
    });
  } catch (error) {
    console.error('[checkout]', error);

    return backToCart(request, t('Cart.checkoutFailed'));
  }
}
