import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

/**
 * Gift certificate settings.
 *
 * BigCommerce models these as an **interface** with two implementations: fixed
 * denominations (a list of amounts) or a custom amount (a min/max range). A
 * store is one or the other, and the purchase form is a different form in each
 * case, so the union is preserved here rather than flattened into optional
 * fields — flattening would make "which mode is this store in?" a matter of
 * guessing which fields happen to be populated.
 */

const GiftCertificateSettingsQuery = graphql(`
  query GiftCertificateSettings {
    site {
      settings {
        giftCertificates {
          __typename
          isEnabled
          currencyCode
          expiry {
            value
            unit
          }
          ... on FixedAmountGiftCertificateSettings {
            amounts {
              value
              currencyCode
            }
          }
          ... on CustomAmountGiftCertificateSettings {
            minimumAmount {
              value
              currencyCode
            }
            maximumAmount {
              value
              currencyCode
            }
          }
        }
      }
    }
  }
`);

export type ExpiryUnit = 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';

export interface GiftCertificateExpiry {
  value: number;
  unit: ExpiryUnit;
}

export type GiftCertificateSettings =
  | {
      enabled: true;
      mode: 'fixed';
      currencyCode: string;
      amounts: number[];
      expiry: GiftCertificateExpiry | null;
    }
  | {
      enabled: true;
      mode: 'custom';
      currencyCode: string;
      min: number;
      max: number;
      expiry: GiftCertificateExpiry | null;
    }
  | { enabled: false };

const DISABLED: GiftCertificateSettings = { enabled: false };

export async function getGiftCertificateSettings(): Promise<GiftCertificateSettings> {
  'use cache';
  cacheLife('settings');
  cacheTag(tags.settings);

  const data = await query({ document: GiftCertificateSettingsQuery });
  const settings = data.site.settings?.giftCertificates;

  if (!settings?.isEnabled) {
    return DISABLED;
  }

  /*
   * Both `value` and `unit` must be present for an expiry to mean anything.
   * BigCommerce returns the object with nulls inside when expiry is off, so
   * checking the object's existence alone would produce "expires in null null".
   */
  const expiry =
    settings.expiry?.value != null && settings.expiry.unit != null
      ? { value: Number(settings.expiry.value), unit: settings.expiry.unit as ExpiryUnit }
      : null;

  if (settings.__typename === 'FixedAmountGiftCertificateSettings') {
    return {
      enabled: true,
      mode: 'fixed',
      currencyCode: settings.currencyCode,
      amounts: settings.amounts.map((amount) => amount.value),
      expiry,
    };
  }

  if (settings.__typename === 'CustomAmountGiftCertificateSettings') {
    return {
      enabled: true,
      mode: 'custom',
      currencyCode: settings.currencyCode,
      min: settings.minimumAmount.value,
      max: settings.maximumAmount.value,
      expiry,
    };
  }

  /*
   * An implementation of the interface we do not model. Treated as disabled
   * rather than crashing: a new BigCommerce mode should degrade to "gift
   * certificates unavailable", not to a 500 on a route a shopper reached from
   * the footer.
   */
  return DISABLED;
}

const GiftCertificateBalanceQuery = graphql(`
  query GiftCertificateBalance($code: String!) {
    site {
      giftCertificate(code: $code) {
        code
        status
        amount {
          value
          currencyCode
        }
        balance {
          value
          currencyCode
        }
        sender {
          name
        }
        purchasedAt {
          utc
        }
        expiresAt {
          utc
        }
      }
    }
  }
`);

export interface GiftCertificateBalance {
  code: string;
  status: string;
  amount: { value: number; currencyCode: string };
  balance: { value: number; currencyCode: string };
  senderName: string;
  purchasedAt: string;
  expiresAt: string | null;
}

/**
 * Balance lookup.
 *
 * **Deliberately not cached.** A gift certificate code is a bearer instrument —
 * anyone holding it can spend it — and its balance changes the moment it is
 * used. Two independent reasons not to cache: a stale balance is actively
 * misleading about money, and the code would have to appear in a cache key,
 * which Next stores in plain text (see the rules at the top of
 * `lib/cache/tags.ts`).
 *
 * So this is called from a Server Action only, never from a cached scope.
 */
// cache-audit: dynamic — a gift certificate code is a bearer instrument and its
// balance is money; caching it would both serve stale balances and put the code
// in a plain-text cache key.
export async function getGiftCertificateBalance(
  code: string,
): Promise<GiftCertificateBalance | null> {
  const data = await query({
    document: GiftCertificateBalanceQuery,
    variables: { code },
    // A wrong code is a normal outcome of a lookup form, not an exception.
    errorPolicy: 'ignore',
  });

  const certificate = data.site.giftCertificate;

  if (!certificate) {
    return null;
  }

  return {
    code: certificate.code,
    status: certificate.status,
    amount: certificate.amount,
    balance: certificate.balance,
    senderName: certificate.sender.name,
    purchasedAt: String(certificate.purchasedAt.utc),
    expiresAt: certificate.expiresAt ? String(certificate.expiresAt.utc) : null,
  };
}
