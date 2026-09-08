import { getStoreSettings } from '~/data/settings';

import { CompareDrawer } from './compare-controls';

/**
 * Server half of the compare drawer, mirroring `ConsentGate`: the merchant
 * setting is read on the server from the shared cached settings entry, and the
 * shopper's selection is read in the browser from `sessionStorage`.
 *
 * Keeping the split means the drawer costs no origin request and no dynamism —
 * reading the selection server-side would require a cookie, which would pull the
 * storefront layout out of the static shell for every page.
 */
export async function CompareDrawerGate() {
  const { productComparisonsEnabled } = await getStoreSettings();

  return <CompareDrawer enabled={productComparisonsEnabled} />;
}
