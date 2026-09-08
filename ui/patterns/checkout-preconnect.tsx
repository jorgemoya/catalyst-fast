import { buildConfig } from '~/lib/config';

/**
 * Opens a connection to BigCommerce's hosted checkout before the shopper clicks
 * through to it.
 *
 * The checkout handoff is a redirect to a *different origin*, so the browser
 * would otherwise pay DNS, TCP and TLS on the click — right at the highest-intent
 * moment in the session. `preconnect` moves that cost onto the cart page, where
 * there is idle time to spend.
 *
 * Rendered on the cart, not globally: preconnecting from every page would open
 * connections for the large majority of visitors who never reach checkout, and
 * browsers cap how many preconnects they honour, so spending them here would
 * crowd out ones that matter.
 */
export function CheckoutPreconnect() {
  const { vanityUrl } = buildConfig.get('urls');

  let origin: string;

  try {
    origin = new URL(vanityUrl).origin;
  } catch {
    // A malformed vanity URL should not take down the cart for a hint.
    return null;
  }

  return (
    <>
      <link href={origin} rel="preconnect" />
      {/* `dns-prefetch` as a fallback for browsers that ignore preconnect. */}
      <link href={origin} rel="dns-prefetch" />
    </>
  );
}
