'use client';

import { useTranslations } from 'next-intl';

import { useTransition } from 'react';

import { setCurrency } from '~/app/[locale]/(storefront)/_actions/currency';
import type { StoreCurrency } from '~/data/currencies';

/**
 * Display-currency picker.
 *
 * A plain `<select>` rather than a popover: it is a short list of mutually
 * exclusive options, which is what a select is for, and it works before
 * hydration.
 *
 * `selected` is passed from the server rather than read from the cookie here, so
 * the rendered value matches what the page was actually priced in. Reading the
 * cookie client-side could disagree with the server for one paint.
 */
export function CurrencySwitcher({
  currencies,
  selected,
}: {
  currencies: StoreCurrency[];
  selected: string;
}) {
  const t = useTranslations();

  const [pending, startTransition] = useTransition();

  // One currency is not a choice. The server already avoids the query in this
  // case; this is the render-side half of the same decision.
  if (currencies.length < 2) {
    return null;
  }

  return (
    <label className="flex items-center">
      <span className="sr-only">{t('Header.currency')}</span>
      <select
        aria-label={t('Header.currency')}
        className="rounded-(--radius-control) border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;

          // A transition so the page stays interactive while the server action
          // re-renders it with the new currency.
          startTransition(async () => {
            await setCurrency(next);
          });
        }}
        value={selected}
      >
        {currencies.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.code}
          </option>
        ))}
      </select>
    </label>
  );
}
