import en from '~/messages/en.json';
import es from '~/messages/es.json';

import { DEFAULT_LOCALE } from '~/lib/config/channels';

/**
 * Locale-aware translation, without giving up `use cache`.
 *
 * The constraint that shaped this: `next-intl`'s server helpers
 * (`getTranslations`, `getLocale`) are **request**-scoped and throw inside a
 * `'use cache'` body. Locale, however, is a **root param** — part of the route,
 * not the request — so `locale()` from `next/root-params` *is* legal there. This
 * module therefore never touches request state; it takes a locale and returns a
 * pure translator built from static message catalogues.
 *
 * Two entry points, same `t('Namespace.key')` signature so call sites are
 * unchanged:
 *
 *   Server Components   `const t = await getT()`         (safe inside use cache)
 *   Client Components   `const t = useTranslations()`    (from next-intl)
 *
 * Client components read through `NextIntlClientProvider`, mounted in the root
 * layout with the active locale's catalogue — see `app/[locale]/layout.tsx`.
 */

export const MESSAGES = { en, es } as const;

export type Locale = keyof typeof MESSAGES;

export type Messages = (typeof MESSAGES)[typeof DEFAULT_LOCALE];

const isKnownLocale = (value: string): value is Locale => Object.hasOwn(MESSAGES, value);

/**
 * Whether this repo can render copy in a locale.
 *
 * `data/locales.ts` intersects BigCommerce's configured locales with this, so a
 * language the merchant enables is only routed once someone adds its catalogue.
 */
export const hasMessagesFor = (value: string): boolean => isKnownLocale(value);

/**
 * Narrows whatever a locale source returned to a locale we can actually render.
 *
 * **Exists because `?? DEFAULT_LOCALE` is not enough**, and the gap it left was
 * expensive. `next/root-params` yields an **empty string** — not `undefined` —
 * while prerendering the param-independent fallback shell, and `??` passes `''`
 * straight through. `Intl.NumberFormat('')` then throws `Incorrect locale
 * information provided`, which is a `RangeError` from the platform, while
 * `Intl.NumberFormat(undefined)` is perfectly legal. So the nullish check caught
 * the harmless case and missed the fatal one.
 *
 * Measured: one listing page render produced 336 of these. They were invisible
 * in tests because they only surface where a locale is genuinely required —
 * money formatting and ICU-parameterized messages — so plain lookups kept
 * working and the pages still looked right.
 *
 * Every locale source funnels through here: the root param, the proxy header,
 * and next-intl's request config.
 */
export function normalizeLocale(value: string | undefined | null): string {
  const trimmed = value?.trim();

  return trimmed && isKnownLocale(trimmed) ? trimmed : DEFAULT_LOCALE;
}

/**
 * Deep-merges a translated catalogue over the English one.
 *
 * **Whole-catalogue fallback and per-key fallback are different problems**, and
 * only the first was handled before. An unknown *locale* fell back to English;
 * a known locale with a *missing key* did not — next-intl reports
 * `MISSING_MESSAGE` and renders the key path, so a shopper on `/es/` read the
 * literal text `Header.language` in the header. Measured against next-intl 4.14,
 * not assumed: it does not consult another locale on its own.
 *
 * **Merging rather than `getMessageFallback`**, which was the first attempt and
 * was wrong. That option takes a function, and functions do not cross the RSC
 * boundary — `NextIntlClientProvider` inherits `locale`, `messages` and
 * `timeZone` from `i18n/request.ts` but cannot inherit a callback. The result
 * was a fallback that worked in Server Components and silently did nothing in
 * Client Components, which is the worst of both: verified by deleting a key and
 * watching `/es/` render `aria-label="Header.language"` on the language
 * switcher.
 *
 * Merging has none of that asymmetry — it is just data, so server and client see
 * the same catalogue — and it costs nothing: the merged object has exactly the
 * key set of `en.json`, which is already the payload for English shoppers.
 *
 * `messages.spec.ts` keeps the catalogues in step, so this stays a safety net
 * rather than a licence to skip translations. Exported for that spec: the merge
 * only has observable behaviour when a key is missing, which parity forbids, so
 * it has to be exercised against a deliberately sparse catalogue.
 */
export function mergeOverEnglish(translated: Catalogue): Catalogue {
  const merge = (base: Catalogue, override: Catalogue): Catalogue => {
    const result: Catalogue = { ...base };

    for (const [key, value] of Object.entries(override)) {
      const existing = result[key];

      result[key] =
        isCatalogue(value) && isCatalogue(existing) ? merge(existing, value) : (value as Catalogue);
    }

    return result;
  };

  return merge(MESSAGES[DEFAULT_LOCALE] as unknown as Catalogue, translated);
}

type Catalogue = Record<string, unknown>;

const isCatalogue = (value: unknown): value is Catalogue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/*
 * Memoized because `i18n/request.ts` calls this on every config resolution, and
 * the result is immutable — there is no reason to walk both catalogues twice.
 */
const merged = new Map<Locale, Messages>();

export function messagesFor(locale: string): Messages {
  if (!isKnownLocale(locale) || locale === DEFAULT_LOCALE) {
    return MESSAGES[DEFAULT_LOCALE] as Messages;
  }

  let catalogue = merged.get(locale);

  if (!catalogue) {
    catalogue = mergeOverEnglish(MESSAGES[locale] as unknown as Catalogue) as unknown as Messages;
    merged.set(locale, catalogue);
  }

  return catalogue;
}

/**
 * Number and date formatters, per locale.
 *
 * Locale changes how money reads, not just which words surround it: `$1,234.50`
 * in `en` is `1234,50 US$` in `es`. Formatting Spanish copy with an English
 * formatter is the kind of thing that looks fine to whoever built it and wrong
 * to everyone who speaks the language.
 *
 * Cached by `locale:currency` because `Intl.NumberFormat` construction is
 * expensive enough to matter across a 50-card grid.
 */
const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatCurrencyIn(locale: string, amount: number, currencyCode: string): string {
  const key = `${locale}:${currencyCode}`;

  let formatter = currencyFormatters.get(key);

  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode });
    currencyFormatters.set(key, formatter);
  }

  return formatter.format(amount);
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: string, utc: boolean): Intl.DateTimeFormat {
  const key = `${locale}:${utc ? 'utc' : 'local'}`;

  let formatter = dateFormatters.get(key);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      ...(utc && { timeZone: 'UTC' }),
    });
    dateFormatters.set(key, formatter);
  }

  return formatter;
}

/**
 * For a real *instant* — a publish time, an order date. Rendered in the viewer's
 * timezone, which is what they want for a moment in time.
 */
export const formatDateIn = (locale: string, date: Date | string): string =>
  dateFormatter(locale, false).format(typeof date === 'string' ? new Date(date) : date);

/**
 * For a *calendar date* the shopper picked — a delivery date, an engraving date.
 *
 * These have no time and no timezone: "December 24th" means that day wherever
 * you are. `domain/cart-line.ts` anchors them at UTC midnight on submission, so
 * they must be read back in UTC too. Formatting one with `formatDateIn` instead
 * silently shifts it a day for every viewer west of UTC.
 */
export const formatDateOnlyIn = (locale: string, date: Date | string): string =>
  dateFormatter(locale, true).format(typeof date === 'string' ? new Date(date) : date);

/*
 * Default-locale conveniences.
 *
 * These exist because a handful of call sites genuinely cannot reach a locale:
 * pure modules under `domain/`, and code paths outside the `[locale]` segment.
 * Everywhere else should use the locale-aware forms — a call to one of these in
 * a component renders English to a Spanish shopper, silently.
 *
 * There is deliberately no default-locale `t` any more: translation goes through
 * next-intl (`getT()` on the server, `useTranslations()` on the client), so a
 * default-locale translator would only ever be a way to get that wrong.
 */
export const formatCurrency = (amount: number, currencyCode: string): string =>
  formatCurrencyIn(DEFAULT_LOCALE, amount, currencyCode);

export const formatDate = (date: Date | string): string => formatDateIn(DEFAULT_LOCALE, date);

export const formatDateOnly = (date: Date | string): string =>
  formatDateOnlyIn(DEFAULT_LOCALE, date);
