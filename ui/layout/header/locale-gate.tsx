import { locale } from 'next/root-params';

import { getLocales } from '~/data/locales';
import { DEFAULT_LOCALE } from '~/lib/config/channels';

import { LocaleSwitcher } from './locale-switcher';

/**
 * Server half of the language picker.
 *
 * The options come from **BigCommerce**, not a hardcoded list: a merchant who
 * enables a language in the control panel gets it in the switcher without a code
 * change, and one who disables it stops offering a locale the store can no
 * longer serve — intersected with the catalogues in `messages/`, since a locale
 * we have no copy for is not one we can render.
 *
 * `defaultLocale` comes from `lib/config/channels.ts`, **not** from BigCommerce's
 * `isDefault`. It decides which locale gets the bare, prefix-free URL, and the
 * proxy is the authority on that; taking the store's answer instead would let the
 * switcher emit `/en/garden/` while the proxy expects `/garden/`.
 *
 * Reads the locale **root param** and a cached settings query, never a cookie or
 * a header, so unlike the currency switcher this is not a dynamic hole — each
 * locale prerenders its own shell with its own selected value.
 *
 * The client half deliberately avoids `usePathname()` for the same reason: under
 * `cacheComponents` that is URL data, and reading it during render would force a
 * Suspense boundary and give the shell residency straight back.
 */
export async function LocaleGate() {
  const [locales, current] = await Promise.all([getLocales(), locale()]);

  if (locales.length < 2) {
    return null;
  }

  return (
    <LocaleSwitcher
      current={current ?? DEFAULT_LOCALE}
      defaultLocale={DEFAULT_LOCALE}
      locales={locales.map((entry) => entry.code)}
    />
  );
}
