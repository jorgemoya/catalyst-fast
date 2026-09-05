import { cacheLife, cacheTag } from 'next/cache';

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
        reviews {
          enabled
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
}

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
  };
}
