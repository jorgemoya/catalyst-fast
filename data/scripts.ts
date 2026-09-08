import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { query } from '~/lib/bigcommerce';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

/**
 * Merchant-configured third-party scripts.
 *
 * A BigCommerce merchant adds analytics, chat widgets, and pixels in the control
 * panel, not in this repo — so a storefront that ignores them silently breaks
 * every integration the merchant has bought. Catalyst calls this
 * `scriptsTransformer`.
 *
 * **Each script declares a consent category**, which is what makes this safe to
 * render at all: a TARGETING pixel must not load for a shopper who declined
 * marketing cookies. That decision cannot be made here — consent lives in a
 * cookie and this is a cached, shared read — so the scripts are fetched with
 * their categories attached and filtered in the browser. See
 * `ui/patterns/merchant-scripts.tsx`.
 */

const ScriptsQuery = graphql(`
  query MerchantScripts($visibility: ScriptVisibility!) {
    site {
      content {
        scripts(filters: { visibilities: [$visibility] }, first: 50) {
          edges {
            node {
              __typename
              entityId
              consentCategory
              location
              visibility
              ... on InlineScript {
                scriptTag
              }
              ... on SrcScript {
                src
              }
            }
          }
        }
      }
    }
  }
`);

/** Mirrors BigCommerce's `ScriptConsentCategory`. */
export type ScriptConsentCategory =
  | 'ESSENTIAL'
  | 'ANALYTICS'
  | 'FUNCTIONAL'
  | 'TARGETING'
  | 'UNKNOWN';

export type MerchantScript = {
  id: string;
  consentCategory: ScriptConsentCategory;
  location: 'HEAD' | 'FOOTER';
} & ({ kind: 'src'; src: string } | { kind: 'inline'; scriptTag: string });

/**
 * Storefront scripts only.
 *
 * `CHECKOUT` and `ORDER_CONFIRMATION` scripts belong to BigCommerce's hosted
 * checkout, which renders them itself — injecting them here would double-fire
 * conversion pixels and inflate the merchant's reported revenue.
 */
export async function getMerchantScripts(): Promise<MerchantScript[]> {
  'use cache';
  cacheLife('settings');
  cacheTag(tags.settings);

  const data = await query({
    document: ScriptsQuery,
    variables: { visibility: 'STOREFRONT' },
  });

  const scripts = data.site.content.scripts;

  return removeEdgesAndNodes(scripts).flatMap((node): MerchantScript[] => {
    const base = {
      id: String(node.entityId),
      consentCategory: node.consentCategory as ScriptConsentCategory,
      location: node.location,
    };

    if (node.__typename === 'SrcScript') {
      return [{ ...base, kind: 'src', src: node.src }];
    }

    if (node.__typename === 'InlineScript') {
      return [{ ...base, kind: 'inline', scriptTag: node.scriptTag }];
    }

    // An unmodelled Script implementation. Dropped rather than guessed at —
    // rendering an unknown script shape is how you end up injecting nothing
    // useful, or worse, something malformed into the document.
    return [];
  });
}
