import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE } from '~/lib/config/channels';

import { MESSAGES, hasMessagesFor, mergeOverEnglish, messagesFor } from './messages';

/**
 * Catalogue integrity.
 *
 * `en.json` is the source and every other catalogue follows it, which means the
 * failure mode is always the same: someone adds an English string, ships, and
 * the Spanish storefront quietly renders something wrong. `messagesFor` merges
 * over English so a shopper never sees a raw key path — but a fallback nobody is
 * told about is just a slower way to ship an untranslated store. This is the
 * part that makes it loud.
 */

type Catalogue = Record<string, unknown>;

const flatten = (node: Catalogue, prefix = ''): string[] =>
  Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? flatten(value as Catalogue, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

const catalogues = Object.entries(MESSAGES) as Array<[string, Catalogue]>;
const englishKeys = flatten(MESSAGES[DEFAULT_LOCALE] as Catalogue);

describe.each(catalogues.filter(([locale]) => locale !== DEFAULT_LOCALE))(
  '%s catalogue',
  (_locale, catalogue) => {
    const keys = flatten(catalogue);

    it('has every key English has', () => {
      expect(englishKeys.filter((key) => !keys.includes(key))).toEqual([]);
    });

    /*
     * The other direction matters too, and is easier to miss: a key here that
     * English lacks is either a typo or a string nothing renders. Both are dead
     * weight, and the typo version means the real key is *also* missing.
     */
    it('has no keys English lacks', () => {
      expect(keys.filter((key) => !englishKeys.includes(key))).toEqual([]);
    });

    it('leaves no message empty', () => {
      const empty = keys.filter((key) => {
        const value = key
          .split('.')
          .reduce<unknown>((node, segment) => (node as Record<string, unknown>)[segment], catalogue);

        return typeof value === 'string' && value.trim() === '';
      });

      expect(empty).toEqual([]);
    });

    /*
     * ICU placeholders are part of the contract, not the prose. A translator who
     * drops `{count}` produces a string that renders but is missing the number,
     * which reads as a bug in the store rather than a bug in the translation.
     */
    it('preserves the ICU placeholders of each English string', () => {
      /*
       * A placeholder is `{name}` or `{name, <type>…}` for a *known* ICU type —
       * not merely a `{` followed by a word. The naive form matched the bodies of
       * plural branches too: in `one {Cart, # item}` it read `Cart` as an
       * argument, so the correctly translated `one {Carrito, # artículo}` failed.
       * The types are the closed set ICU defines, which is what makes this
       * separable from prose without parsing the message properly.
       */
      const PLACEHOLDER =
        /\{(\w+)\s*(?:\}|,\s*(?:plural|selectordinal|select|number|date|time)\b)/gu;

      const placeholders = (value: unknown): string[] =>
        typeof value === 'string' ? [...value.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '') : [];

      const at = (node: Catalogue, key: string): unknown =>
        key
          .split('.')
          .reduce<unknown>(
            (current, segment) =>
              typeof current === 'object' && current !== null
                ? (current as Record<string, unknown>)[segment]
                : undefined,
            node,
          );

      const mismatched = englishKeys.filter((key) => {
        const expected = placeholders(at(MESSAGES[DEFAULT_LOCALE] as Catalogue, key)).sort();
        const actual = placeholders(at(catalogue, key)).sort();

        return JSON.stringify(expected) !== JSON.stringify(actual);
      });

      expect(mismatched).toEqual([]);
    });
  },
);

describe('messagesFor', () => {
  it('serves the translated string for a locale we ship copy for', () => {
    expect(messagesFor('es').Header.currency).toBe(MESSAGES.es.Header.currency);
  });

  it('returns the English catalogue itself for the default locale', () => {
    // Not a copy: the merge is skipped entirely, so there is nothing to keep in
    // sync and no allocation on the hottest path.
    expect(messagesFor(DEFAULT_LOCALE)).toBe(MESSAGES[DEFAULT_LOCALE]);
  });

  it('exposes every English key on a translated catalogue, so no lookup can miss', () => {
    const flatEn = flatten(MESSAGES[DEFAULT_LOCALE] as Catalogue);
    const flatEs = flatten(messagesFor('es') as unknown as Catalogue);

    expect(flatEn.filter((key) => !flatEs.includes(key))).toEqual([]);
  });

  /*
   * Unreachable through routing — the proxy's `isLocale` guard and
   * `generateStaticParams` both close that door — but the fallback is what makes
   * it merely unreachable rather than a crash if either one ever changes.
   */
  it('falls back to English for a locale we do not', () => {
    expect(messagesFor('de')).toBe(MESSAGES[DEFAULT_LOCALE]);
    expect(messagesFor('')).toBe(MESSAGES[DEFAULT_LOCALE]);
  });
});

/*
 * The per-key half of the fallback — the one that actually happens: English
 * gains a string and the translation lands a commit later. Shoppers must read
 * English in the meantime, never `Namespace.key`.
 *
 * Exercised against a deliberately sparse catalogue rather than by mutating
 * `es.json`, because the parity suite above forbids the gap this is about.
 */
describe('mergeOverEnglish', () => {
  const sparse = { Header: { currency: 'Moneda' } };

  it('keeps the translated string where there is one', () => {
    const merged = mergeOverEnglish(sparse) as { Header: Record<string, string> };

    expect(merged.Header.currency).toBe('Moneda');
  });

  it('fills an untranslated key from English rather than leaving a hole', () => {
    const merged = mergeOverEnglish(sparse) as { Header: Record<string, string> };

    expect(merged.Header.language).toBe(MESSAGES.en.Header.language);
  });

  it('recurses rather than replacing a whole namespace', () => {
    // A shallow merge would drop every sibling of `currency` under `Header`,
    // which is the bug this shape invites.
    const merged = mergeOverEnglish(sparse) as Catalogue;
    const englishHeaderKeys = Object.keys(MESSAGES.en.Header);

    expect(Object.keys(merged.Header as Catalogue).sort()).toEqual(englishHeaderKeys.sort());
  });

  it('does not mutate the English catalogue', () => {
    const before = JSON.stringify(MESSAGES.en);

    mergeOverEnglish({ Header: { currency: 'Moneda' }, Brand: { new: 'x' } });

    expect(JSON.stringify(MESSAGES.en)).toBe(before);
  });
});

describe('hasMessagesFor', () => {
  it('gates which BigCommerce locales are actually servable', () => {
    expect(hasMessagesFor('en')).toBe(true);
    expect(hasMessagesFor('es')).toBe(true);
    expect(hasMessagesFor('de')).toBe(false);
  });
});

