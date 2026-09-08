import { getStoreSettings } from '~/data/settings';

import { ConsentBanner } from './consent-banner';

/**
 * Server half of the consent banner: reads the merchant's setting from the
 * cached store settings and hands it to the client island.
 *
 * The split exists so the *setting* (shared, cacheable, identical for everyone)
 * is read on the server, while the *shopper's choice* (a cookie, unique per
 * visitor) is read in the browser. Reading the cookie here instead would make
 * this component dynamic, and because it lives in the storefront layout that
 * would drag every page out of the static shell — for a cookie bar.
 *
 * `getStoreSettings` is already fetched elsewhere on every page, so this shares
 * that cache entry and costs no additional origin request.
 */
export async function ConsentGate() {
  const { cookieConsentEnabled } = await getStoreSettings();

  return <ConsentBanner enabled={cookieConsentEnabled} />;
}
