'use client';

import { useLocale, useTranslations } from 'next-intl';

import { useActionState, useState } from 'react';

import {
  type EstimateState,
  cancelShippingEstimate,
  estimateShippingCost,
} from '../_actions/shipping';

import type { Country } from '~/data/geography';
import { formatCurrencyIn } from '~/lib/i18n/messages';

/**
 * Shipping estimator.
 *
 * The country list is passed in from a cached Server Component rather than
 * fetched here — it is the same `getCountries()` entry every address form uses,
 * so it costs no origin request, and shipping ~250 countries with their states
 * as props is far cheaper than a client fetch on mount.
 *
 * The state dropdown is driven off the selected country's own list rather than a
 * second request, for the same reason: the data is already here.
 */
export function ShippingEstimator({ countries }: { countries: Country[] }) {
  const t = useTranslations();

  const [result, action, pending] = useActionState(estimateShippingCost, null);
  const [countryCode, setCountryCode] = useState('');
  const [editing, setEditing] = useState(true);

  const country = countries.find((candidate) => candidate.code === countryCode);
  const showResult = !editing && result;

  return (
    <section className="mt-6 border-t border-border pt-6">
      <h2 className="mb-3 text-sm font-semibold">{t('Cart.shippingEstimate')}</h2>

      {editing ? (
        <form
          action={action}
          className="flex flex-col gap-3"
          onSubmit={() => {
            // Collapses to the result view once submitted; the action's own
            // pending state covers the interval.
            setEditing(false);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t('Cart.shippingCountry')}
            <select
              className="rounded-(--radius-control) border border-border p-2"
              name="countryCode"
              onChange={(event) => setCountryCode(event.target.value)}
              value={countryCode}
            >
              <option value="">{t('Cart.shippingChooseCountry')}</option>
              {countries.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>

          {/* Only rendered when the selected country actually has states —
              showing an empty dropdown implies missing data. */}
          {country && country.states.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              {t('Cart.shippingState')}
              <select className="rounded-(--radius-control) border border-border p-2" name="state">
                <option value="">{t('Cart.shippingChooseState')}</option>
                {country.states.map((state) => (
                  <option key={state.id} value={state.abbreviation || state.name}>
                    {state.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-sm">
            {t('Cart.shippingCity')}
            <input
              className="rounded-(--radius-control) border border-border p-2"
              name="city"
              type="text"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            {t('Cart.shippingPostalCode')}
            <input
              autoComplete="postal-code"
              className="rounded-(--radius-control) border border-border p-2"
              name="postalCode"
              type="text"
            />
          </label>

          <button
            className="self-start rounded-(--radius-control) border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? t('Cart.shippingEstimating') : t('Cart.shippingEstimateSubmit')}
          </button>
        </form>
      ) : null}

      {showResult ? (
        <div className="flex flex-col gap-3">
          <EstimateResult state={result} />

          <button
            className="self-start rounded-(--radius-control) border border-border px-3 py-2 text-sm hover:bg-accent"
            onClick={() => {
              /*
               * Drops the consignment on the server as well as reopening the
               * form. Leaving it attached would carry a shipping method the
               * shopper never chose into the real checkout.
               */
              void cancelShippingEstimate();
              setEditing(true);
            }}
            type="button"
          >
            {t('Cart.shippingEdit')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function EstimateResult({ state }: { state: EstimateState }) {
  const t = useTranslations();
  const activeLocale = useLocale();

  if (state.status === 'error') {
    return (
      <p className="text-sm text-danger" role="alert">
        {state.message}
      </p>
    );
  }

  // Distinct from an error: the address is fine, the store just does not ship
  // there.
  if (state.status === 'none') {
    return <p className="text-sm text-muted">{t('Cart.shippingNone')}</p>;
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{t('Cart.shippingOptions')}</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {state.options?.map((option) => (
          <li className="flex justify-between gap-4" key={option.id}>
            <span>{option.description}</span>
            <span>{formatCurrencyIn(activeLocale, option.cost.value, option.cost.currencyCode)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
