import { z } from 'zod';

/**
 * Cookie consent — the four categories, and the parsing of the cookie that
 * records them.
 *
 * Pure and separately tested because the cookie is a compact, positional-ish
 * format that is easy to misparse, and misparsing it fails in the worst
 * direction: a shopper who declined marketing cookies silently getting them.
 * When in doubt this module returns "not granted".
 *
 * **The caching consequence, which drives the whole design.** Consent lives in a
 * cookie, and reading a cookie in a Server Component makes that component
 * dynamic. Reading it to decide whether to render a banner would therefore make
 * *every page* dynamic for *every visitor* — the single most expensive possible
 * place to put a cookie read, and exactly the class of mistake this rewrite
 * exists to remove. So the banner reads it in the browser instead
 * (`ui/patterns/consent-banner.tsx`), and this module is written to run in both
 * places: no `next/headers`, no `server-only`.
 */

export const CONSENT_COOKIE_NAME = 'cf.consent';

/** Everything except `necessary`, which is granted by definition. */
export type ConsentCategory = 'functionality' | 'marketing' | 'measurement';

export const CONSENT_CATEGORIES: ConsentCategory[] = ['functionality', 'marketing', 'measurement'];

export interface Consent {
  /** When the choice was recorded, epoch ms. */
  recordedAt: number;
  necessary: true;
  functionality: boolean;
  marketing: boolean;
  measurement: boolean;
}

/*
 * Optional categories are stored as `1` when granted and omitted otherwise, so
 * "absent" and "declined" are the same thing on the wire. That asymmetry is
 * deliberate: it keeps the cookie small, and it means a truncated or partially
 * written cookie degrades to "declined" rather than to "granted".
 */
const optionalConsent = z
  .literal(1)
  .optional()
  .transform((value) => value === 1);

const ConsentCookieSchema = z.object({
  'i.t': z.number().int().positive(),
  'c.necessary': z.literal(1).transform(() => true as const),
  'c.functionality': optionalConsent,
  'c.marketing': optionalConsent,
  'c.measurement': optionalConsent,
});

/**
 * Parses `i.t:1765485149496,c.necessary:1,c.marketing:1`.
 *
 * A compact key:value list rather than JSON, because it goes in a cookie and
 * every byte is sent on every request to the origin.
 */
export function parseCompactFormat(raw: string): Record<string, string | number> {
  const result: Record<string, string | number> = {};

  for (const pair of raw.split(',')) {
    const separator = pair.indexOf(':');

    if (separator === -1) {
      continue;
    }

    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();

    if (!key || value === '') {
      continue;
    }

    const asNumber = Number(value);

    result[key] = Number.isNaN(asNumber) ? value : asNumber;
  }

  return result;
}

export function serializeConsent(consent: Omit<Consent, 'recordedAt' | 'necessary'>): string {
  const parts = [`i.t:${Date.now()}`, 'c.necessary:1'];

  for (const category of CONSENT_CATEGORIES) {
    if (consent[category]) {
      parts.push(`c.${category}:1`);
    }
  }

  return parts.join(',');
}

/** Returns `null` for a missing or unparseable cookie — i.e. "no choice made". */
export function parseConsent(raw: string | undefined | null): Consent | null {
  if (!raw) {
    return null;
  }

  const parsed = ConsentCookieSchema.safeParse(parseCompactFormat(raw));

  if (!parsed.success) {
    return null;
  }

  return {
    recordedAt: parsed.data['i.t'],
    necessary: parsed.data['c.necessary'],
    functionality: parsed.data['c.functionality'],
    marketing: parsed.data['c.marketing'],
    measurement: parsed.data['c.measurement'],
  };
}

/**
 * Whether a category may be used.
 *
 * `consentEnabled` is the store setting. When a merchant has cookie consent
 * turned **off**, there is no banner and no cookie, and everything is permitted
 * — that is the merchant's decision to make, not a default we should override.
 * When it is on and no choice has been recorded, the answer is no: undecided is
 * not consent.
 */
export function hasConsentFor(
  consent: Consent | null,
  category: ConsentCategory,
  consentEnabled: boolean,
): boolean {
  if (!consentEnabled) {
    return true;
  }

  return consent?.[category] ?? false;
}
