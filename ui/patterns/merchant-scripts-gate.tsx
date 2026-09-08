import { getMerchantScripts } from '~/data/scripts';
import { getStoreSettings } from '~/data/settings';

import { MerchantScripts } from './merchant-scripts';

/**
 * Server half of merchant script injection, matching `ConsentGate`: both reads
 * are cached and shared, so this costs no origin request per visitor and keeps
 * the layout in the static shell. The consent decision happens in the browser.
 *
 * Scripts are split by their configured `location`. HEAD scripts are rendered
 * here in document order ahead of FOOTER ones — React hoists `<script>` to the
 * head itself in the app router, so the distinction is about ordering rather
 * than literal placement.
 */
export async function MerchantScriptsGate() {
  const [scripts, settings] = await Promise.all([getMerchantScripts(), getStoreSettings()]);

  if (scripts.length === 0) {
    return null;
  }

  const ordered = [
    ...scripts.filter((script) => script.location === 'HEAD'),
    ...scripts.filter((script) => script.location === 'FOOTER'),
  ];

  return <MerchantScripts consentEnabled={settings.cookieConsentEnabled} scripts={ordered} />;
}
