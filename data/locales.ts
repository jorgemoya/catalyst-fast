import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';
import { DEFAULT_LOCALE } from '~/lib/config/channels';
import { hasMessagesFor } from '~/lib/i18n/messages';

/**
 * The locales this storefront serves, **as configured in BigCommerce**.
 *
 * Previously a hardcoded list in `lib/config/channels.ts`. That happened to match
 * this store — `en` default plus `es` — but only by luck: it was inferred rather
 * than read. A merchant adding a language in the control panel would have got
 * nothing, with no error to explain why.
 *
 * `path` is BigCommerce's optional URL subfolder for a locale — empty on this
 * store, which is why routing uses `/<code>`, the same fallback next-intl uses.
 * **It is carried on the model but not yet honoured**, and saying so is the point:
 * honouring it means the proxy resolving a merchant-defined segment, and the
 * proxy's locale check is deliberately static (see `isLocale`). `build-config`
 * warns when a store sets one, so a merchant who does gets told rather than
 * getting silence.
 *
 * **`isDefault` is deliberately not read.** BigCommerce marks one locale as the
 * catalog's default, which is a different question from "whose URL prefix does
 * this storefront hide" — that is a routing rule, owned by `DEFAULT_LOCALE` in
 * `lib/config/channels.ts` and enforced by the proxy. Feeding BigCommerce's
 * answer into the switcher would let the two disagree and generate URLs the
 * proxy then 404s. `build-config` warns if they drift.
 *
 * **Intersected with the message catalogues we ship**, and that is not a
 * hedge. A locale BigCommerce reports but `messages/` has no file for is not a
 * locale this storefront can serve: routing it would produce `/de/` pages with
 * `lang="de"` and English chrome throughout — worse than not offering German at
 * all, because it looks deliberate. The store decides which locales *exist*; the
 * repo decides which are *translated*; a shopper may only reach the overlap.
 */

const LocalesQuery = graphql(`
  query StoreLocales {
    site {
      settings {
        locales {
          code
          path
        }
      }
    }
  }
`);

export interface StoreLocale {
  code: string;
  /** Merchant-configured subfolder, or '' to fall back to `/<code>`. */
  path: string;
}

export async function getLocales(): Promise<StoreLocale[]> {
  'use cache';
  cacheLife('settings');
  cacheTag(tags.settings);

  const data = await query({ document: LocalesQuery });

  const translated = (data.site.settings?.locales ?? [])
    .filter((locale) => hasMessagesFor(locale.code))
    .map((locale) => ({ code: locale.code, path: locale.path ?? '' }));

  /*
   * A store with no locales configured — or none we have copy for — still has to
   * route. Falling back to the default keeps `generateStaticParams` non-empty,
   * which under `cacheComponents` is the difference between a build and a build
   * failure.
   */
  if (translated.length === 0) {
    return [{ code: DEFAULT_LOCALE, path: '' }];
  }

  return translated;
}
