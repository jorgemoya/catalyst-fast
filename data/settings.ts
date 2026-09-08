import { cacheLife, cacheTag } from 'next/cache';

import { fromBcSort, type SortValue } from '~/domain/listing-params';
import { tags } from '~/lib/cache/tags';
import { query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';

/**
 * Store settings. Cached once for the whole site rather than re-fetched per page.
 *
 * Catalyst refetched settings inside almost every `page-data.ts`, and because
 * those queries also carried a customer token, logged-in users got zero caching
 * on data that is byte-identical for every visitor on the store. Here it is one
 * entry, shared by everyone, invalidated by a `store/settings/*` webhook.
 */

const StoreSettingsQuery = graphql(`
  query StoreSettings {
    site {
      settings {
        storeName
        status
        logoV2 {
          __typename
            ... on StoreTextLogo {
            text
          }
          ... on StoreImageLogo {
            image {
              url: urlTemplate(lossy: true)
              altText
            }
          }
        }
        contact {
          address
          phone
          email
        }
        socialMediaLinks {
          name
          url
        }
        seo {
          pageTitle
          metaDescription
          metaKeywords
        }
        url {
          vanityUrl
        }
        tax {
          pdp
          plp
        }
        inventory {
          defaultOutOfStockMessage
          showOutOfStockMessage
          showBackorderMessage
        }
        display {
          showProductRating
        }
        # Whether the merchant has cookie consent turned on. Read here, in a
        # cached store-level query, rather than anywhere near a cookie: the
        # banner itself decides what to show client-side, so no page goes dynamic
        # for it. See ui/patterns/consent-banner.tsx.
        privacy {
          cookieConsentEnabled
        }
        # Nested under storefront, not directly on settings — the latter fails
        # validation with: Cannot query field "catalog" on type "Settings".
        # (No backticks in this comment: the document is a TS template literal,
        # so a backtick here terminates the string and the parse errors land
        # somewhere unrelated.)
        storefront {
          catalog {
            productComparisonsEnabled
          }
        }
        newsletter {
          showNewsletterSignup
        }
        reviews {
          enabled
        }
        search {
          defaultSearchProductSort
        }
      }
    }
  }
`);

export type StoreLogo = { type: 'text'; text: string } | { type: 'image'; src: string; alt: string };

export interface StoreSettings {
  storeName: string;
  logo: StoreLogo;
  contact: { address: string; phone: string; email: string } | null;
  socialMediaLinks: Array<{ name: string; url: string }>;
  seo: { pageTitle: string; metaDescription: string; metaKeywords: string };
  taxDisplay: { pdp: 'INC' | 'EX' | 'BOTH' | null; plp: 'INC' | 'EX' | 'BOTH' | null };
  inventory: {
    defaultOutOfStockMessage: string | null;
    showOutOfStockMessage: boolean;
    showBackorderMessage: boolean;
  };
  showProductRating: boolean;
  reviewsEnabled: boolean;
  /**
   * Merchant setting. When false there is no banner and every consent category
   * is permitted — that is the merchant's call to make, not a default to
   * second-guess. See `domain/consent.ts`.
   */
  cookieConsentEnabled: boolean;
  /** Merchant setting gating the compare checkbox, drawer, and /compare route. */
  productComparisonsEnabled: boolean;
  /** Merchant setting gating the newsletter signup on the home page. */
  newsletterEnabled: boolean;
  /**
   * The merchant's configured default sort for *search* results, which is a
   * different setting from a category's `defaultProductSort`. BigCommerce
   * defaults it to RELEVANCE for textual search.
   *
   * Load-bearing for the cache, not just for display: canonicalization drops a
   * `?sort=` that equals the default, so getting this wrong means every visitor
   * arriving via the sort dropdown's default option creates a *second* cache
   * entry identical to the unsorted one.
   */
  defaultSearchSort: SortValue;
}

/** BigCommerce's enum → our URL-facing sort value. Falls back to relevance, which
 * is BigCommerce's own default for textual search. */
const toSortValue = (bcSort: string | null | undefined): SortValue =>
  fromBcSort(bcSort) ?? 'relevance';

export async function getStoreSettings(): Promise<StoreSettings> {
  'use cache';
  cacheLife('settings');
  cacheTag(tags.settings);

  const data = await query({ document: StoreSettingsQuery });
  const settings = data.site.settings;

  if (!settings) {
    throw new Error('BigCommerce returned no site settings.');
  }

  const logo: StoreLogo =
    settings.logoV2.__typename === 'StoreImageLogo'
      ? {
          type: 'image',
          src: settings.logoV2.image.url,
          alt: settings.logoV2.image.altText || settings.storeName,
        }
      : { type: 'text', text: settings.logoV2.text };

  return {
    storeName: settings.storeName,
    logo,
    cookieConsentEnabled: settings.privacy?.cookieConsentEnabled ?? false,
    productComparisonsEnabled: settings.storefront.catalog?.productComparisonsEnabled ?? false,
    newsletterEnabled: settings.newsletter.showNewsletterSignup,
    contact: settings.contact ?? null,
    socialMediaLinks: [...settings.socialMediaLinks],
    seo: settings.seo ?? { pageTitle: '', metaDescription: '', metaKeywords: '' },
    taxDisplay: { pdp: settings.tax?.pdp ?? null, plp: settings.tax?.plp ?? null },
    inventory: {
      defaultOutOfStockMessage: settings.inventory?.defaultOutOfStockMessage ?? null,
      showOutOfStockMessage: settings.inventory?.showOutOfStockMessage ?? false,
      showBackorderMessage: settings.inventory?.showBackorderMessage ?? false,
    },
    showProductRating: settings.display?.showProductRating ?? false,
    reviewsEnabled: settings.reviews?.enabled ?? false,
    defaultSearchSort: toSortValue(settings.search?.defaultSearchProductSort),
  };
}
